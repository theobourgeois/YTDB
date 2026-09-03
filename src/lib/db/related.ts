import "server-only";
import { getPool } from "./pool";
import { escapeIlike, isSearchableType, quoteIdent, quoteTable } from "./sql";
import { serializeCell, serializeColumnExpression } from "./rows";
import type {
  Cell,
  LookupQuery,
  RelatedLookup,
  RelatedResult,
  RowsResult,
  TableRef,
} from "../types";

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

const MAX_RELATED_KEYS = 500;
const MAX_LOOKUP_LIMIT = 50;

type ColumnRow = {
  name: string;
  data_type: string;
  type_category: string;
  is_pk: boolean;
};

function isCell(value: unknown): value is Cell {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function cellText(value: Cell): string {
  return value === null ? "" : String(value);
}

async function tableColumns(connectionString: string, table: TableRef): Promise<ColumnRow[]> {
  const pool = getPool(connectionString);
  const result = await pool.query<ColumnRow>(COLUMNS_SQL, [table.schema, table.name]);
  if (result.rows.length === 0) {
    throw new Error(`Table ${table.schema}.${table.name} not found`);
  }
  return result.rows;
}

function selectList(columns: ColumnRow[]): string {
  return columns
    .map((column) => serializeColumnExpression(column.name, column.data_type))
    .join(", ");
}

export async function fetchRelated(
  connectionString: string,
  lookups: RelatedLookup[],
): Promise<RelatedResult[]> {
  return Promise.all(lookups.map((lookup) => fetchRelatedLookup(connectionString, lookup)));
}

async function fetchRelatedLookup(
  connectionString: string,
  lookup: RelatedLookup,
): Promise<RelatedResult> {
  const columns = await tableColumns(connectionString, lookup.table);
  const known = new Map(columns.map((column) => [column.name, column]));
  const keyColumns = lookup.keyColumns.filter((column) => known.has(column));
  if (keyColumns.length === 0 || keyColumns.length !== lookup.keyColumns.length) {
    throw new Error("Unknown related key column");
  }

  const seen = new Set<string>();
  const keys: string[][] = [];
  for (const key of lookup.keys) {
    if (!Array.isArray(key) || key.length !== keyColumns.length) continue;
    if (key.some((value) => !isCell(value) || value === null)) continue;
    const texts = key.map(cellText);
    const id = JSON.stringify(texts);
    if (seen.has(id)) continue;
    seen.add(id);
    keys.push(texts);
    if (keys.length >= MAX_RELATED_KEYS) break;
  }

  if (keys.length === 0) {
    return { table: lookup.table, columns: columns.map((column) => column.name), rows: [] };
  }

  const params: string[] = [];
  const tuples = keys.map((key) => {
    const placeholders = key.map((value) => {
      params.push(value);
      return `$${params.length}`;
    });
    return keyColumns.length === 1 ? placeholders[0] : `(${placeholders.join(", ")})`;
  });
  const keyExpr =
    keyColumns.length === 1
      ? `${quoteIdent(keyColumns[0])}::text`
      : `(${keyColumns.map((column) => `${quoteIdent(column)}::text`).join(", ")})`;

  const pool = getPool(connectionString);
  const result = await pool.query({
    text: `SELECT ${selectList(columns)} FROM ${quoteTable(lookup.table)}
           WHERE ${keyExpr} IN (${tuples.join(", ")})`,
    values: params,
    rowMode: "array",
  });

  const columnNames = columns.map((column) => column.name);
  const keyIndexes = keyColumns.map((column) => columnNames.indexOf(column));
  return {
    table: lookup.table,
    columns: columnNames,
    rows: (result.rows as unknown[][]).map((row) => {
      const cells = row.map(serializeCell);
      return {
        key: keyIndexes.map((index) => cells[index] ?? null),
        row: cells,
      };
    }),
  };
}

export async function searchLookup(
  connectionString: string,
  query: LookupQuery,
): Promise<RowsResult> {
  const columns = await tableColumns(connectionString, query.table);
  const limit = Math.max(1, Math.min(query.limit ?? 30, MAX_LOOKUP_LIMIT));
  const primaryKeys = columns.filter((column) => column.is_pk).map((column) => column.name);
  const orderBy = primaryKeys.length
    ? `ORDER BY ${primaryKeys.map((column) => `${quoteIdent(column)} ASC`).join(", ")}`
    : "";

  const search = query.search.trim();
  const params: string[] = [];
  let where = "";
  if (search) {
    const searchable = columns.filter((column) =>
      isSearchableType(column.data_type, column.type_category),
    );
    if (searchable.length === 0) {
      return {
        columns: columns.map((column) => column.name),
        rows: [],
        total: 0,
        estimated: false,
        hasMore: false,
      };
    }
    params.push(`%${escapeIlike(search)}%`);
    where = `WHERE ${searchable
      .map((column) => `${quoteIdent(column.name)}::text ILIKE $1 ESCAPE '\\'`)
      .join(" OR ")}`;
  }

  const pool = getPool(connectionString);
  const result = await pool.query({
    text: `SELECT ${selectList(columns)} FROM ${quoteTable(query.table)}
           ${where} ${orderBy} LIMIT ${limit}`,
    values: params,
    rowMode: "array",
  });

  return {
    columns: columns.map((column) => column.name),
    rows: (result.rows as unknown[][]).map((row) => row.map(serializeCell)),
    total: result.rowCount ?? result.rows.length,
    estimated: false,
    hasMore: (result.rowCount ?? result.rows.length) >= limit,
  };
}
