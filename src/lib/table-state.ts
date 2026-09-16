import { isFilterComplete } from "./filters";
import type { Filter, Sort } from "./types";

export type TableQueryScope = {
  filters: Filter[];
  search: string;
  sort: Sort | null;
};

function isScoped(state: Pick<TableQueryScope, "filters" | "search">): boolean {
  return state.filters.some(isFilterComplete) || state.search.trim().length > 0;
}

/**
 * A sort that was cheap on a filtered page (creator_id = …, created_at DESC)
 * becomes a full-table sort once the filter is gone. Drop it unless this patch
 * is itself setting the sort — that's an explicit click on a column header.
 */
export function dropSortWhenUnscoped<T extends TableQueryScope>(
  current: T,
  patch: Partial<T>,
): Partial<T> {
  if (Object.prototype.hasOwnProperty.call(patch, "sort")) return patch;
  const next = {
    filters: patch.filters ?? current.filters,
    search: patch.search ?? current.search,
  };
  if (isScoped(current) && !isScoped(next)) return { ...patch, sort: null };
  return patch;
}
