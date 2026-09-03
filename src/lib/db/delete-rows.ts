import "server-only";
import { getPool } from "./pool";
import { quoteIdent, quoteTable } from "./sql";
import type { Cell, RowDelete, RowDeleteResult } from "../types";

const MAX_DELETE_ROWS = 500;

const COLUMN_METADATA_SQL = `
  SELECT c.relkind AS relkind,
         a.attname AS name,
         COALESCE(
           (SELECT TRUE FROM pg_index i
            WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY(i.indkey)
            LIMIT 1),
           FALSE
         ) AS is_pk
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = $1
    AND c.relname = $2
    AND a.attnum > 0
    AND NOT a.attisdropped
  ORDER BY a.attnum
`;

type ColumnMetadata = {
  relkind: string;
  name: string;
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

export async function deleteRows(
  connectionString: string,
  input: RowDelete,
): Promise<RowDeleteResult> {
  if (!input?.table || typeof input.table.schema !== "string" || typeof input.table.name !== "string") {
    throw new Error("Missing table");
  }
  if (!Array.isArray(input.primaryKeys) || input.primaryKeys.length === 0) {
    throw new Error("No rows to delete");
  }
  if (input.primaryKeys.length > MAX_DELETE_ROWS) {
    throw new Error(`Cannot delete more than ${MAX_DELETE_ROWS} rows at once`);
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

  const primaryKeys = metadata.filter((column) => column.is_pk);
  if (primaryKeys.length === 0) throw new Error("Deleting requires a primary key");

  const values: Cell[] = [];
  const tuples = input.primaryKeys.map((primaryKey, rowIndex) => {
    if (!primaryKey || typeof primaryKey !== "object" || Array.isArray(primaryKey)) {
      throw new Error(`Invalid primary key for row ${rowIndex + 1}`);
    }
    const providedKeys = Object.keys(primaryKey);
    if (
      providedKeys.length !== primaryKeys.length ||
      primaryKeys.some((column) => !Object.prototype.hasOwnProperty.call(primaryKey, column.name))
    ) {
      throw new Error("The row primary key is incomplete");
    }
    const placeholders = primaryKeys.map((column) => {
      const value = primaryKey[column.name];
      if (!isCell(value)) throw new Error(`Invalid primary key value for ${column.name}`);
      values.push(value);
      return `$${values.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });

  const pkList = primaryKeys.map((column) => quoteIdent(column.name)).join(", ");
  const result = await pool.query(
    `DELETE FROM ${quoteTable(input.table)}
     WHERE (${pkList}) IN (${tuples.join(", ")})`,
    values,
  );

  return { deleted: result.rowCount ?? 0 };
}
