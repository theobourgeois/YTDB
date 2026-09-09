import "server-only";
import type { Pool, PoolClient, QueryArrayResult } from "pg";
import { MAX_QUERY_LENGTH, MIGRATION_STATEMENT_TIMEOUT_MS } from "../query-limits";
import { quoteIdent } from "../identifiers";
import { planTransaction } from "../migrations/sql";
import {
  DEFAULT_LEDGER_SCHEMA,
  ledgerTable,
  type LedgerEntry,
  type LedgerResult,
  type MigrationRequest,
  type MigrationResult,
} from "../migrations/types";
import { getPool } from "./pool";

type LedgerRow = {
  version: string;
  name: string | null;
  checksum: string | null;
  set_name: string | null;
  applied_at: Date | string;
  duration_ms: number | null;
  applied_by: string | null;
  apply_sql?: string | null;
  revert_sql?: string | null;
};

function createLedgerSql(schema: string): string {
  return `
CREATE TABLE IF NOT EXISTS ${ledgerTable(schema)} (
  version     text PRIMARY KEY,
  name        text NOT NULL DEFAULT '',
  checksum    text NOT NULL DEFAULT '',
  set_name    text,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  duration_ms integer,
  applied_by  text,
  apply_sql   text,
  revert_sql  text
)`;
}

/** Brings a ledger written by an earlier version up to the current shape. */
function alterLedgerSql(schema: string): string[] {
  return [
    `ALTER TABLE ${ledgerTable(schema)} ADD COLUMN IF NOT EXISTS apply_sql text`,
    `ALTER TABLE ${ledgerTable(schema)} ADD COLUMN IF NOT EXISTS revert_sql text`,
  ];
}

/**
 * The SQL columns are left out unless asked for: the list polls every environment
 * to draw a status column, and does not need a migration's whole body to do it.
 */
function selectLedgerSql(schema: string, withSql: boolean): string {
  const sql = withSql ? ", apply_sql, revert_sql" : "";
  return `
SELECT version, name, checksum, set_name, applied_at, duration_ms, applied_by${sql}
FROM ${ledgerTable(schema)}
ORDER BY version`;
}

function recordApplySql(schema: string): string {
  return `
INSERT INTO ${ledgerTable(schema)}
  (version, name, checksum, set_name, duration_ms, applied_by, apply_sql, revert_sql)
VALUES ($1, $2, $3, $4, $5, current_user, $6, $7)
ON CONFLICT (version) DO UPDATE SET
  name = EXCLUDED.name,
  checksum = EXCLUDED.checksum,
  set_name = EXCLUDED.set_name,
  applied_at = now(),
  duration_ms = EXCLUDED.duration_ms,
  applied_by = current_user,
  apply_sql = EXCLUDED.apply_sql,
  revert_sql = EXCLUDED.revert_sql
RETURNING applied_at`;
}

function forgetRevertSql(schema: string): string {
  return `DELETE FROM ${ledgerTable(schema)} WHERE version = $1`;
}

function toEntry(row: LedgerRow): LedgerEntry {
  return {
    version: row.version,
    name: row.name ?? "",
    checksum: row.checksum ?? "",
    setName: row.set_name,
    appliedAt: row.applied_at instanceof Date ? row.applied_at.toISOString() : String(row.applied_at),
    durationMs: row.duration_ms,
    appliedBy: row.applied_by,
    ...(row.apply_sql ? { applySql: row.apply_sql } : {}),
    ...(row.revert_sql ? { revertSql: row.revert_sql } : {}),
  };
}

/** PostgreSQL's insufficient_privilege. */
const PERMISSION_DENIED = "42501";

function isPermissionDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === PERMISSION_DENIED
  );
}

/**
 * A permission failure on the ledger is about the ledger, not the migration, and
 * the fix is a grant the user has to run themselves — so say which one.
 */
