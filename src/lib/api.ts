import type {
  CellUpdate,
  CellUpdateResult,
  LookupQuery,
  RelatedLookup,
  RelatedResult,
  RowDelete,
  RowDeleteResult,
  RowsQuery,
  RowsResult,
  TableDefinition,
  TableInfo,
  TableRef,
} from "./types";

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? response.statusText);
  return data as T;
}

export const api = {
  tables: (connectionUrl: string, signal?: AbortSignal) =>
    post<TableInfo[]>("/api/tables", { connectionUrl }, signal),

  rows: (connectionUrl: string, query: RowsQuery, signal?: AbortSignal) =>
    post<RowsResult>("/api/rows", { connectionUrl, query }, signal),

  updateCell: (connectionUrl: string, update: CellUpdate, signal?: AbortSignal) =>
    post<CellUpdateResult>("/api/cell", { connectionUrl, update }, signal),

  deleteRows: (connectionUrl: string, deletion: RowDelete, signal?: AbortSignal) =>
    post<RowDeleteResult>("/api/delete-rows", { connectionUrl, deletion }, signal),

  related: (connectionUrl: string, lookups: RelatedLookup[], signal?: AbortSignal) =>
    post<RelatedResult[]>("/api/related", { connectionUrl, lookups }, signal),

  lookup: (connectionUrl: string, query: LookupQuery, signal?: AbortSignal) =>
    post<RowsResult>("/api/lookup", { connectionUrl, query }, signal),

  definition: (connectionUrl: string, table: TableRef, signal?: AbortSignal) =>
    post<TableDefinition>("/api/definition", { connectionUrl, table }, signal),
};
