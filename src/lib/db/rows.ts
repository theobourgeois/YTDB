import "server-only";
import type { Pool } from "pg";
import { getPool } from "./pool";
import { buildWhere, escapeIlike, isSearchableType, quoteIdent, quoteTable } from "./sql";
import { isFilterComplete } from "../filters";
import { EXACT_COUNT_MAX_BYTES, MAX_OFFSET } from "../query-limits";
import type { Cell, ColumnInfo, RowsQuery, RowsResult, TableRef } from "../types";

const COLUMNS_SQL = `
  SELECT a.attname AS name,
         COALESCE(base_type.typname, t.typname) AS data_type,
         COALESCE(base_type.typcategory, t.typcategory) AS type_category,
         COALESCE(
           (SELECT TRUE FROM pg_index i
            WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY(i.indkey)
            LIMIT 1),
           FALSE
         ) AS is_pk
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_type t ON t.oid = a.atttypid
  LEFT JOIN pg_type base_type ON base_type.oid = NULLIF(t.typbasetype, 0)
  WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
  ORDER BY a.attnum
`;

const RELATION_STATS_SQL = `
  WITH RECURSIVE tree AS (
    SELECT c.oid, c.relkind, 0 AS depth
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relname = $2
    UNION ALL
    SELECT child.oid, child.relkind, tree.depth + 1
    FROM tree
    JOIN pg_inherits i ON i.inhparent = tree.oid
    JOIN pg_class child ON child.oid = i.inhrelid
  )
  SELECT MAX(relkind) FILTER (WHERE depth = 0) AS relkind,
         COALESCE(SUM(pg_catalog.pg_relation_size(tree.oid)) FILTER (
           WHERE NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhparent = tree.oid)
         ), 0)::bigint AS bytes
  FROM tree
`;

const TEXT_SERIALIZED_TYPES = new Set([
  "date",
  "interval",
  "json",
  "jsonb",
  "time",
  "timestamp",
  "timestamptz",
  "timetz",
]);

type WhereClause = {
  sql: string;
  params: string[];
};

type RelationStats = {
  relkind: string;
  bytes: number;
};

type CountResult = {
  total: number | null;
  estimated: boolean;
};

export function serializeCell(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `\\x${value.toString("hex")}`;
  return JSON.stringify(value);
}

export function serializeColumnExpression(name: string, dataType: string): string {
  const identifier = quoteIdent(name);
  return TEXT_SERIALIZED_TYPES.has(dataType) ? `${identifier}::text` : identifier;
}

