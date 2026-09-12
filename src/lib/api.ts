import type { DetectionResult } from "./migrations/detect";
import type {
  AdoptRequest,
  AdoptResult,
  LedgerResult,
  MigrationRequest,
  MigrationResult,
  NoteResult,
  RehearsalRequest,
  RehearsalResult,
  RepoRead,
} from "./migrations/types";
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
  RowUpdate,
  RowUpdateResult,
  RowsQuery,
  RowsResult,
  SchemaSnapshot,
  SqlQueryResult,
  TableDefinition,
  TableInfo,
  TableRef,
} from "./types";
import { bridgeFetch } from "./bridge";
import type { ReconcileReport, ResolveRequest, TimelinePage, TimelineQuery, TimelineDetail } from "./migrations/timeline";

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
    // A route the bridge has never heard of comes back as Next's HTML 404: the
    // YTDB on this machine predates the page asking, and the fix is to restart it.
    if (response.status === 404) {
      throw new Error(
        "The YTDB running on your machine is older than this page and does not know this request. Restart it with `npx @theobourgeois/ytdb@latest`.",
      );
    }
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
  timeline: (connectionUrl: string, ledgerSchema: string, query: TimelineQuery, signal?: AbortSignal) =>
    post<TimelinePage>("/api/timeline", { connectionUrl, ledgerSchema, query }, signal),

  timelineDetail: (connectionUrl: string, ledgerSchema: string, eventId: string, signal?: AbortSignal) =>
    post<TimelineDetail>("/api/timeline", { connectionUrl, ledgerSchema, eventId }, signal),
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

  updateRow: (connectionUrl: string, update: RowUpdate, signal?: AbortSignal) =>
    post<RowUpdateResult>("/api/update-row", { connectionUrl, update }, signal),

  deleteRows: (connectionUrl: string, deletion: RowDelete, signal?: AbortSignal) =>
    post<RowDeleteResult>("/api/delete-rows", { connectionUrl, deletion }, signal),

  related: (connectionUrl: string, lookups: RelatedLookup[], signal?: AbortSignal) =>
    post<RelatedResult[]>("/api/related", { connectionUrl, lookups }, signal),

  lookup: (connectionUrl: string, query: LookupQuery, signal?: AbortSignal) =>
    post<RowsResult>("/api/lookup", { connectionUrl, query }, signal),

  definition: (connectionUrl: string, table: TableRef, signal?: AbortSignal) =>
    post<TableDefinition>("/api/definition", { connectionUrl, table }, signal),

  schema: (connectionUrl: string, signal?: AbortSignal) =>
    post<SchemaSnapshot>("/api/schema", { connectionUrl }, signal),

  ledger: (
    connectionUrl: string,
    ledgerSchema: string,
    signal?: AbortSignal,
    withSql = false,
  ) => post<LedgerResult>("/api/ledger", { connectionUrl, ledgerSchema, withSql }, signal),

  migrate: (connectionUrl: string, migration: MigrationRequest, signal?: AbortSignal) =>
    post<MigrationResult>("/api/migrate", { connectionUrl, migration }, signal),

  adopt: (connectionUrl: string, adopt: AdoptRequest, signal?: AbortSignal) =>
    post<AdoptResult>("/api/adopt", { connectionUrl, adopt }, signal),

  /** Runs migrations in one transaction and rolls it back: a dry run. */
  rehearse: (connectionUrl: string, rehearsal: RehearsalRequest, signal?: AbortSignal) =>
    post<RehearsalResult>("/api/rehearse", { connectionUrl, rehearsal }, signal),

  /** What the database says about a run with no confirmed outcome. */
  reconcile: (connectionUrl: string, ledgerSchema: string, eventId: string, signal?: AbortSignal) =>
    post<ReconcileReport>("/api/reconcile", { connectionUrl, ledgerSchema, eventId }, signal),

  /** Settles an unconfirmed run on the word of whoever checked the database. */
  resolve: (connectionUrl: string, ledgerSchema: string, request: ResolveRequest, signal?: AbortSignal) =>
    post<{ resolved: true }>("/api/reconcile", { connectionUrl, ledgerSchema, ...request }, signal),

  /** Checks the catalog for what each migration would have left behind. */
  detect: (
    connectionUrl: string,
    migrations: { setName: string; version: string; sql: string }[],
    signal?: AbortSignal,
  ) => post<{ results: DetectionResult[] }>("/api/detect", { connectionUrl, migrations }, signal),

  /** Reads a migrations folder from the machine the bridge runs on. */
  repo: (root: string, checkout: string | null, signal?: AbortSignal) =>
    post<RepoRead>("/api/repo", { root, checkout }, signal),

  /** Writes a folder migration's note beside its SQL; an empty note removes the file. */
  note: (root: string, path: string, note: string, signal?: AbortSignal) =>
    post<NoteResult>("/api/note", { root, path, note }, signal),
};
