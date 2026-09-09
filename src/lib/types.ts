export type Connection = {
  id: string;
  name: string;
  url: string;
  color?: string;
  /** Connections with the same group share layout (pins, columns, schemas). */
  layoutGroup?: string;
};

export type TableRef = {
  schema: string;
  name: string;
};

export type ColumnInfo = {
  name: string;
  type: string;
  dataType: string;
  typeCategory: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isGenerated: boolean;
  isIdentity: boolean;
  hasDefault: boolean;
  /** Rendered default expression, when the column has one. */
  defaultExpression?: string;
  enumValues?: string[];
};

export type ForeignKey = {
  name: string;
  columns: string[];
  referencedTable: TableRef;
  referencedColumns: string[];
};

export type IncomingForeignKey = {
  name: string;
  table: TableRef;
  columns: string[];
  referencedColumns: string[];
};

export type TableInfo = TableRef & {
  kind: "table" | "view";
  columns: ColumnInfo[];
  foreignKeys: ForeignKey[];
  referencedBy: IncomingForeignKey[];
};

export type FilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like"
  | "ilike"
  | "is_null"
  | "is_not_null";

export type Filter = {
  id: string;
  column: string;
  operator: FilterOperator;
  value: string;
  /**
   * Display-only caption for `value`, set when a foreign-key value was chosen by
   * label rather than typed. Never affects the query: a stale label still filters
   * on the right key.
   */
  label?: string;
};

export type Sort = {
  column: string;
  direction: "asc" | "desc";
};

export type Cell = string | number | boolean | null;

export type RowsQuery = {
  table: TableRef;
  filters: Filter[];
  search?: string;
  sort: Sort | null;
  page: number;
  pageSize: number;
};

export type RowsResult = {
  columns: string[];
  rows: Cell[][];
  /** Null when a precise total would require scanning a large table. */
  total: number | null;
  estimated: boolean;
  hasMore: boolean;
  /** True when more rows exist past the OFFSET cap. */
  capped?: boolean;
};

export type SqlStatementResult = {
  command: string;
  columns: string[];
  rows: Cell[][];
  rowCount: number | null;
  truncated: boolean;
};

export type SqlQueryResult = {
  statements: SqlStatementResult[];
  durationMs: number;
};

export type CellUpdate = {
  table: TableRef;
  column: string;
  primaryKey: Record<string, Cell>;
  value: Cell;
};

export type CellUpdateResult = {
  row: Cell[];
};

export type RowInsert = {
  table: TableRef;
  /** Only the columns present are written; the rest take their database default. */
  values: Record<string, Cell>;
};

export type RowInsertResult = {
  /** The inserted row, in the table's column order. */
  row: Cell[];
};

export type RowUpdate = {
  table: TableRef;
  primaryKey: Record<string, Cell>;
  /** Only the columns present are written; the rest keep the value they had. */
  values: Record<string, Cell>;
  /** Columns reset to their database default rather than given a value. */
  defaults?: string[];
};

export type RowUpdateResult = {
  /** The row after the update, in the table's column order. */
  row: Cell[];
  /** How many columns the statement assigned. */
  updated: number;
};

export type RowDelete = {
  table: TableRef;
  primaryKeys: Record<string, Cell>[];
};

export type RowDeleteResult = {
  deleted: number;
};

export type RelatedLookup = {
  table: TableRef;
  keyColumns: string[];
  keys: Cell[][];
};

export type RelatedMatch = {
  key: Cell[];
  row: Cell[];
};

export type RelatedResult = {
  table: TableRef;
  columns: string[];
  rows: RelatedMatch[];
};

export type LookupQuery = {
  table: TableRef;
  search: string;
  limit?: number;
};

export type TableDefinition = {
  sql: string;
};

export function tableKey(table: TableRef): string {
  return `${table.schema}.${table.name}`;
}

/** What a relation is, for schema comparison. */
export type RelationKind = "table" | "view" | "materialized view" | "foreign table";

export type SnapshotColumn = {
  name: string;
  type: string;
  nullable: boolean;
  /** Rendered DEFAULT expression, or null. Never set on generated columns. */
  default: string | null;
  identity: "ALWAYS" | "BY DEFAULT" | null;
  /** Generation expression of a stored generated column. */
  generated: string | null;
  collation: string | null;
};

/** A constraint, index, or trigger, keyed by name and compared by its DDL. */
export type SnapshotNamedSql = {
  name: string;
  sql: string;
};

export type SnapshotRelation = {
  schema: string;
  name: string;
  kind: RelationKind;
  unlogged: boolean;
  columns: SnapshotColumn[];
  constraints: SnapshotNamedSql[];
  indexes: SnapshotNamedSql[];
  triggers: SnapshotNamedSql[];
  /** Body of a view or materialized view. */
  viewSql?: string;
  partitionBy?: string;
  /** Qualified parent table of a partition, with its bound. */
  partitionOf?: { parent: TableRef; bound: string };
};

export type SnapshotEnum = {
  schema: string;
  name: string;
  labels: string[];
};

export type SnapshotExtension = {
  name: string;
  version: string;
  schema: string;
};

export type SnapshotFunction = {
  schema: string;
  name: string;
  /** Identity arguments, which together with the name make the function unique. */
  args: string;
  kind: "function" | "procedure";
  sql: string;
};

/** Everything about a database's structure that schema comparison looks at. */
export type SchemaSnapshot = {
  extensions: SnapshotExtension[];
  schemas: string[];
  enums: SnapshotEnum[];
  relations: SnapshotRelation[];
  functions: SnapshotFunction[];
};

export function relationKey(relation: { schema: string; name: string }): string {
  return `${relation.schema}.${relation.name}`;
}
