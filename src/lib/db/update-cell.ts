import "server-only";
import { getPool } from "./pool";
import { quoteIdent, quoteTable } from "./sql";
import { serializeCell, serializeColumnExpression } from "./rows";
import type { Cell, CellUpdate, CellUpdateResult } from "../types";

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

export async function updateCell(
  connectionString: string,
  input: CellUpdate,
): Promise<CellUpdateResult> {
  if (!input?.table || typeof input.table.schema !== "string" || typeof input.table.name !== "string") {
    throw new Error("Missing table");
  }
  if (typeof input.column !== "string" || !input.column) throw new Error("Missing column");
  if (!input.primaryKey || typeof input.primaryKey !== "object" || Array.isArray(input.primaryKey)) {
    throw new Error("Missing primary key");
  }
  if (!isCell(input.value)) throw new Error("Unsupported cell value");

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

  const target = metadata.find((column) => column.name === input.column);
  if (!target) throw new Error(`Column ${input.column} not found`);
  if (target.is_generated) throw new Error("Generated columns are read-only");
  if (target.is_identity) throw new Error("Identity columns are read-only");

  const primaryKeys = metadata.filter((column) => column.is_pk);
  if (primaryKeys.length === 0) throw new Error("Editing requires a primary key");
  const providedKeys = Object.keys(input.primaryKey);
  if (
    providedKeys.length !== primaryKeys.length ||
    primaryKeys.some((column) => !Object.prototype.hasOwnProperty.call(input.primaryKey, column.name))
  ) {
    throw new Error("The row primary key is incomplete");
  }

  const values: Cell[] = [input.value];
  const where = primaryKeys.map((column, index) => {
    const value = input.primaryKey[column.name];
    if (!isCell(value)) throw new Error(`Invalid primary key value for ${column.name}`);
    values.push(value);
    return `${quoteIdent(column.name)} IS NOT DISTINCT FROM $${index + 2}`;
  });
  const returning = metadata
    .map((column) => serializeColumnExpression(column.name, column.data_type))
    .join(", ");
  const result = await pool.query({
    text: `UPDATE ${quoteTable(input.table)}
           SET ${quoteIdent(target.name)} = $1
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
  };
}
