import "server-only";
import { getPool } from "./pool";
import { quoteIdent, quoteTable } from "./sql";
import type { TableDefinition, TableRef } from "../types";

const RELATION_SQL = `
  SELECT c.relkind,
         c.relpersistence,
         CASE WHEN c.relkind IN ('v', 'm') THEN pg_get_viewdef(c.oid, true) END AS viewdef,
         pg_get_partkeydef(c.oid) AS partition_by,
         parent.nspname AS parent_schema,
         parent.relname AS parent_name,
         CASE WHEN c.relispartition THEN pg_get_expr(c.relpartbound, c.oid) END AS partition_bound,
         srv.srvname AS foreign_server
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN LATERAL (
    SELECT pn.nspname, pc.relname
    FROM pg_inherits inh
    JOIN pg_class pc ON pc.oid = inh.inhparent
    JOIN pg_namespace pn ON pn.oid = pc.relnamespace
    WHERE inh.inhrelid = c.oid
    LIMIT 1
  ) parent ON TRUE
  LEFT JOIN pg_foreign_table ft ON ft.ftrelid = c.oid
  LEFT JOIN pg_foreign_server srv ON srv.oid = ft.ftserver
  WHERE n.nspname = $1
    AND c.relname = $2
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
`;

const COLUMNS_SQL = `
  SELECT a.attname AS name,
         format_type(a.atttypid, a.atttypmod) AS type,
         NOT a.attnotnull AS nullable,
         a.attidentity,
         a.attgenerated,
         pg_get_expr(ad.adbin, ad.adrelid) AS default_expr,
         CASE
           WHEN a.attcollation <> 0 AND a.attcollation <> t.typcollation
           THEN coll.collname
         END AS collation
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_type t ON t.oid = a.atttypid
  LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  LEFT JOIN pg_collation coll ON coll.oid = a.attcollation
  WHERE n.nspname = $1
    AND c.relname = $2
    AND a.attnum > 0
    AND NOT a.attisdropped
  ORDER BY a.attnum
`;

const CONSTRAINTS_SQL = `
  SELECT con.conname AS name,
         pg_get_constraintdef(con.oid, true) AS def
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = $1
    AND c.relname = $2
    AND con.contype IN ('p', 'u', 'f', 'c', 'x')
  ORDER BY CASE con.contype
             WHEN 'p' THEN 0
             WHEN 'u' THEN 1
             WHEN 'f' THEN 2
             WHEN 'c' THEN 3
             ELSE 4
           END,
           con.conname
`;

const INDEXES_SQL = `
  SELECT pg_get_indexdef(i.indexrelid, 0, true) AS def
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = $1
    AND c.relname = $2
    AND NOT i.indisprimary
    AND NOT EXISTS (
      SELECT 1 FROM pg_constraint con WHERE con.conindid = i.indexrelid
    )
  ORDER BY pg_get_indexdef(i.indexrelid, 0, true)
`;

const TRIGGERS_SQL = `
  SELECT pg_get_triggerdef(t.oid, true) AS def
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = $1
    AND c.relname = $2
    AND NOT t.tgisinternal
  ORDER BY t.tgname
`;

type RelationRow = {
  relkind: string;
  relpersistence: string;
  viewdef: string | null;
  partition_by: string | null;
  parent_schema: string | null;
  parent_name: string | null;
  partition_bound: string | null;
  foreign_server: string | null;
};

type ColumnRow = {
  name: string;
  type: string;
  nullable: boolean;
  attidentity: string;
  attgenerated: string;
  default_expr: string | null;
  collation: string | null;
};

type NamedSql = { name: string; def: string };
type SqlRow = { def: string };

export async function getTableDefinition(
  connectionString: string,
  table: TableRef,
): Promise<TableDefinition> {
  const pool = getPool(connectionString);
  const params = [table.schema, table.name];
  const [relation, columns, constraints, indexes, triggers] = await Promise.all([
    pool.query<RelationRow>(RELATION_SQL, params),
    pool.query<ColumnRow>(COLUMNS_SQL, params),
    pool.query<NamedSql>(CONSTRAINTS_SQL, params),
    pool.query<SqlRow>(INDEXES_SQL, params),
    pool.query<SqlRow>(TRIGGERS_SQL, params),
  ]);

  const rel = relation.rows[0];
  if (!rel) throw new Error(`Relation ${quoteTable(table)} not found`);

  const extra = [
    ...indexes.rows.map((row) => withSemicolon(row.def)),
    ...triggers.rows.map((row) => withSemicolon(row.def)),
  ];

  if (rel.relkind === "v" || rel.relkind === "m") {
    const keyword = rel.relkind === "m" ? "MATERIALIZED VIEW" : "VIEW";
    const view = rel.viewdef?.trim() ?? "SELECT NULL";
    const sql = [
      `CREATE ${keyword} ${quoteTable(table)} AS\n${view.replace(/;$/, "")};`,
      ...extra,
    ];
    return { sql: sql.join("\n\n") + "\n" };
  }

  const body = [
    ...columns.rows.map(formatColumn),
    ...constraints.rows.map((row) => `CONSTRAINT ${quoteIdent(row.name)} ${row.def}`),
  ];
  const indented = body.map((line) => `    ${line}`).join(",\n");
  const header = tableHeader(table, rel);
  const closing = tableClosing(rel);
  const create =
    body.length === 0 ? `${header}${closing};` : `${header} (\n${indented}\n)${closing};`;
  return { sql: [create, ...extra].join("\n\n") + "\n" };
}

function tableHeader(table: TableRef, rel: RelationRow): string {
  const unlogged = rel.relpersistence === "u" ? "UNLOGGED " : "";
  const quoted = quoteTable(table);
  if (rel.relkind === "f") return `CREATE FOREIGN TABLE ${quoted}`;
  if (rel.partition_bound && rel.parent_schema && rel.parent_name) {
    const parent = quoteTable({ schema: rel.parent_schema, name: rel.parent_name });
    return `CREATE ${unlogged}TABLE ${quoted} PARTITION OF ${parent}`;
  }
  return `CREATE ${unlogged}TABLE ${quoted}`;
}

function tableClosing(rel: RelationRow): string {
  const parts: string[] = [];
  if (rel.partition_bound) parts.push(` ${rel.partition_bound}`);
  if (rel.partition_by) parts.push(` PARTITION BY ${rel.partition_by}`);
  if (rel.relkind === "f" && rel.foreign_server) {
    parts.push(` SERVER ${quoteIdent(rel.foreign_server)}`);
  }
  return parts.join("");
}

function formatColumn(column: ColumnRow): string {
  const parts = [quoteIdent(column.name), column.type];
  if (column.collation) parts.push("COLLATE", quoteIdent(column.collation));
  if (column.attgenerated === "s" || column.attgenerated === "v") {
    const expr = column.default_expr ?? "NULL";
    parts.push("GENERATED ALWAYS AS", `(${expr})`);
    if (column.attgenerated === "s") parts.push("STORED");
    if (!column.nullable) parts.push("NOT NULL");
    return parts.join(" ");
  }
  if (!column.nullable) parts.push("NOT NULL");
  if (column.attidentity === "a") parts.push("GENERATED ALWAYS AS IDENTITY");
  else if (column.attidentity === "d") parts.push("GENERATED BY DEFAULT AS IDENTITY");
  else if (column.default_expr) parts.push("DEFAULT", column.default_expr);
  return parts.join(" ");
}

function withSemicolon(sql: string): string {
  const trimmed = sql.trim();
  return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
}
