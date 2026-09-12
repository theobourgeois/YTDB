"use client";

import { useState } from "react";
import { CheckIcon, RefreshIcon, SpinnerIcon, XIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useAsync } from "@/hooks/use-async";
import { api } from "@/lib/api";
import type { ReconcileReport, ResolveOutcome, TimelineEvent } from "@/lib/migrations/timeline";
import type { MigrationStep } from "@/lib/migrations/types";
import type { Connection } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  connection: Connection;
  ledgerSchema: string;
  event: TimelineEvent;
  /** The file this run came from, when the page has it, so the ledger row gets its fingerprint. */
  step: MigrationStep | null;
  onResolved: (outcome: ResolveOutcome) => void;
  /** Runs the migration again once the run is settled as lost. */
  onRetry?: () => void;
};

/**
 * What the database says about a run that never reported back, and the two
 * ways to settle it. An unconfirmed run never wrote its ledger row — the row
 * and the outcome commit together — so only the SQL's own traces are in doubt.
 */
export function UnconfirmedPanel({ connection, ledgerSchema, event, step, onResolved, onRetry }: Props) {
  const report = useAsync<ReconcileReport>(
    `reconcile:${connection.id}:${ledgerSchema}:${event.id}`,
    (signal) => api.reconcile(connection.url, ledgerSchema, event.id, signal),
  );
  const [busy, setBusy] = useState<ResolveOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function settle(outcome: ResolveOutcome, retry = false) {
    setBusy(outcome);
    setError(null);
    try {
      await api.resolve(connection.url, ledgerSchema, { eventId: event.id, outcome, checksum: step?.checksum });
      onResolved(outcome);
      if (retry) onRetry?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  if (report.error) {
    return (
      <div className="flex items-center gap-2 border-b p-3 text-xs text-destructive" role="alert">
        <span className="min-w-0 flex-1 break-words">{report.error}</span>
        <Button size="xs" variant="ghost" onClick={report.reload}>Retry</Button>
      </div>
    );
  }
  if (!report.data) {
    return (
      <p className="flex items-center gap-2 border-b p-3 text-xs text-muted-foreground">
        <SpinnerIcon className="size-3.5 animate-spin" />
        Checking {connection.name}…
      </p>
    );
  }

  const { running, detection } = report.data;
  const revert = event.direction === "revert";
  const landedLabel = revert ? "Mark as reverted" : "Mark as applied";
  const evidence = detection?.evidence ?? [];
  const present = evidence.filter((piece) => piece.satisfied).length;

  let verdict: string;
  let lean: ResolveOutcome | null;
  if (running) {
    verdict = `Still running on ${connection.name}${running.since ? ` since ${new Date(running.since).toLocaleTimeString()}` : ""}. Leave it be; the timeline updates when it finishes.`;
    lean = null;
  } else if (event.atomic) {
    verdict = `This ran in one transaction that never committed, so nothing from it is on ${connection.name}.`;
    lean = "lost";
  } else if (!detection || detection.verdict === "unknown") {
    verdict = `This SQL leaves no trace in the schema — data changes, seeds, grants — so ${connection.name} cannot say whether it ran. Check by hand before settling it.`;
    lean = null;
  } else if (detection.verdict === "applied") {
    verdict = `Everything it ${revert ? "removes is gone from" : "creates or changes is on"} ${connection.name}.`;
    lean = "landed";
  } else if (detection.verdict === "pending") {
    verdict = `Nothing it ${revert ? "removes is gone from" : "creates or changes is on"} ${connection.name}.`;
    lean = "lost";
  } else {
    verdict = `Some of what it does is on ${connection.name} and some is not. Finish or undo the rest by hand in the query editor before settling it.`;
    lean = null;
  }

  return (
    <div className="border-b">
      <div className="flex items-start gap-2 px-3 py-2">
        <p className="min-w-0 flex-1 text-xs">{verdict}</p>
        <Button size="icon-xs" variant="ghost" aria-label="Check again" title="Check again" disabled={report.loading} onClick={report.reload}>
          <RefreshIcon className={cn("size-3.5", report.loading && "animate-spin")} />
        </Button>
      </div>

      {evidence.length > 0 && (
        <div className="mx-3 mb-2 max-h-40 overflow-y-auto rounded-md border bg-muted/25">
          <p className="border-b px-2 py-1 text-[11px] text-muted-foreground">
            {present} of {evidence.length} {evidence.length === 1 ? "thing" : "things"} it would leave behind {present === 1 ? "is" : "are"} there
          </p>
          {evidence.map((piece) => (
            <p key={piece.description} className="flex items-center gap-1.5 px-2 py-0.5 font-mono text-[11px]">
              {piece.satisfied
                ? <CheckIcon className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                : <XIcon className="size-3 shrink-0 text-muted-foreground/60" />}
              <span className="min-w-0 truncate" title={piece.note ? `${piece.description} — ${piece.note}` : piece.description}>
                {piece.description}
              </span>
            </p>
          ))}
        </div>
      )}

      {error && (
        <p className="mx-3 mb-2 rounded-md border border-destructive/25 bg-destructive/5 px-2 py-1 font-mono text-[11px] whitespace-pre-wrap text-destructive">
          {error}
        </p>
      )}

      {!running && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
          <Button
            size="xs"
            variant={lean === "landed" ? "default" : "outline"}
            disabled={busy !== null}
            title="Writes the ledger row this run would have written. No SQL runs."
            onClick={() => void settle("landed")}
          >
            {busy === "landed" ? "Marking…" : landedLabel}
          </Button>
          <Button
            size="xs"
            variant={lean === "lost" ? "default" : "outline"}
            disabled={busy !== null}
            title="Closes this run as failed. The ledger is left as it is."
            onClick={() => void settle("lost")}
          >
            {busy === "lost" ? "Marking…" : "Mark as failed"}
          </Button>
          {onRetry && !revert && (
            <Button
              size="xs"
              variant="ghost"
              disabled={busy !== null}
              title="Closes this run as failed and runs the migration again."
              onClick={() => void settle("lost", true)}
            >
              Retry
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
