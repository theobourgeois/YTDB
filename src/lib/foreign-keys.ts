import { newFilter } from "./filters";
import {
  tableKey,
  type Cell,
  type ColumnInfo,
  type Filter,
  type ForeignKey,
  type RelatedLookup,
  type RelatedResult,
  type TableInfo,
  type TableRef,
} from "./types";

const LABEL_NAMES = new Set([
  "name",
  "title",
  "label",
  "email",
  "username",
  "full_name",
  "display_name",
  "slug",
  "handle",
  "first_name",
]);

const STRING_TYPES = new Set(["text", "varchar", "bpchar", "citext", "name"]);

export type RelatedRows = Map<string, { columns: string[]; row: Cell[] }>;

export function findTable(tables: TableInfo[], table: TableRef): TableInfo | undefined {
  return tables.find((item) => item.schema === table.schema && item.name === table.name);
}

export function foreignKeyForColumn(
  table: TableInfo | undefined,
  column: string,
): ForeignKey | undefined {
  return table?.foreignKeys?.find((fk) => fk.columns.includes(column));
}

export function relatedCacheKey(table: TableRef, key: Cell[]): string {
  return `${tableKey(table)}:${JSON.stringify(key.map((value) => (value === null ? null : String(value))))}`;
}

export function keyValuesForForeignKey(
  fk: ForeignKey,
  columns: string[],
  row: Cell[],
): Cell[] | null {
  const values = fk.columns.map((column) => {
    const index = columns.indexOf(column);
    return index >= 0 ? (row[index] ?? null) : null;
  });
  if (values.some((value) => value === null)) return null;
  return values;
}

export function displayColumnName(
  columns: ColumnInfo[],
  keyColumns: string[],
): string | null {
  const available = columns.filter((column) => !keyColumns.includes(column.name));
  const named = available.find((column) => LABEL_NAMES.has(column.name.toLocaleLowerCase()));
  if (named) return named.name;
  const text = available.find(
    (column) => column.typeCategory === "S" || STRING_TYPES.has(column.dataType),
  );
  return text?.name ?? available[0]?.name ?? null;
}

export function relatedLabel(
  columns: string[],
  row: Cell[],
  displayColumn: string | null,
): string | null {
  if (!displayColumn) return null;
  const index = columns.indexOf(displayColumn);
  if (index < 0) return null;
  const value = row[index];
  if (value === null || value === "") return null;
  const label = String(value);
  return label.trim() ? label : null;
}

export function filtersForKey(columns: string[], values: Cell[]): Filter[] {
  return columns.flatMap((column, index) => {
    const value = values[index];
    if (value === null) return [];
    return [{ ...newFilter(column), operator: "eq" as const, value: String(value) }];
  });
}

export function relatedLookupsForRows(
  table: TableInfo,
  columns: string[],
  rows: Cell[][],
): RelatedLookup[] {
  const lookups = new Map<string, RelatedLookup>();

  for (const fk of table.foreignKeys ?? []) {
    const indexes = fk.columns.map((column) => columns.indexOf(column));
    if (indexes.some((index) => index < 0)) continue;

    const id = `${tableKey(fk.referencedTable)}:${fk.referencedColumns.join("\0")}`;
    const lookup = lookups.get(id) ?? {
      table: fk.referencedTable,
      keyColumns: fk.referencedColumns,
      keys: [],
    };
    const seen = new Set(lookup.keys.map((key) => JSON.stringify(key)));

    for (const row of rows) {
      const key = indexes.map((index) => row[index] ?? null);
      if (key.some((value) => value === null)) continue;
      const serialized = JSON.stringify(key);
      if (seen.has(serialized)) continue;
      seen.add(serialized);
      lookup.keys.push(key);
      if (lookup.keys.length >= 500) break;
    }

    if (lookup.keys.length > 0) lookups.set(id, lookup);
  }

  return [...lookups.values()];
}

export function relatedRowsMap(results: RelatedResult[]): RelatedRows {
  const map: RelatedRows = new Map();
  for (const result of results) {
    for (const match of result.rows) {
      map.set(relatedCacheKey(result.table, match.key), {
        columns: result.columns,
        row: match.row,
      });
    }
  }
  return map;
}

export function tableHref(connectionId: string, table: TableRef): string {
  return `/${connectionId}/${encodeURIComponent(table.schema)}/${encodeURIComponent(table.name)}`;
}
