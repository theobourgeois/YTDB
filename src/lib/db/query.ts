import "server-only";
import type { PoolClient, QueryArrayConfig, QueryArrayResult } from "pg";
import {
  MAX_QUERY_LENGTH,
  QUERY_RESULT_LIMIT,
  QUERY_STATEMENT_TIMEOUT_MS,
} from "../query-limits";
import type { SqlQueryResult, SqlStatementResult } from "../types";
import { getPool } from "./pool";
import { serializeCell } from "./rows";

const CURSOR_NAME = "ytdb_query_result";

type ExtendedArrayQueryConfig = QueryArrayConfig & {
  queryMode: "extended";
};

function statementResult(
  result: QueryArrayResult<unknown[]>,
  command = result.command || "OK",
): SqlStatementResult {
  const truncated = result.rows.length > QUERY_RESULT_LIMIT;
  const rows = truncated ? result.rows.slice(0, QUERY_RESULT_LIMIT) : result.rows;
  return {
    command,
    columns: result.fields.map((field) => field.name),
    rows: rows.map((row) => row.map(serializeCell)),
    rowCount: truncated ? null : result.rowCount,
    truncated,
  };
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The client is destroyed after every console execution, so cleanup is best effort.
  }
}

/**
 * Uses a cursor for a single SELECT/VALUES statement so PostgreSQL never sends
 * more than the display limit. Returns null when the input is another command
 * or a multi-statement batch, which is then handled by the general executor.
 */
async function tryCappedQuery(
  client: PoolClient,
  sql: string,
): Promise<SqlStatementResult | null> {
  await client.query("BEGIN");
  const declaration: ExtendedArrayQueryConfig = {
    text: `DECLARE ${CURSOR_NAME} NO SCROLL CURSOR FOR\n${sql}`,
    rowMode: "array",
    queryMode: "extended",
  };

  try {
    await client.query(declaration);
  } catch {
    await rollback(client);
    return null;
  }

  try {
    const result = await client.query<unknown[]>({
      text: `FETCH FORWARD ${QUERY_RESULT_LIMIT + 1} FROM ${CURSOR_NAME}`,
      rowMode: "array",
    });
    await client.query("COMMIT");
    return statementResult(result, "SELECT");
  } catch (error) {
    await rollback(client);
    throw error;
  }
}

async function runBatch(client: PoolClient, sql: string): Promise<SqlStatementResult[]> {
  // No values means node-postgres uses the simple protocol, which is required
  // for migration files containing multiple statements.
  const result = (await client.query<unknown[]>({
    text: sql,
    rowMode: "array",
  })) as QueryArrayResult<unknown[]> | QueryArrayResult<unknown[]>[];
  const results = Array.isArray(result) ? result : [result];
  return results.map((item) => statementResult(item));
}

/** Runs SQL with the privileges of the selected PostgreSQL connection. */
export async function runSqlQuery(
  connectionString: string,
  input: string,
): Promise<SqlQueryResult> {
  const sql = input.trim();
  if (!sql) throw new Error("Enter a query to run");
  if (sql.length > MAX_QUERY_LENGTH) {
    throw new Error(`Query is too long (maximum ${MAX_QUERY_LENGTH.toLocaleString()} characters)`);
  }
  if (sql.includes("\0")) throw new Error("Query contains an invalid null character");

  const client = await getPool(connectionString).connect();
  const startedAt = performance.now();

  try {
    await client.query(`SET statement_timeout TO ${QUERY_STATEMENT_TIMEOUT_MS}`);
    const capped = await tryCappedQuery(client, sql);
    const statements = capped ? [capped] : await runBatch(client, sql);
    return {
      statements,
      durationMs: Math.max(0, Math.round((performance.now() - startedAt) * 10) / 10),
    };
  } finally {
    // Arbitrary SQL can change session state or leave a transaction open. Destroying
    // this pooled client guarantees those changes cannot leak into explorer requests.
    client.release(true);
  }
}
