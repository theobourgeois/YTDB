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

export type CellUpdate = {
  table: TableRef;
  column: string;
  primaryKey: Record<string, Cell>;
  value: Cell;
};

export type CellUpdateResult = {
  row: Cell[];
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
