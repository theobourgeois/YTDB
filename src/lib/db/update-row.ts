import "server-only";
import { getPool } from "./pool";
import { quoteIdent, quoteTable } from "./sql";
import { serializeCell, serializeColumnExpression } from "./rows";
import type { Cell, RowUpdate, RowUpdateResult } from "../types";

const COLUMN_METADATA_SQL = `
  SELECT c.relkind AS relkind,
         a.attname AS name,
         COALESCE(base_type.typname, t.typname) AS data_type,
         a.attgenerated <> '' AS is_generated,
         a.attidentity <> '' AS is_identity,
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

/**
 * Writes several columns of one row in a single statement, so a partly-applied
 * edit is not possible. Columns absent from `values` keep what they had, and a
 * column listed in `defaults` is reset to its database default instead.
 */
export async function updateRow(
  connectionString: string,
  input: RowUpdate,
): Promise<RowUpdateResult> {
  if (!input?.table || typeof input.table.schema !== "string" || typeof input.table.name !== "string") {
    throw new Error("Missing table");
  }
  if (!input.values || typeof input.values !== "object" || Array.isArray(input.values)) {
    throw new Error("Missing values");
  }
  if (!input.primaryKey || typeof input.primaryKey !== "object" || Array.isArray(input.primaryKey)) {
    throw new Error("Missing primary key");
  }
  const defaults = input.defaults ?? [];
  if (!Array.isArray(defaults)) throw new Error("Invalid default columns");

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

  const primaryKeys = metadata.filter((column) => column.is_pk);
  if (primaryKeys.length === 0) throw new Error("Editing requires a primary key");
  const providedKeys = Object.keys(input.primaryKey);
  if (
    providedKeys.length !== primaryKeys.length ||
    primaryKeys.some((column) => !Object.prototype.hasOwnProperty.call(input.primaryKey, column.name))
  ) {
    throw new Error("The row primary key is incomplete");
  }

  const values: Cell[] = [];
  const assignments: string[] = [];
  function assign(name: string, expression: string) {
    const column = metadata.find((item) => item.name === name);
    if (!column) throw new Error(`Column ${name} not found`);
    if (column.is_generated) throw new Error(`Column ${name} is generated and cannot be set`);
    if (column.is_identity) throw new Error(`Column ${name} is an identity column and cannot be set`);
    assignments.push(`${quoteIdent(name)} = ${expression}`);
  }
  for (const [name, value] of Object.entries(input.values)) {
    if (defaults.includes(name)) throw new Error(`Column ${name} was given both a value and DEFAULT`);
    if (!isCell(value)) throw new Error(`Unsupported value for ${name}`);
    values.push(value);
    assign(name, `$${values.length}`);
  }
  for (const name of defaults) {
    if (typeof name !== "string") throw new Error("Invalid default column");
    assign(name, "DEFAULT");
  }
  if (assignments.length === 0) throw new Error("Nothing to update");

  const where = primaryKeys.map((column) => {
    const value = input.primaryKey[column.name];
    if (!isCell(value)) throw new Error(`Invalid primary key value for ${column.name}`);
    values.push(value);
    return `${quoteIdent(column.name)} IS NOT DISTINCT FROM $${values.length}`;
  });
  const returning = metadata
    .map((column) => serializeColumnExpression(column.name, column.data_type))
    .join(", ");
  const result = await pool.query({
    text: `UPDATE ${quoteTable(input.table)}
           SET ${assignments.join(", ")}
           WHERE ${where.join(" AND ")}
           RETURNING ${returning}`,
    values,
    rowMode: "array",
  });
  if (result.rowCount !== 1) {
    throw new Error("The row no longer exists or could not be updated");
  }

  return {
    row: (result.rows[0] as unknown[]).map(serializeCell),
    updated: assignments.length,
  };
}
