"use client";

import { CheckIcon, ClipboardCheckIcon, ClipboardXIcon, UndoIcon, XIcon } from "@/components/icons";
import { ConnectionColorMark } from "@/components/connections/connection-color";
import { Button } from "@/components/ui/button";
import type { HistoryEvent, HistoryKind } from "@/lib/migrations/history";
import { useMigrations } from "@/lib/store/migrations";
import type { Connection } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  events: HistoryEvent[];
  connections: Connection[];
  /** True while the ledgers are still being read, so an empty list is not yet news. */
  loading: boolean;
};

const LABEL: Record<HistoryKind, string> = {
  applied: "applied",
  reverted: "reverted",
  marked: "marked",
  unmarked: "unmarked",
  failed: "failed",
};

function KindIcon({ kind }: { kind: HistoryKind }) {
  switch (kind) {
    case "failed":
      return <XIcon className="size-3.5 shrink-0 text-destructive" />;
    case "reverted":
      return <UndoIcon className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />;
    case "marked":
      return <ClipboardCheckIcon className="size-3.5 shrink-0 text-muted-foreground" />;
    case "unmarked":
      return <ClipboardXIcon className="size-3.5 shrink-0 text-muted-foreground" />;
    default:
      return <CheckIcon className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />;
  }
}

function Row({ event, connection }: { event: HistoryEvent; connection: Connection | undefined }) {
  return (
    <div className="flex items-start gap-2 border-b px-4 py-2 text-xs last:border-b-0">
      <span className="mt-0.5">
        <KindIcon kind={event.kind} />
      </span>
      <span
        className={cn(
          "mt-px shrink-0 rounded-md px-1.5 text-[11px]",
          event.kind === "failed"
            ? "bg-destructive/10 text-destructive"
            : event.kind === "reverted"
              ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
              : "bg-muted text-muted-foreground",
        )}
      >
        {LABEL[event.kind]}
      </span>
      <span className="shrink-0 font-mono text-muted-foreground">{event.version}</span>
      <span className="min-w-0 flex-1">
        <span className="truncate">{event.name}</span>
        {event.error && (
          <span className="mt-1 block font-mono text-[11px] whitespace-pre-wrap text-destructive">
            {event.error}
          </span>
        )}
      </span>
      {event.setName && (
        <span className="hidden max-w-32 shrink-0 truncate text-muted-foreground/60 lg:inline">
          {event.setName}
        </span>
      )}
      <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
        {connection && <ConnectionColorMark connection={connection} className="size-1.5" />}
        {event.connectionName}
      </span>
      {event.appliedBy && (
        <span className="hidden shrink-0 text-muted-foreground/60 xl:inline">{event.appliedBy}</span>
      )}
      <span className="shrink-0 tabular-nums text-muted-foreground/70">
        {event.durationMs === null ? "" : `${event.durationMs} ms`}
      </span>
      <span
        className="shrink-0 text-muted-foreground/70"
        title={
          event.fromLedger
            ? "Read from the database's own ledger"
            : "Run from this browser"
        }
      >
        {new Date(event.at).toLocaleString()}
      </span>
    </div>
  );
}

/**
 * What has happened to these databases: the ledger each one keeps, plus the
 * reverts, failures and marks only this browser saw.
 */
export function MigrationHistory({ events, connections, loading }: Props) {
  const clearHistory = useMigrations((state) => state.clearHistory);
  const byId = new Map(connections.map((item) => [item.id, item]));
  const local = events.filter((event) => !event.fromLedger).length;

  if (events.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">
        {loading ? "Reading ledgers…" : "Nothing has run yet."}
      </p>
    );
  }

  return (
    <div>
      {events.map((event) => (
        <Row key={event.id} event={event} connection={byId.get(event.connectionId)} />
      ))}
      {local > 0 && (
        <div className="flex justify-end px-3 py-2">
          <Button
            size="xs"
            variant="ghost"
            className="text-muted-foreground"
            title="Clears this browser's log. The databases' ledgers are untouched."
            onClick={() => clearHistory()}
          >
            Clear local log
          </Button>
        </div>
      )}
    </div>
  );
}