export async function fetchRows(connectionString: string, query: RowsQuery): Promise<RowsResult> {
  const pool = getPool(connectionString);

  const columnResult = await pool.query<
    Pick<ColumnInfo, "name"> & { data_type: string; type_category: string; is_pk: boolean }
  >(COLUMNS_SQL, [query.table.schema, query.table.name]);
  const columns = columnResult.rows.map((row) => row.name);
  if (columns.length === 0) {
    throw new Error(`Table ${query.table.schema}.${query.table.name} not found`);
  }

  const known = new Set(columns);
  const filters = query.filters.filter((f) => isFilterComplete(f) && known.has(f.column));
  const where = buildWhere(filters);
  const search = query.search?.trim() ?? "";
  let searched = false;
  if (search) {
    const searchable = columnResult.rows.filter((column) =>
      isSearchableType(column.data_type, column.type_category),
    );
    if (searchable.length > 0) {
      where.params.push(`%${escapeIlike(search)}%`);
      const searchSql = searchable
        .map((column) => `${quoteIdent(column.name)}::text ILIKE $${where.params.length} ESCAPE '\\'`)
        .join(" OR ");
      where.sql = where.sql ? `${where.sql} AND (${searchSql})` : `WHERE ${searchSql}`;
      searched = true;
    }
  }

  const primaryKeys = columnResult.rows.filter((row) => row.is_pk).map((row) => row.name);
  const sort = query.sort && known.has(query.sort.column) ? query.sort : null;
  const orderColumns = sort
    ? [
        `${quoteIdent(sort.column)} ${sort.direction === "desc" ? "DESC" : "ASC"}`,
        ...primaryKeys
          .filter((column) => column !== sort.column)
          .map((column) => `${quoteIdent(column)} ASC`),
      ]
    : primaryKeys.map((column) => `${quoteIdent(column)} ASC`);
  const orderBy = orderColumns.length ? `ORDER BY ${orderColumns.join(", ")}` : "";

  const table = quoteTable(query.table);
  const selectColumns = columnResult.rows.map((column) =>
    serializeColumnExpression(column.name, column.data_type),
  );
  const limit = Math.max(1, Math.min(query.pageSize, 500));
  const maxPage = Math.floor(MAX_OFFSET / limit);
  const page = Math.min(Math.max(0, query.page), maxPage);
  const offset = page * limit;
  const atCap = page >= maxPage;

  const [dataResult, count] = await Promise.all([
    pool.query({
      text: `SELECT ${selectColumns.join(", ")} FROM ${table} ${where.sql} ${orderBy} LIMIT ${limit + 1} OFFSET ${offset}`,
      values: where.params,
      rowMode: "array",
    }),
    countRows(pool, query.table, table, where, searched),
  ]);

  const fetched = dataResult.rows as unknown[][];
  const hasExtra = fetched.length > limit;
  const pageRows = hasExtra ? fetched.slice(0, limit) : fetched;

  return {
    columns,
    rows: pageRows.map((row) => row.map(serializeCell)),
    total: count.total,
    estimated: count.estimated,
    hasMore: hasExtra && !atCap,
    capped: hasExtra && atCap,
  };
}

async function countRows(
  pool: Pool,
  tableRef: TableRef,
  table: string,
  where: WhereClause,
  hasSearch: boolean,
): Promise<CountResult> {
  const stats = await relationStats(pool, tableRef);
  if (canExactCount(stats)) {
    const countResult = await pool.query<{ count: string }>(
      `SELECT count(*)::bigint AS count FROM ${table} ${where.sql}`,
      where.params,
    );
    return { total: Number(countResult.rows[0]?.count ?? 0), estimated: false };
  }

  // Leading-wildcard search estimates are usually "the whole table".
  if (hasSearch) return { total: null, estimated: true };

  try {
    return { total: await estimateRows(pool, table, where), estimated: true };
  } catch {
    return { total: null, estimated: true };
  }
}

function canExactCount(stats: RelationStats | null): boolean {
  if (!stats) return false;
  if (stats.relkind !== "r" && stats.relkind !== "p" && stats.relkind !== "m") return false;
  return stats.bytes <= EXACT_COUNT_MAX_BYTES;
}

async function relationStats(pool: Pool, table: TableRef): Promise<RelationStats | null> {
  const result = await pool.query<{ relkind: string | null; bytes: string }>(
    RELATION_STATS_SQL,
    [table.schema, table.name],
  );
  const row = result.rows[0];
  if (!row?.relkind) return null;
  return { relkind: row.relkind, bytes: Number(row.bytes) };
}

async function estimateRows(pool: Pool, table: string, where: WhereClause): Promise<number> {
  const result = await pool.query<{ "QUERY PLAN": unknown }>(
    `EXPLAIN (FORMAT JSON) SELECT 1 FROM ${table} ${where.sql}`,
    where.params,
  );
  return plannedRows(result.rows[0]?.["QUERY PLAN"]);
}

function plannedRows(explain: unknown): number {
  const parsed: unknown = typeof explain === "string" ? JSON.parse(explain) : explain;
  const root = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!root || typeof root !== "object") return 0;
  const plan = "Plan" in root ? root.Plan : null;
  if (!plan || typeof plan !== "object" || !("Plan Rows" in plan)) return 0;
  const rows = Number(plan["Plan Rows"]);
  return Number.isFinite(rows) ? Math.max(0, Math.round(rows)) : 0;
}
