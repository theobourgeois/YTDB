import type { ColumnInfo } from "./types";

export function resolvePinnedColumns(
  pinnedColumns: string[] | undefined,
  columns: ColumnInfo[],
): string[] {
  const known = new Set(columns.map((column) => column.name));
  if (pinnedColumns) return pinnedColumns.filter((column) => known.has(column));
  return columns.filter((column) => column.isPrimaryKey).map((column) => column.name);
}

export function displayColumns(
  columns: string[],
  pinnedColumns: string[] = [],
  hiddenColumns: string[] = [],
): string[] {
  const hidden = new Set(hiddenColumns);
  const visible = columns.filter((column) => !hidden.has(column));
  const visibleSet = new Set(visible);
  const pinned = pinnedColumns.filter((column) => visibleSet.has(column));
  const pinnedSet = new Set(pinned);
  return [...pinned, ...visible.filter((column) => !pinnedSet.has(column))];
}

export function togglePinnedColumn(pinnedColumns: string[] = [], column: string): string[] {
  return pinnedColumns.includes(column)
    ? pinnedColumns.filter((item) => item !== column)
    : [...pinnedColumns, column];
}

export function toggleHiddenColumn(
  hiddenColumns: string[] = [],
  column: string,
  columnCount: number,
): string[] {
  if (hiddenColumns.includes(column)) {
    return hiddenColumns.filter((item) => item !== column);
  }
  if (hiddenColumns.length >= columnCount - 1) return hiddenColumns;
  return [...hiddenColumns, column];
}