function explainLedgerFailure(error: unknown, schema: string): never {
  if (isPermissionDenied(error)) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message}. YTDB keeps its ledger in "${schema}" and this role cannot use it. ` +
        `Either point the ledger at a schema this role owns, or have an admin run: ` +
        `CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}; ` +
        `GRANT USAGE, CREATE ON SCHEMA ${quoteIdent(schema)} TO CURRENT_USER;`,
    );
  }
  throw error;
}

async function ledgerExistsIn(pool: Pool, schema: string): Promise<boolean> {
  // to_regclass needs USAGE on the schema to resolve the name, so a role locked
  // out of it raises rather than returning null.
  const found = await pool
    .query<{ table: string | null }>("SELECT to_regclass($1)::text AS table", [ledgerTable(schema)])
    .catch((error: unknown) => explainLedgerFailure(error, schema));
  return Boolean(found.rows[0]?.table);
}

/**
 * Schemas this tool has defaulted to, newest first. A ledger sitting in one of
 * them is still this tool's ledger, so it keeps being used rather than being
 * stranded by a change of setting.
 */
const PREVIOUS_LEDGER_SCHEMAS = [DEFAULT_LEDGER_SCHEMA, "public"];

/**
 * Where this database's ledger actually is.
 *
 * The configured schema is where a *new* ledger goes, but an existing one wins:
 * changing the setting must not lose the record of everything already applied.
 * Only schemas this tool would itself have chosen are searched, so the answer
 * never depends on unrelated tables that happen to share the name.
 */
async function resolveLedgerSchema(
  pool: Pool,
  configured: string,
): Promise<{ schema: string; exists: boolean }> {
  if (await ledgerExistsIn(pool, configured)) return { schema: configured, exists: true };
  for (const fallback of PREVIOUS_LEDGER_SCHEMAS) {
    if (fallback === configured) continue;
    if (await ledgerExistsIn(pool, fallback)) return { schema: fallback, exists: true };
  }
  return { schema: configured, exists: false };
}

/**
 * Reads which migrations this database has run.
 *
 * Never creates anything: a database that has run nothing stays untouched until
 * someone actually applies something to it, and this runs against production
 * connections just to render a status column.
 */
export async function readLedger(
  connectionString: string,
  configured: string = DEFAULT_LEDGER_SCHEMA,
  withSql = false,
): Promise<LedgerResult> {
  const pool = getPool(connectionString);
  const { schema, exists } = await resolveLedgerSchema(pool, configured);
  if (!exists) return { initialized: false, schema, entries: [] };

  // A ledger written before the SQL columns existed still has to read.
  const result = await pool
    .query<LedgerRow>(selectLedgerSql(schema, withSql))
    .catch(async (error: unknown) => {
      if (!withSql) throw error;
      return pool.query<LedgerRow>(selectLedgerSql(schema, false));
    });
  return { initialized: true, schema, entries: result.rows.map(toEntry) };
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The client is destroyed after every run, so cleanup is best effort.
  }
}

/** No values means the simple protocol, which is what lets one file hold many statements. */
async function runSql(client: PoolClient, sql: string): Promise<number> {
  const result = (await client.query<unknown[]>({ text: sql, rowMode: "array" })) as
    | QueryArrayResult<unknown[]>
    | QueryArrayResult<unknown[]>[];
  return Array.isArray(result) ? result.length : 1;
}

function validate(request: MigrationRequest): void {
  if (!request.version.trim()) throw new Error("Missing migration version");
  if (request.recordOnly) return;
  const sql = request.sql.trim();
  if (!sql) throw new Error(`Migration ${request.version} has nothing to run`);
  if (sql.length > MAX_QUERY_LENGTH) {
    throw new Error(
      `Migration ${request.version} is too long (maximum ${MAX_QUERY_LENGTH.toLocaleString()} characters)`,
    );
  }
  if (sql.includes("\0")) throw new Error(`Migration ${request.version} contains a null character`);
}

/** Creates the ledger's schema and table, on the first write to a database. */
async function ensureLedger(client: PoolClient, schema: string): Promise<void> {
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}`);
    await client.query(createLedgerSql(schema));
    for (const statement of alterLedgerSql(schema)) await client.query(statement);
  } catch (error) {
    explainLedgerFailure(error, schema);
  }
}

/**
 * Runs one migration and records it, both inside the same transaction, so the
 * ledger can never claim a migration that did not fully land. Files that manage
 * their own transactions run as written and are recorded straight after, which is
 * the compromise CREATE INDEX CONCURRENTLY forces on every migration tool.
 */
export async function runMigration(
  connectionString: string,
  request: MigrationRequest,
): Promise<MigrationResult> {
  validate(request);

  // Derived here rather than trusted from the client: this decides whether the
  // migration and its ledger row commit together.
  const plan = planTransaction(request.sql);
  const pool = getPool(connectionString, "migration");
  const { schema } = await resolveLedgerSchema(pool, request.ledgerSchema);
  const client = await pool.connect();
  const startedAt = performance.now();

  try {
    await client.query(`SET statement_timeout TO ${MIGRATION_STATEMENT_TIMEOUT_MS}`);
    await ensureLedger(client, schema);

    const elapsed = () => Math.max(0, Math.round(performance.now() - startedAt));

    if (request.recordOnly) {
      const appliedAt = await record(client, schema, request, 0);
      return { version: request.version, direction: request.direction, durationMs: elapsed(), statements: 0, appliedAt };
    }

    if (!plan.atomic) {
      const statements = await runSql(client, plan.sql);
      const appliedAt = await record(client, schema, request, elapsed());
      return { version: request.version, direction: request.direction, durationMs: elapsed(), statements, appliedAt };
    }

    await client.query("BEGIN");
    try {
      const statements = await runSql(client, plan.sql);
      const appliedAt = await record(client, schema, request, elapsed());
      await client.query("COMMIT");
      return { version: request.version, direction: request.direction, durationMs: elapsed(), statements, appliedAt };
    } catch (error) {
      await rollback(client);
      throw error;
    }
  } finally {
    // A migration can change session state or leave a transaction open; destroying
    // the client keeps any of that from leaking into the next request.
    client.release(true);
  }
}

async function record(
  client: PoolClient,
  schema: string,
  request: MigrationRequest,
  durationMs: number,
): Promise<string | null> {
  if (request.direction === "revert") {
    await client.query(forgetRevertSql(schema), [request.version]);
    return null;
  }
  const result = await client.query<{ applied_at: Date | string }>(recordApplySql(schema), [
    request.version,
    request.name,
    request.checksum,
    request.setName,
    durationMs,
    request.sql || null,
    request.revertSql ?? null,
  ]);
  const appliedAt = result.rows[0]?.applied_at;
  if (!appliedAt) return null;
  return appliedAt instanceof Date ? appliedAt.toISOString() : String(appliedAt);
}

/** Creates the ledger without running anything, so a database can be prepared up front. */
export async function initLedger(
  connectionString: string,
  configured: string = DEFAULT_LEDGER_SCHEMA,
): Promise<LedgerResult> {
  const pool = getPool(connectionString, "migration");
  const { schema } = await resolveLedgerSchema(pool, configured);
  const client = await pool.connect();
  try {
    await ensureLedger(client, schema);
  } finally {
    client.release();
  }
  return readLedger(connectionString, configured);
}
