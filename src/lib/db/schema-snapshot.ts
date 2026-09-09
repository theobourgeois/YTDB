import "server-only";
import { getPool } from "./pool";
import { relationKey } from "../types";
import type {
  RelationKind,
  SchemaSnapshot,
  SnapshotColumn,
  SnapshotEnum,
  SnapshotExtension,
  SnapshotFunction,
  SnapshotNamedSql,
  SnapshotRelation,
} from "../types";

const HIDDEN_SCHEMAS = ["pg_catalog", "information_schema", "pg_toast"];

/** Objects an extension owns move with the extension, so they are never a migration of their own. */
function notFromExtension(catalog: string, alias: string): string {
  return `NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = '${catalog}'::regclass AND d.objid = ${alias}.oid AND d.deptype = 'e'
    )`;
}

const EXTENSIONS_SQL = `
  SELECT e.extname AS name, e.extversion AS version, n.nspname AS schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  ORDER BY e.extname
`;

const SCHEMAS_SQL = `
  SELECT n.nspname AS name
  FROM pg_namespace n
  WHERE n.nspname <> ALL($1)
    AND n.nspname NOT LIKE 'pg_temp%'
    AND n.nspname NOT LIKE 'pg_toast%'
    AND ${notFromExtension("pg_namespace", "n")}
  ORDER BY n.nspname
`;

const ENUMS_SQL = `
  SELECT n.nspname AS schema,
         t.typname AS name,
         array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE n.nspname <> ALL($1)
    AND n.nspname NOT LIKE 'pg_temp%'
    AND ${notFromExtension("pg_type", "t")}
  GROUP BY n.nspname, t.typname
  ORDER BY n.nspname, t.typname
`;

const RELATIONS_SQL = `
  SELECT n.nspname AS schema,
         c.relname AS name,
         c.relkind,
         c.relpersistence,
         CASE WHEN c.relkind IN ('v', 'm') THEN pg_get_viewdef(c.oid, true) END AS viewdef,
         pg_get_partkeydef(c.oid) AS partition_by,
         parent.nspname AS parent_schema,
         parent.relname AS parent_name,
         CASE WHEN c.relispartition THEN pg_get_expr(c.relpartbound, c.oid) END AS partition_bound
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
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND n.nspname <> ALL($1)
    AND n.nspname NOT LIKE 'pg_temp%'
    AND ${notFromExtension("pg_class", "c")}
  ORDER BY n.nspname, c.relname
`;

const COLUMNS_SQL = `
  SELECT n.nspname AS schema,
         c.relname AS table_name,
         a.attname AS name,
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
  WHERE a.attnum > 0
    AND NOT a.attisdropped
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND n.nspname <> ALL($1)
    AND n.nspname NOT LIKE 'pg_temp%'
  ORDER BY n.nspname, c.relname, a.attnum
`;

const CONSTRAINTS_SQL = `
  SELECT n.nspname AS schema,
         c.relname AS table_name,
         con.conname AS name,
         pg_get_constraintdef(con.oid, true) AS sql
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE con.contype IN ('p', 'u', 'f', 'c', 'x')
    AND n.nspname <> ALL($1)
    AND n.nspname NOT LIKE 'pg_temp%'
  ORDER BY n.nspname, c.relname, con.conname
`;

const INDEXES_SQL = `
  SELECT n.nspname AS schema,
         c.relname AS table_name,
         ic.relname AS name,
         pg_get_indexdef(i.indexrelid, 0, true) AS sql
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indrelid
  JOIN pg_class ic ON ic.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE NOT i.indisprimary
    AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = i.indexrelid)
    AND n.nspname <> ALL($1)
    AND n.nspname NOT LIKE 'pg_temp%'
  ORDER BY n.nspname, c.relname, ic.relname
`;

const TRIGGERS_SQL = `
  SELECT n.nspname AS schema,
         c.relname AS table_name,
         t.tgname AS name,
         pg_get_triggerdef(t.oid, true) AS sql
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE NOT t.tgisinternal
    AND n.nspname <> ALL($1)
    AND n.nspname NOT LIKE 'pg_temp%'
  ORDER BY n.nspname, c.relname, t.tgname
`;

const FUNCTIONS_SQL = `
  SELECT n.nspname AS schema,
         p.proname AS name,
         p.prokind,
         pg_get_function_identity_arguments(p.oid) AS args,
         pg_get_functiondef(p.oid) AS sql
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prokind IN ('f', 'p')
    AND n.nspname <> ALL($1)
    AND n.nspname NOT LIKE 'pg_temp%'
    AND ${notFromExtension("pg_proc", "p")}
  ORDER BY n.nspname, p.proname, args
`;

