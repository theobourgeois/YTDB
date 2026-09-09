"use client";

import { CheckIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMigrations, type MigrationRunRecord } from "@/lib/store/migrations";
import { cn } from "@/lib/utils";

type Props = {
  setId: string;
  /** Empty shows every connection; otherwise history is narrowed to these. */
  connectionIds: string[];
};

function when(ranAt: number): string {
  return new Date(ranAt).toLocaleString();
}

function Row({ record }: { record: MigrationRunRecord }) {
  const failed = record.status === "failed";
  return (
    <div className="flex items-start gap-2 border-b px-4 py-2 text-xs last:border-b-0">
      {failed ? (
        <XIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
      ) : (
        <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
      )}
      <span
        className={cn(
          "mt-px shrink-0 rounded-md px-1.5 text-[11px]",
          record.recorded
            ? "bg-muted text-muted-foreground/80 italic"
            : record.direction === "revert"
              ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
              : "bg-muted text-muted-foreground",
        )}
      >
        {record.recorded
          ? record.direction === "apply"
            ? "marked"
            : "unmarked"
          : record.direction}
      </span>
      <span className="shrink-0 font-mono text-muted-foreground">{record.version}</span>
      <span className="min-w-0 flex-1">
        <span className="truncate">{record.name}</span>
        {failed && record.error && (
          <span className="mt-1 block font-mono text-[11px] whitespace-pre-wrap text-destructive">
            {record.error}
          </span>
        )}
      </span>
      <span className="shrink-0 text-muted-foreground">{record.connectionName}</span>
      <span className="shrink-0 tabular-nums text-muted-foreground/70">{record.durationMs} ms</span>
      <span className="shrink-0 text-muted-foreground/70">{when(record.ranAt)}</span>
    </div>
  );
}

/** Every run attempt, including the ones that failed — which the ledger never keeps. */
export function MigrationHistory({ setId, connectionIds }: Props) {
  const history = useMigrations((state) => state.history);
  const clearHistory = useMigrations((state) => state.clearHistory);
  const scope = new Set(connectionIds);
  const records = history.filter(
    (record) =>
      record.setId === setId && (scope.size === 0 || scope.has(record.connectionId)),
  );

  if (records.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">
        Nothing has been run from this folder yet.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-1.5">
        <span className="text-xs text-muted-foreground">
          {records.length} run{records.length === 1 ? "" : "s"}, newest first
        </span>
        <Button size="xs" variant="ghost" onClick={() => clearHistory(setId)}>
          Clear
        </Button>
      </div>
      <div className="border-t">
        {records.map((record) => (
          <Row key={record.id} record={record} />
        ))}
      </div>
    </div>
  );
}
