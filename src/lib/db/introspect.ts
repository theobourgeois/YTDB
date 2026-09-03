import "server-only";
import { getPool } from "./pool";
import { tableKey, type ColumnInfo, type TableInfo } from "../types";

const HIDDEN_SCHEMAS = ["pg_catalog", "information_schema", "pg_toast"];

const TABLES_SQL = `
  SELECT n.nspname AS schema, c.relname AS name, c.relkind AS relkind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND n.nspname <> ALL($1)
    AND n.nspname NOT LIKE 'pg_temp%'
  ORDER BY n.nspname, c.relname
`;

const COLUMNS_SQL = `
  SELECT n.nspname AS schema,
         c.relname AS table,
         a.attname AS name,
         format_type(a.atttypid, a.atttypmod) AS type,
         COALESCE(base_type.typname, t.typname) AS data_type,
         COALESCE(base_type.typcategory, t.typcategory) AS type_category,
         NOT a.attnotnull AS nullable,
         a.attgenerated <> '' AS is_generated,
         a.attidentity <> '' AS is_identity,
         a.atthasdef AS has_default,
         pg_get_expr(ad.adbin, ad.adrelid) AS default_expression,
         enum_values.labels AS enum_values,
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
  LEFT JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
  LEFT JOIN LATERAL (
    SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
    FROM pg_enum e
    WHERE e.enumtypid = CASE WHEN t.typtype = 'd' THEN t.typbasetype ELSE t.oid END
  ) enum_values ON TRUE
  WHERE a.attnum > 0
    AND NOT a.attisdropped
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND n.nspname <> ALL($1)
    AND n.nspname NOT LIKE 'pg_temp%'
  ORDER BY n.nspname, c.relname, a.attnum
`;

const FOREIGN_KEYS_SQL = `
  SELECT n.nspname AS schema,
         c.relname AS table_name,
         con.conname AS name,
         src.cols AS columns,
         fn.nspname AS foreign_schema,
         fc.relname AS foreign_table,
         dst.cols AS foreign_columns
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_class fc ON fc.oid = con.confrelid
  JOIN pg_namespace fn ON fn.oid = fc.relnamespace
  JOIN LATERAL (
    SELECT array_agg(a.attname ORDER BY u.ord) AS cols
    FROM unnest(con.conkey) WITH ORDINALITY AS u(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = u.attnum
  ) src ON TRUE
  JOIN LATERAL (
    SELECT array_agg(a.attname ORDER BY u.ord) AS cols
    FROM unnest(con.confkey) WITH ORDINALITY AS u(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = u.attnum
  ) dst ON TRUE
  WHERE con.contype = 'f'
    AND n.nspname <> ALL($1)
    AND n.nspname NOT LIKE 'pg_temp%'
    AND fn.nspname <> ALL($1)
    AND fn.nspname NOT LIKE 'pg_temp%'
`;

type TableRow = { schema: string; name: string; relkind: string };
type ColumnRow = {
  schema: string;
  table: string;
  name: string;
  type: string;
  data_type: string;
  type_category: string;
  nullable: boolean;
  is_generated: boolean;
  is_identity: boolean;
  has_default: boolean;
  default_expression: string | null;
  is_pk: boolean;
  enum_values: string[] | null;
};
type ForeignKeyRow = {
  schema: string;
  table_name: string;
  name: string;
  columns: string[];
  foreign_schema: string;
  foreign_table: string;
  foreign_columns: string[];
};

