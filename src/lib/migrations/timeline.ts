import type { DetectionResult } from "./detect";
import type { MigrationDirection } from "./types";

export const TIMELINE_KINDS = ["applied", "reverted", "marked", "unmarked", "failed", "uncertain", "legacy"] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

export type TimelineEvent = {
  id: string;
  sequence: string;
  setName: string;
  version: string;
  name: string;
  direction: MigrationDirection;
  kind: TimelineKind;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  appliedBy: string | null;
  revisionId: string | null;
  atomic: boolean;
  error: string | null;
};

export type TimelineQuery = {
  before?: string;
  setName?: string;
  query?: string;
  kind?: TimelineKind;
};

export type TimelinePage = {
  initialized: boolean;
  schema: string;
  events: TimelineEvent[];
  nextCursor: string | null;
};

export type TimelineDetail = {
  sql: string | null;
  revertSql: string | null;
  previousSql: string | null;
  previousAt: string | null;
};

/**
 * What can be found out about a run with no confirmed outcome. An event stays
 * unconfirmed only while its finish has not committed — and the ledger row is
 * written in that same commit — so the question is never whether the ledger is
 * right, only whether the SQL left anything behind.
 */
export type ReconcileReport = {
  event: TimelineEvent;
  /** A session on this database is still executing this run's SQL. */
  running: { state: string; since: string | null } | null;
  /** What the catalog says about the SQL that ran; null when the SQL was not kept. */
  detection: DetectionResult | null;
};

/** What the person looking at the database concluded. */
export type ResolveOutcome = "landed" | "lost";

export type ResolveRequest = {
  eventId: string;
  outcome: ResolveOutcome;
  /** The file's fingerprint, when the page has the file, so the row is not flagged as drifted. */
  checksum?: string;
};
