"use client";

import { useMemo, useState } from "react";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, ClipboardCheckIcon, ClipboardXIcon, EraserIcon, HistoryIcon, RefreshIcon, SpinnerIcon, UndoIcon, WarningIcon, XIcon } from "@/components/icons";
import { ConnectionColorMark } from "@/components/connections/connection-color";
import { SqlSource } from "@/components/sql/sql-source";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PaneToggle } from "@/components/ui/pane-toggle";
import { SearchField } from "@/components/ui/search-field";
import { useAsync } from "@/hooks/use-async";
import { api } from "@/lib/api";
import type { HistoryEvent } from "@/lib/migrations/history";
import { TIMELINE_KINDS, type TimelineEvent, type TimelineKind, type TimelineQuery } from "@/lib/migrations/timeline";
import { useMigrations } from "@/lib/store/migrations";
import type { Connection } from "@/lib/types";
import { cn } from "@/lib/utils";
import { SqlDiff } from "./sql-diff";
import { useTimeline } from "./use-timeline";

type Props = {
  events: HistoryEvent[];
  connections: Connection[];
  /** True while the ledgers are still being read, so an empty list is not yet news. */
  loading: boolean;
  ledgerSchema: string;
  setName?: string;
};

type Event = {
  id: string;
  connection: Connection;
  name: string;
  version: string;
  setName?: string | null;
  at: number;
  kind: TimelineKind;
  durationMs: number | null;
  appliedBy?: string | null;
  error?: string | null;
  shared?: TimelineEvent;
  source: "shared" | "browser" | "ledger";
};

const LABEL: Record<TimelineKind, string> = {
  applied: "Applied", reverted: "Reverted", marked: "Marked as applied",
  unmarked: "Marked as not applied", failed: "Failed", uncertain: "Unconfirmed", legacy: "Previously recorded",
};

function KindIcon({ kind }: { kind: TimelineKind }) {
  const className = "size-3.5 shrink-0";
  switch (kind) {
    case "failed": return <XIcon className={cn(className, "text-destructive")} />;
    case "uncertain": return <WarningIcon className={cn(className, "text-amber-600 dark:text-amber-400")} />;
    case "reverted": return <UndoIcon className={cn(className, "text-amber-600 dark:text-amber-400")} />;
    case "marked": return <ClipboardCheckIcon className={cn(className, "text-muted-foreground")} />;
    case "unmarked": return <ClipboardXIcon className={cn(className, "text-muted-foreground")} />;
    case "legacy": return <HistoryIcon className={cn(className, "text-muted-foreground")} />;
    default: return <CheckIcon className={cn(className, "text-emerald-600 dark:text-emerald-400")} />;
  }
}

/** What an outcome means, shown as a tooltip rather than as text in the list. */
function explain(event: Event): string | undefined {
  const notes: string[] = [];
  if (event.kind === "marked" || event.kind === "unmarked") notes.push("No SQL ran. Only the migration record changed.");
  if (event.kind === "legacy") notes.push("Preserved from the earlier ledger, which did not distinguish running from marking.");
  if (event.kind === "uncertain") notes.push("No confirmed outcome: it may still be running, or it was interrupted. Check the database before retrying.");
  if (event.kind === "failed" && event.shared?.atomic) notes.push("The transaction was rolled back.");
  if (event.shared && !event.shared.atomic && event.kind !== "legacy") notes.push("This SQL manages its own transactions, so a failure can leave changes applied.");
  if (event.source === "browser") notes.push("Stored in this browser only.");
  return notes.join(" ") || undefined;
}