export async function listTables(connectionString: string): Promise<TableInfo[]> {
  const pool = getPool(connectionString);
  const [tables, columns, foreignKeys] = await Promise.all([
    pool.query<TableRow>(TABLES_SQL, [HIDDEN_SCHEMAS]),
    pool.query<ColumnRow>(COLUMNS_SQL, [HIDDEN_SCHEMAS]),
    pool.query<ForeignKeyRow>(FOREIGN_KEYS_SQL, [HIDDEN_SCHEMAS]),
  ]);

  const columnsByTable = new Map<string, ColumnInfo[]>();
  for (const row of columns.rows) {
    const key = `${row.schema}.${row.table}`;
    const list = columnsByTable.get(key) ?? [];
    list.push({
      name: row.name,
      type: row.type,
      dataType: row.data_type,
      typeCategory: row.type_category,
      nullable: row.nullable,
      isPrimaryKey: row.is_pk,
      isGenerated: row.is_generated,
      isIdentity: row.is_identity,
      hasDefault: row.has_default || row.is_identity,
      ...(row.default_expression ? { defaultExpression: row.default_expression } : {}),
      ...(row.enum_values?.length ? { enumValues: row.enum_values } : {}),
    });
    columnsByTable.set(key, list);
  }

  const result: TableInfo[] = tables.rows.map((row) => ({
    schema: row.schema,
    name: row.name,
    kind: row.relkind === "r" || row.relkind === "p" ? "table" : "view",
    columns: columnsByTable.get(`${row.schema}.${row.name}`) ?? [],
    foreignKeys: [],
    referencedBy: [],
  }));
  const tablesByKey = new Map(result.map((table) => [tableKey(table), table]));

  for (const row of foreignKeys.rows) {
    const columns = asStringArray(row.columns);
    const referencedColumns = asStringArray(row.foreign_columns);
    if (columns.length === 0 || columns.length !== referencedColumns.length) continue;
    const source = tablesByKey.get(`${row.schema}.${row.table_name}`);
    const referenced = tablesByKey.get(`${row.foreign_schema}.${row.foreign_table}`);
    if (!source || !referenced) continue;

    source.foreignKeys.push({
      name: row.name,
      columns,
      referencedTable: { schema: referenced.schema, name: referenced.name },
      referencedColumns,
    });
    referenced.referencedBy.push({
      name: row.name,
      table: { schema: source.schema, name: source.name },
      columns,
      referencedColumns,
    });
  }

  inferForeignKeys(result);
  return result;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  }
  if (typeof value !== "string" || value.length === 0) return [];
  const inner = value.replace(/^\{|\}$/g, "");
  if (!inner) return [];
  return inner
    .split(",")
    .map((item) => item.replace(/^"|"$/g, "").trim())
    .filter(Boolean);
}

const INTEGER_TYPES = new Set(["int2", "int4", "int8", "oid"]);
const UUID_LIKE_TYPES = new Set(["uuid", "text", "varchar", "bpchar", "citext"]);

function typesCompatible(left: string, right: string): boolean {
  if (left === right) return true;
  if (INTEGER_TYPES.has(left) && INTEGER_TYPES.has(right)) return true;
  if (UUID_LIKE_TYPES.has(left) && UUID_LIKE_TYPES.has(right)) return true;
  return false;
}

function nameCandidates(base: string): string[] {
  const names = new Set([base, `${base}s`]);
  if (base.endsWith("s") && base.length > 1) names.add(base.slice(0, -1));
  if (base.endsWith("y") && base.length > 1 && !/[aeiou]y$/i.test(base)) {
    names.add(`${base.slice(0, -1)}ies`);
  }
  if (base.endsWith("ies") && base.length > 3) names.add(`${base.slice(0, -3)}y`);
  return [...names];
}

function primaryKeyColumn(table: TableInfo): ColumnInfo | null {
  const keys = table.columns.filter((column) => column.isPrimaryKey);
  return keys.length === 1 ? keys[0] : null;
}

function inferForeignKeys(tables: TableInfo[]): void {
  for (const table of tables) {
    const declared = new Set(table.foreignKeys.flatMap((fk) => fk.columns));
    for (const column of table.columns) {
      if (declared.has(column.name)) continue;
      if (!column.name.endsWith("_id") || column.name === "id") continue;
      const candidates = nameCandidates(column.name.slice(0, -3));
      const matches = tables.filter((candidate) => {
        if (!candidates.includes(candidate.name)) return false;
        const pk = primaryKeyColumn(candidate);
        return pk !== null && typesCompatible(column.dataType, pk.dataType);
      });
      const sameSchema = matches.filter((candidate) => candidate.schema === table.schema);
      const match = sameSchema.length === 1 ? sameSchema[0] : matches.length === 1 ? matches[0] : null;
      if (!match) continue;
      const pk = primaryKeyColumn(match);
      if (!pk) continue;

      const name = `inferred:${tableKey(table)}.${column.name}`;
      table.foreignKeys.push({
        name,
        columns: [column.name],
        referencedTable: { schema: match.schema, name: match.name },
        referencedColumns: [pk.name],
      });
      match.referencedBy.push({
        name,
        table: { schema: table.schema, name: table.name },
        columns: [column.name],
        referencedColumns: [pk.name],
      });
    }
  }
}
