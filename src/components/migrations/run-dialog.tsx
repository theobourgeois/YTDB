"use client";

import { CheckIcon, CircleDashedIcon, SpinnerIcon, MinusIcon, NoteIcon, WarningIcon, XIcon } from "@/components/icons";
import { ConnectionColorMark } from "@/components/connections/connection-color";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TransactionMode } from "@/lib/migrations/sql";
import type { MigrationDirection, MigrationStep } from "@/lib/migrations/types";
import type { Connection } from "@/lib/types";

export type RunStepStatus = "waiting" | "running" | "ok" | "failed" | "skipped";

export type RunProgress = {
  version: string;
  name: string;
  status: RunStepStatus;
  durationMs?: number;
  error?: string;
};

type Props = {
  open: boolean;
  direction: MigrationDirection;
  connection: Connection;
  steps: MigrationStep[];
  /** Set when the plan had to stop short — a migration with no revert file. */
  blockedBy: MigrationStep | null;
  progress: RunProgress[] | null;
  running: boolean;
  /** True when this only writes the ledger, without running any SQL. */
  recordOnly: boolean;
  /** The author's note on how to run the migration, read before anything runs. */
  note?: string;
  onRun: () => void;
  onStop: () => void;
  onClose: () => void;
};

/** True when the migration and its ledger row commit together. */
function isAtomic(mode: TransactionMode): boolean {
  return mode === "wrapped-by-ytdb" || mode === "self-wrapped";
}

/** `user@host/database`, so a confirmation names the database and not just the label. */
export function describeConnection(url: string): string {
  try {
    const parsed = new URL(url);
    const user = parsed.username ? `${decodeURIComponent(parsed.username)}@` : "";
    const port = parsed.port ? `:${parsed.port}` : "";
    return `${user}${parsed.hostname}${port}${parsed.pathname}`;
  } catch {
    return "this connection";
  }
}

function StatusIcon({ status }: { status: RunStepStatus }) {
  switch (status) {
    case "running":
      return <SpinnerIcon className="size-3.5 shrink-0 animate-spin text-primary" />;
    case "ok":
      return <CheckIcon className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />;
    case "failed":
      return <XIcon className="size-3.5 shrink-0 text-destructive" />;
    case "skipped":
      return <MinusIcon className="size-3.5 shrink-0 text-muted-foreground/60" />;
    default:
      return <CircleDashedIcon className="size-3.5 shrink-0 text-muted-foreground/60" />;
  }
}

export function MigrationRunDialog({
  open,
  direction,
  connection,
  steps,
  blockedBy,
  progress,
  running,
  recordOnly,
  note,
  onRun,
  onStop,
  onClose,
}: Props) {
  const verb = recordOnly
    ? direction === "apply"
      ? "Mark as applied"
      : "Mark as not applied"
    : direction === "apply"
      ? "Apply"
      : "Revert";
  const done = recordOnly ? "Marked" : direction === "apply" ? "Applied" : "Reverted";
  const count = steps.length;
  const unwrapped = steps.filter((step) => !isAtomic(step.transaction));
  const failed = progress?.find((item) => item.status === "failed") ?? null;
  const finished = progress !== null && !running;
  const succeeded = progress?.filter((item) => item.status === "ok").length ?? 0;
  const rows: RunProgress[] =
    progress ??
    steps.map((step) => ({ version: step.version, name: step.name, status: "waiting" as const }));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !running && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {count === 0 && blockedBy
              ? "Nothing here can be reverted"
              : finished
                ? failed
                  ? `${verb} stopped after ${succeeded} of ${count}`
                  : `${done} ${succeeded} migration${succeeded === 1 ? "" : "s"}`
                : recordOnly
                ? `${verb === "Mark as applied" ? "Mark" : "Unmark"} ${count} migration${count === 1 ? "" : "s"} on ${connection.name}?`
                : `${verb} ${count} migration${count === 1 ? "" : "s"}?`}
          </DialogTitle>
          <DialogDescription>
            <span className="flex flex-wrap items-center gap-1.5">
              <span>
                {recordOnly
                  ? finished
                    ? "Recorded on"
                    : "Records on"
                  : finished
                    ? "Ran against"
                    : "Runs against"}
              </span>
              <ConnectionColorMark connection={connection} />
              <span className="font-medium text-foreground">{connection.name}</span>
              <span className="font-mono text-[11px]">{describeConnection(connection.url)}</span>
            </span>
          </DialogDescription>
        </DialogHeader>

        {!progress && note && (
          <p className="flex max-h-40 gap-2 overflow-y-auto rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <NoteIcon className="mt-px size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{note}</span>
          </p>
        )}

        {rows.length > 0 && (
          <div className="max-h-64 overflow-y-auto rounded-md border">
            {rows.map((item) => (
              <div
                key={item.version}
                className="flex items-center gap-2 border-b px-3 py-1.5 text-xs last:border-b-0"
              >
                <StatusIcon status={item.status} />
                <span className="shrink-0 font-mono text-muted-foreground">{item.version}</span>
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                {item.durationMs !== undefined && (
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {item.durationMs} ms
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {failed?.error && (
          <p className="max-h-32 overflow-auto rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 font-mono text-[11px] whitespace-pre-wrap text-destructive">
            {failed.error}
          </p>
        )}

        {!progress && blockedBy && (
          <p className="flex gap-2 text-xs text-muted-foreground">
            <WarningIcon className="mt-px size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              {count === 0
                ? `${blockedBy.version} ${blockedBy.name} is the newest one applied and has no revert file, so nothing below it can be reached.`
                : `Stops at ${blockedBy.version} ${blockedBy.name}, which has no revert file.`}
            </span>
          </p>
        )}

        {!progress && recordOnly && (
          <p className="rounded-md border border-amber-600/25 bg-amber-500/8 px-3 py-2 text-xs">
            <span className="font-medium">No SQL runs.</span> Only the ledger on {connection.name}{" "}
            changes.
          </p>
        )}

        {!progress && !recordOnly && unwrapped.length > 0 && (
          <p className="flex gap-2 text-xs text-muted-foreground">
            <WarningIcon className="mt-px size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              {unwrapped.length === 1
                ? `${unwrapped[0].version} runs outside a transaction, so a failure partway leaves it half applied.`
                : `${unwrapped.length} of these run outside a transaction, so a failure partway leaves them half applied.`}
            </span>
          </p>
        )}

        {!progress && !recordOnly && direction === "revert" && (
          <p className="text-xs text-muted-foreground">
            Reverting runs newest first and can drop data the migrations created.
          </p>
        )}

        <DialogFooter>
          {running ? (
            <Button variant="outline" onClick={onStop}>
              Stop after this one
            </Button>
          ) : finished ? (
            <Button onClick={onClose}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                {count === 0 ? "Close" : "Cancel"}
              </Button>
              {count > 0 && (
                <Button
                  variant={!recordOnly && direction === "revert" ? "destructive" : "default"}
                  onClick={onRun}
                >
                  {recordOnly
                    ? `${verb} (${count})`
                    : `${verb} ${count === 1 ? "migration" : `${count} migrations`}`}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
