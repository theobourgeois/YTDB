import type { MigrationRunRecord } from "../store/migrations";
import type { Connection } from "../types";
import type { LedgerResult } from "./types";

export type HistoryKind = "applied" | "reverted" | "marked" | "unmarked" | "failed";

export type HistoryEvent = {
  id: string;
  connectionId: string;
  connectionName: string;
  version: string;
  name: string;
  /** Milliseconds since the epoch, for ordering. */
  at: number;
  kind: HistoryKind;
  durationMs: number | null;
  error?: string;
  setName?: string | null;
  /** The PostgreSQL role that applied it, when the ledger knows. */
  appliedBy?: string | null;
  /**
   * True when this came from the database's own ledger rather than this browser —
   * which is how a run from another machine, or another browser, still shows up.
   */
  fromLedger: boolean;
};

export type HistorySource = {
  connection: Connection;
  ledger: LedgerResult | null;
};

function kindOf(record: MigrationRunRecord): HistoryKind {
  if (record.status === "failed") return "failed";
  if (record.recorded) return record.direction === "apply" ? "marked" : "unmarked";
  return record.direction === "apply" ? "applied" : "reverted";
}

function timeOf(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Everything known to have happened to these databases, newest first.
 *
 * Two records are folded together here. Each database's ledger says what it has
 * applied and when — durable, shared, and the only source that sees a run made
 * from someone else's machine. This browser's own log adds what the ledger cannot
 * keep: reverts, failures, and rows written without running anything.
 *
 * A run recorded in both is one event, not two: the local record wins, since it
 * knows whether SQL actually ran, and takes the role from the ledger row.
 */
export function buildHistory(
  sources: HistorySource[],
  records: MigrationRunRecord[],
): HistoryEvent[] {
  const scope = new Map(sources.map((source) => [source.connection.id, source]));

  const local = records
    .filter((record) => scope.has(record.connectionId))
    .map((record): HistoryEvent => ({
      id: record.id,
      connectionId: record.connectionId,
      connectionName: record.connectionName,
      version: record.version,
      name: record.name,
      at: record.ranAt,
      kind: kindOf(record),
      durationMs: record.durationMs,
      error: record.error,
      setName: record.setName,
      fromLedger: false,
    }));

  /** The newest thing this browser saw happen to one migration on one database. */
  const newestLocal = new Map<string, HistoryEvent>();
  for (const event of local) {
    const key = `${event.connectionId}:${event.version}`;
    const current = newestLocal.get(key);
    if (!current || event.at > current.at) newestLocal.set(key, event);
  }

  const events = [...local];

  for (const source of sources) {
    for (const entry of source.ledger?.entries ?? []) {
      const key = `${source.connection.id}:${entry.version}`;
      const seen = newestLocal.get(key);
      // Already accounted for locally, so only the role is missing from it.
      if (seen && (seen.kind === "applied" || seen.kind === "marked")) {
        seen.appliedBy = entry.appliedBy;
        continue;
      }
      events.push({
        id: `ledger:${source.connection.id}:${entry.version}`,
        connectionId: source.connection.id,
        connectionName: source.connection.name,
        version: entry.version,
        name: entry.name || entry.version,
        at: timeOf(entry.appliedAt),
        kind: "applied",
        durationMs: entry.durationMs,
        setName: entry.setName,
        appliedBy: entry.appliedBy,
        fromLedger: true,
      });
    }
  }

  return events.sort((a, b) => b.at - a.at);
}