function duration(ms: number | null) {
  if (ms === null) return null;
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function dayLabel(at: number) {
  const date = new Date(at);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";
  today.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function EventSql({ event, schema }: { event: Event; schema: string }) {
  const [pane, setPane] = useState<"sql" | "changes" | "revert">("sql");
  const details = useAsync(`timeline:${event.connection.id}:${schema}:${event.shared!.id}`, (signal) =>
    api.timelineDetail(event.connection.url, schema, event.shared!.id, signal));
  if (details.error) return (
    <div className="flex items-center gap-2 p-3 text-xs text-destructive" role="alert">
      <span className="min-w-0 flex-1 break-words">{details.error}</span>
      <Button size="xs" variant="ghost" onClick={details.reload}>Retry</Button>
    </div>
  );
  if (!details.data) return <p className="flex items-center gap-2 p-3 text-xs text-muted-foreground"><SpinnerIcon className="size-3.5 animate-spin" />Loading…</p>;
  const data = details.data;
  const sql = pane === "revert" ? data.revertSql : data.sql;
  const options: { value: "sql" | "changes" | "revert"; label: string }[] = [{ value: "sql", label: "SQL" }];
  if (data.previousSql !== null && data.sql !== null) options.push({ value: "changes", label: "Changes" });
  if (data.revertSql !== null) options.push({ value: "revert", label: "Rollback" });
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-1.5">
        <PaneToggle label="Saved migration SQL" value={pane} options={options} onChange={setPane} />
        {pane === "changes" && data.previousAt && (
          <span className="text-[11px] text-muted-foreground">Since {new Date(data.previousAt).toLocaleString()}</span>
        )}
      </div>
      {pane === "changes" ? (
        data.previousSql === data.sql
          ? <p className="p-3 text-xs text-muted-foreground">Unchanged since the last successful run.</p>
          : <SqlDiff before={data.previousSql ?? ""} after={data.sql ?? ""} className="max-h-96 py-2" />
      ) : sql ? (
        <div className="flex max-h-96 min-h-0 flex-col"><SqlSource sql={sql} loading={false} error={null} /></div>
      ) : <p className="p-3 text-xs text-muted-foreground">No SQL saved.</p>}
    </div>
  );
}

function TimelineRow({ event, schema }: { event: Event; schema: string }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = `timeline-${event.connection.id}-${event.id}`;
  return (
    <div className="relative pl-9 before:absolute before:top-0 before:bottom-0 before:left-[11px] before:border-l last:before:bottom-6">
      <span className="absolute top-3 left-0 flex size-6 items-center justify-center rounded-full border bg-background"><KindIcon kind={event.kind} /></span>
      <button type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(!expanded)}
        className="group flex w-full min-w-0 cursor-pointer items-start gap-2 rounded-lg px-2 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span title={explain(event)} className={cn("font-medium", event.kind === "failed" && "text-destructive", event.kind === "uncertain" && "text-amber-600 dark:text-amber-400")}>{LABEL[event.kind]}</span>
            <span className="font-mono text-muted-foreground">{event.version}</span>
            <span className="min-w-0 truncate font-medium" title={event.name}>{event.name}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><ConnectionColorMark connection={event.connection} className="size-1.5" />{event.connection.name}</span>
            {event.setName && <><span aria-hidden="true">·</span><span className="max-w-48 truncate">{event.setName}</span></>}
            {event.appliedBy && <><span aria-hidden="true">·</span><span title="PostgreSQL role">{event.appliedBy}</span></>}
            {event.durationMs !== null && <><span aria-hidden="true">·</span><span>{duration(event.durationMs)}</span></>}
            {event.source === "browser" && <span className="rounded bg-muted px-1.5 py-0.5">This browser</span>}
          </div>
        </div>
        <time dateTime={new Date(event.at).toISOString()} title={new Date(event.at).toLocaleString()} className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {new Date(event.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
        </time>
        <ChevronRightIcon className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")} />
      </button>
      {expanded && (
        <div id={panelId} className="mb-3 overflow-hidden rounded-lg border bg-background">
          {event.error && <pre className="max-h-48 overflow-auto border-b bg-destructive/5 p-3 font-mono text-[11px] whitespace-pre-wrap break-words text-destructive">{event.error}</pre>}
          {event.shared ? <EventSql event={event} schema={schema} /> : <p className="p-3 text-xs text-muted-foreground">No saved SQL.</p>}
        </div>
      )}
    </div>
  );
}

/**
 * What has happened to these databases: the shared timeline each one keeps, plus
 * the ledger rows and browser-only records from before that timeline existed.
 */
export function MigrationHistory({ events: fallback, connections: all, loading: ledgerLoading, ledgerSchema, setName }: Props) {
  const clearHistory = useMigrations((state) => state.clearHistory);
  const [search, setSearch] = useState("");
  const [environment, setEnvironment] = useState("all");
  const [kind, setKind] = useState<TimelineKind | "all">("all");
  const connections = useMemo(() => all.filter((item) => environment === "all" || item.id === environment), [all, environment]);
  const query = useMemo<TimelineQuery>(() => ({ setName, query: search.trim(), kind: kind === "all" ? undefined : kind }), [setName, search, kind]);
  const timeline = useTimeline(connections, ledgerSchema, query);

  const events: Event[] = [];
  for (const connection of connections) {
    const page = timeline.reads[connection.id]?.page;
    const shared = page?.events ?? [];
    for (const event of shared) events.push({
      id: `${connection.id}:${event.id}`, connection, name: event.name, version: event.version,
      setName: event.setName, at: Date.parse(event.startedAt), kind: event.kind,
      durationMs: event.durationMs, appliedBy: event.appliedBy, error: event.error,
      shared: event, source: "shared",
    });
    for (const event of fallback.filter((item) => item.connectionId === connection.id)) {
      if (page?.initialized && event.fromLedger) continue;
      if (shared.some((item) => item.id === event.runId || (!event.runId && item.kind === "legacy" && item.setName === event.setName && item.version === event.version &&
        (event.kind === "applied" || event.kind === "marked") && Math.abs(Date.parse(item.startedAt) + (item.durationMs ?? 0) - event.at) < 2000))) continue;
      const kind = event.fromLedger ? "legacy" : event.kind;
      if (query.kind && query.kind !== kind) continue;
      if (query.query && ![event.name, event.version, event.setName, event.appliedBy].join(" ").toLowerCase().includes(query.query.toLowerCase())) continue;
      events.push({ ...event, kind, connection, source: event.fromLedger ? "ledger" : "browser" });
    }
  }
  events.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  const groups = new Map<string, Event[]>();
  for (const event of events) {
    const day = dayLabel(event.at);
    groups.set(day, [...(groups.get(day) ?? []), event]);
  }
  const errors = connections.filter((connection) => timeline.reads[connection.id]?.error);
  const local = fallback.some((event) => !event.fromLedger);
  const filtered = environment !== "all" || kind !== "all";
  const filterLabel = filtered
    ? [all.find((item) => item.id === environment)?.name, kind === "all" ? undefined : LABEL[kind]].filter(Boolean).join(" · ")
    : "All";

  return (
    <div className="min-w-0">
      <div className="sticky top-0 z-10 flex items-center gap-1 border-b bg-background px-2 py-1">
        <SearchField
          aria-label="Search timeline"
          placeholder="Search timeline"
          value={search}
          maxLength={200}
          onChange={(event) => setSearch(event.target.value)}
          className="min-w-0 flex-1"
          trailing={search ? (
            <button type="button" aria-label="Clear search" className="cursor-pointer rounded p-0.5 hover:text-foreground" onClick={() => setSearch("")}>
              <XIcon className="size-3.5" />
            </button>
          ) : null}
        />
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="sm" variant={filtered ? "outline" : "ghost"} />} className="max-w-56 cursor-pointer">
            <span className="truncate">{filterLabel}</span>
            <ChevronDownIcon data-icon="inline-end" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            {all.length > 1 && (
              <>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Environment</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={environment} onValueChange={(value) => setEnvironment(value as string)}>
                    <DropdownMenuRadioItem value="all">All environments</DropdownMenuRadioItem>
                    {all.map((item) => (
                      <DropdownMenuRadioItem key={item.id} value={item.id}>
                        <ConnectionColorMark connection={item} className="size-1.5" />
                        {item.name}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuGroup>
              <DropdownMenuLabel>Outcome</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={kind} onValueChange={(value) => setKind(value as TimelineKind | "all")}>
                <DropdownMenuRadioItem value="all">All outcomes</DropdownMenuRadioItem>
                {TIMELINE_KINDS.map((item) => <DropdownMenuRadioItem key={item} value={item}>{LABEL[item]}</DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="icon-sm" onClick={timeline.refresh} disabled={timeline.loading} aria-label="Refresh timeline" title="Refresh timeline">
          <RefreshIcon className={cn("size-3.5", timeline.loading && "animate-spin")} />
        </Button>
        {local && (
          <Button variant="ghost" size="icon-sm" onClick={() => clearHistory()} aria-label="Clear local log"
            title="Clears this browser's log. The databases' ledgers and timelines are untouched.">
            <EraserIcon className="size-3.5" />
          </Button>
        )}
      </div>
      {errors.map((connection) => (
        <p key={connection.id} role="alert" title={timeline.reads[connection.id].error} className="truncate px-4 pt-2 text-[11px] text-destructive">
          {connection.name}: {timeline.reads[connection.id].error}
        </p>
      ))}
      {events.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          {timeline.loading || ledgerLoading ? "Reading timeline…" : search.trim() || filtered ? "No matching events." : "Nothing has run yet."}
        </p>
      ) : (
        <div className="px-4 pb-4">
          {[...groups].map(([day, items]) => <section key={day} aria-label={day}>
            <h3 className="pt-4 pb-2 text-[11px] font-medium text-muted-foreground">{day}</h3>
            {items.map((event) => <TimelineRow key={event.id} event={event} schema={ledgerSchema} />)}
          </section>)}
          {timeline.hasMore && (
            <div className="flex justify-center pt-4">
              <Button variant="ghost" size="sm" onClick={timeline.loadMore} disabled={timeline.loading}>{timeline.loading ? "Loading…" : "Load older"}</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