type NameRow = { name: string };
type EnumRow = { schema: string; name: string; labels: string[] | null };
type RelationRow = {
  schema: string;
  name: string;
  relkind: string;
  relpersistence: string;
  viewdef: string | null;
  partition_by: string | null;
  parent_schema: string | null;
  parent_name: string | null;
  partition_bound: string | null;
};
type ColumnRow = {
  schema: string;
  table_name: string;
  name: string;
  type: string;
  nullable: boolean;
  attidentity: string;
  attgenerated: string;
  default_expr: string | null;
  collation: string | null;
};
type NamedSqlRow = { schema: string; table_name: string; name: string; sql: string };
type FunctionRow = {
  schema: string;
  name: string;
  prokind: string;
  args: string;
  sql: string;
};

const RELATION_KINDS: Record<string, RelationKind> = {
  r: "table",
  p: "table",
  v: "view",
  m: "materialized view",
  f: "foreign table",
};

/**
 * Reads the structure of an entire database in one round of catalog queries.
 * Everything Postgres can render as DDL is kept as DDL, so two snapshots can be
 * compared as text without the client re-deriving Postgres' own formatting.
 */
export async function getSchemaSnapshot(connectionString: string): Promise<SchemaSnapshot> {
  const pool = getPool(connectionString);
  const params = [HIDDEN_SCHEMAS];
  const [extensions, schemas, enums, relations, columns, constraints, indexes, triggers, functions] =
    await Promise.all([
      pool.query<SnapshotExtension>(EXTENSIONS_SQL),
      pool.query<NameRow>(SCHEMAS_SQL, params),
      pool.query<EnumRow>(ENUMS_SQL, params),
      pool.query<RelationRow>(RELATIONS_SQL, params),
      pool.query<ColumnRow>(COLUMNS_SQL, params),
      pool.query<NamedSqlRow>(CONSTRAINTS_SQL, params),
      pool.query<NamedSqlRow>(INDEXES_SQL, params),
      pool.query<NamedSqlRow>(TRIGGERS_SQL, params),
      pool.query<FunctionRow>(FUNCTIONS_SQL, params),
    ]);

  const columnsByRelation = new Map<string, SnapshotColumn[]>();
  for (const row of columns.rows) {
    const list = columnsByRelation.get(`${row.schema}.${row.table_name}`) ?? [];
    list.push(toColumn(row));
    columnsByRelation.set(`${row.schema}.${row.table_name}`, list);
  }

  const constraintsByRelation = groupNamedSql(constraints.rows);
  const indexesByRelation = groupNamedSql(indexes.rows);
  const triggersByRelation = groupNamedSql(triggers.rows);

  return {
    extensions: extensions.rows,
    schemas: schemas.rows.map((row) => row.name),
    enums: enums.rows.map(toEnum),
    relations: relations.rows.map((row) => {
      const key = `${row.schema}.${row.name}`;
      const relation: SnapshotRelation = {
        schema: row.schema,
        name: row.name,
        kind: RELATION_KINDS[row.relkind] ?? "table",
        unlogged: row.relpersistence === "u",
        columns: columnsByRelation.get(key) ?? [],
        constraints: constraintsByRelation.get(key) ?? [],
        indexes: indexesByRelation.get(key) ?? [],
        triggers: triggersByRelation.get(key) ?? [],
      };
      if (row.viewdef) relation.viewSql = row.viewdef.trim().replace(/;$/, "");
      if (row.partition_by) relation.partitionBy = row.partition_by;
      if (row.partition_bound && row.parent_schema && row.parent_name) {
        relation.partitionOf = {
          parent: { schema: row.parent_schema, name: row.parent_name },
          bound: row.partition_bound,
        };
      }
      return relation;
    }),
    functions: functions.rows.map(toFunction),
  };
}

function groupNamedSql(rows: NamedSqlRow[]): Map<string, SnapshotNamedSql[]> {
  const groups = new Map<string, SnapshotNamedSql[]>();
  for (const row of rows) {
    const key = relationKey({ schema: row.schema, name: row.table_name });
    const list = groups.get(key) ?? [];
    list.push({ name: row.name, sql: row.sql });
    groups.set(key, list);
  }
  return groups;
}

function toColumn(row: ColumnRow): SnapshotColumn {
  const generated = row.attgenerated !== "" ? (row.default_expr ?? null) : null;
  return {
    name: row.name,
    type: row.type,
    nullable: row.nullable,
    default: generated === null ? row.default_expr : null,
    identity: row.attidentity === "a" ? "ALWAYS" : row.attidentity === "d" ? "BY DEFAULT" : null,
    generated,
    collation: row.collation,
  };
}

function toEnum(row: EnumRow): SnapshotEnum {
  return { schema: row.schema, name: row.name, labels: row.labels ?? [] };
}

function toFunction(row: FunctionRow): SnapshotFunction {
  return {
    schema: row.schema,
    name: row.name,
    args: row.args ?? "",
    kind: row.prokind === "p" ? "procedure" : "function",
    sql: row.sql.trim(),
  };
}
