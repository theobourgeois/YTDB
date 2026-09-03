import type {
  CellUpdate,
  CellUpdateResult,
  LookupQuery,
  RelatedLookup,
  RelatedResult,
  RowDelete,
  RowDeleteResult,
  RowInsert,
  RowInsertResult,
  RowsQuery,
  RowsResult,
  SqlQueryResult,
  TableDefinition,
  TableInfo,
  TableRef,
} from "./types";
import { bridgeFetch } from "./bridge";

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await bridgeFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const text = await response.text();
  if (!text) {
    throw new Error(
      `YTDB bridge returned an empty response (HTTP ${response.status}). Restart YTDB to update the local bridge.`,
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`YTDB bridge returned an invalid response (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const error =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : response.statusText;
    throw new Error(error || `YTDB bridge request failed with HTTP ${response.status}.`);
  }
  return data as T;
}

export const api = {
  tables: (connectionUrl: string, signal?: AbortSignal) =>
    post<TableInfo[]>("/api/tables", { connectionUrl }, signal),

  rows: (connectionUrl: string, query: RowsQuery, signal?: AbortSignal) =>
    post<RowsResult>("/api/rows", { connectionUrl, query }, signal),

  query: (connectionUrl: string, sql: string, signal?: AbortSignal) =>
    post<SqlQueryResult>("/api/query", { connectionUrl, sql }, signal),

  updateCell: (connectionUrl: string, update: CellUpdate, signal?: AbortSignal) =>
    post<CellUpdateResult>("/api/cell", { connectionUrl, update }, signal),

  insertRow: (connectionUrl: string, insertion: RowInsert, signal?: AbortSignal) =>
    post<RowInsertResult>("/api/insert-row", { connectionUrl, insertion }, signal),

  deleteRows: (connectionUrl: string, deletion: RowDelete, signal?: AbortSignal) =>
    post<RowDeleteResult>("/api/delete-rows", { connectionUrl, deletion }, signal),

  related: (connectionUrl: string, lookups: RelatedLookup[], signal?: AbortSignal) =>
    post<RelatedResult[]>("/api/related", { connectionUrl, lookups }, signal),

  lookup: (connectionUrl: string, query: LookupQuery, signal?: AbortSignal) =>
    post<RowsResult>("/api/lookup", { connectionUrl, query }, signal),

  definition: (connectionUrl: string, table: TableRef, signal?: AbortSignal) =>
    post<TableDefinition>("/api/definition", { connectionUrl, table }, signal),
};
