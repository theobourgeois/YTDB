import "server-only";
import { getPool } from "./pool";
import { quoteIdent, quoteTable } from "./sql";
import { serializeCell, serializeColumnExpression } from "./rows";
import type { Cell, RowInsert, RowInsertResult } from "../types";

const COLUMN_METADATA_SQL = `
  SELECT c.relkind AS relkind,
         a.attname AS name,
         COALESCE(base_type.typname, t.typname) AS data_type,
         a.attgenerated <> '' AS is_generated,
         a.attidentity <> '' AS is_identity
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_type t ON t.oid = a.atttypid
  LEFT JOIN pg_type base_type ON base_type.oid = NULLIF(t.typbasetype, 0)
  WHERE n.nspname = $1
    AND c.relname = $2
    AND a.attnum > 0
    AND NOT a.attisdropped
  ORDER BY a.attnum
`;

type ColumnMetadata = {
  relkind: string;
  name: string;
  data_type: string;
  is_generated: boolean;
  is_identity: boolean;
};

function isCell(value: unknown): value is Cell {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

export async function insertRow(
  connectionString: string,
  input: RowInsert,
): Promise<RowInsertResult> {
  if (!input?.table || typeof input.table.schema !== "string" || typeof input.table.name !== "string") {
    throw new Error("Missing table");
  }
  if (!input.values || typeof input.values !== "object" || Array.isArray(input.values)) {
    throw new Error("Missing values");
  }

  const pool = getPool(connectionString);
  const metadataResult = await pool.query<ColumnMetadata>(COLUMN_METADATA_SQL, [
    input.table.schema,
    input.table.name,
  ]);
  const metadata = metadataResult.rows;
  if (metadata.length === 0) {
    throw new Error(`Table ${input.table.schema}.${input.table.name} not found`);
  }
  if (!metadata.every((column) => column.relkind === "r" || column.relkind === "p")) {
    throw new Error("Views and foreign tables are read-only");
  }

  const values: Cell[] = [];
  const targets: string[] = [];
  for (const [name, value] of Object.entries(input.values)) {
    const column = metadata.find((item) => item.name === name);
    if (!column) throw new Error(`Column ${name} not found`);
    if (column.is_generated) throw new Error(`Column ${name} is generated and cannot be set`);
    if (column.is_identity) {
      throw new Error(`Column ${name} is an identity column and cannot be set`);
    }
    if (!isCell(value)) throw new Error(`Unsupported value for ${name}`);
    values.push(value);
    targets.push(quoteIdent(name));
  }

  const returning = metadata
    .map((column) => serializeColumnExpression(column.name, column.data_type))
    .join(", ");
  // An INSERT with no supplied columns is still valid: every column takes its default.
  const source =
    targets.length === 0
      ? "DEFAULT VALUES"
      : `(${targets.join(", ")}) VALUES (${values.map((_, index) => `$${index + 1}`).join(", ")})`;
  const result = await pool.query({
    text: `INSERT INTO ${quoteTable(input.table)} ${source} RETURNING ${returning}`,
    values,
    rowMode: "array",
  });
  const row = result.rows[0] as unknown[] | undefined;
  if (!row) throw new Error("The row was not inserted");

  return { row: row.map(serializeCell) };
}
