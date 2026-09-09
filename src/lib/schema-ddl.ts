import { quoteIdent, quoteTable } from "./identifiers";
import type {
  SnapshotColumn,
  SnapshotEnum,
  SnapshotFunction,
  SnapshotRelation,
} from "./types";

/** `schema.name`, quoted, for any snapshot object. */
export function qualified(object: { schema: string; name: string }): string {
  return quoteTable({ schema: object.schema, name: object.name });
}

export function functionSignature(fn: SnapshotFunction): string {
  return `${qualified(fn)}(${fn.args})`;
}

const SERIAL_TYPES: Record<string, string> = {
  smallint: "smallserial",
  integer: "serial",
  bigint: "bigserial",
};

/**
 * `serial` when the column's default is the sequence Postgres created for it.
 * Writing the shorthand keeps the sequence with the column, where spelling out
 * `nextval(...)` would reference a sequence the other database does not have.
 */
function serialType(column: SnapshotColumn, relationName: string | undefined): string | null {
  if (!relationName || column.nullable || column.identity || column.generated !== null) return null;
  const serial = SERIAL_TYPES[column.type];
  if (!serial || column.default === null) return null;
  const match = /^nextval\('([^']+)'::regclass\)$/.exec(column.default);
  const sequence = match?.[1]?.split(".").pop()?.replace(/"/g, "");
  return sequence === `${relationName}_${column.name}_seq` ? serial : null;
}

/** Constraint DDL that has to wait until every table exists. */
export function isForeignKey(sql: string): boolean {
  return /^\s*FOREIGN KEY/i.test(sql);
}

/** The column as it would appear inside CREATE TABLE. */
export function columnDefinition(column: SnapshotColumn, relationName?: string): string {
  const serial = serialType(column, relationName);
  if (serial) return `${quoteIdent(column.name)} ${serial}`;
  const parts = [quoteIdent(column.name), column.type];
  if (column.collation) parts.push("COLLATE", quoteIdent(column.collation));
  if (column.generated !== null) {
    parts.push("GENERATED ALWAYS AS", `(${column.generated})`, "STORED");
    if (!column.nullable) parts.push("NOT NULL");
    return parts.join(" ");
  }
  if (!column.nullable) parts.push("NOT NULL");
  if (column.identity) parts.push(`GENERATED ${column.identity} AS IDENTITY`);
  else if (column.default !== null) parts.push("DEFAULT", column.default);
  return parts.join(" ");
}

export function createEnumSql(type: SnapshotEnum): string {
  const labels = type.labels.map((label) => `'${label.replace(/'/g, "''")}'`).join(", ");
  return `CREATE TYPE ${qualified(type)} AS ENUM (${labels});`;
}

export function createRelationSql(relation: SnapshotRelation): string {
  if (relation.kind === "view" || relation.kind === "materialized view") {
    return createViewSql(relation);
  }
  const body = [
    ...relation.columns.map((column) => columnDefinition(column, relation.name)),
    // Foreign keys are added afterwards, once every table they point at exists.
    ...relation.constraints
      .filter((item) => !isForeignKey(item.sql))
      .map((item) => `CONSTRAINT ${quoteIdent(item.name)} ${item.sql}`),
  ];
  const header = tableHeader(relation);
  const closing = tableClosing(relation);
  if (relation.partitionOf) {
    // A partition inherits its columns; only the bound and any extra clauses are written.
    return `${header}${closing};`;
  }
  if (body.length === 0) return `${header}${closing};`;
  const indented = body.map((line) => `    ${line}`).join(",\n");
  return `${header} (\n${indented}\n)${closing};`;
}

export function createViewSql(relation: SnapshotRelation): string {
  const keyword = relation.kind === "materialized view" ? "MATERIALIZED VIEW" : "VIEW";
  const body = relation.viewSql?.trim() ?? "SELECT NULL";
  return `CREATE ${keyword} ${qualified(relation)} AS\n${body};`;
}

/** CREATE OR REPLACE only exists for plain views; a matview has to be recreated. */
export function replaceViewSql(relation: SnapshotRelation): string {
  const body = relation.viewSql?.trim() ?? "SELECT NULL";
  return `CREATE OR REPLACE VIEW ${qualified(relation)} AS\n${body};`;
}

function tableHeader(relation: SnapshotRelation): string {
  const unlogged = relation.unlogged ? "UNLOGGED " : "";
  const quoted = qualified(relation);
  if (relation.kind === "foreign table") return `CREATE FOREIGN TABLE ${quoted}`;
  if (relation.partitionOf) {
    return `CREATE ${unlogged}TABLE ${quoted} PARTITION OF ${quoteTable(relation.partitionOf.parent)}`;
  }
  return `CREATE ${unlogged}TABLE ${quoted}`;
}

function tableClosing(relation: SnapshotRelation): string {
  const parts: string[] = [];
  if (relation.partitionOf) parts.push(` ${relation.partitionOf.bound}`);
  if (relation.partitionBy) parts.push(` PARTITION BY ${relation.partitionBy}`);
  return parts.join("");
}

/** Whitespace-insensitive comparison, so re-indented DDL is not reported as a change. */
export function sameSql(left: string | undefined, right: string | undefined): boolean {
  return normalizeSql(left) === normalizeSql(right);
}

export function normalizeSql(sql: string | undefined): string {
  return (sql ?? "").replace(/\s+/g, " ").trim();
}

export { quoteIdent, quoteTable };
