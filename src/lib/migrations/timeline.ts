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
