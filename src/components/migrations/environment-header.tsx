"use client";

import { GitCompareIcon } from "lucide-react";
import { ConnectionColorMark } from "@/components/connections/connection-color";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SetSummary } from "@/lib/migrations/status";
import type { LedgerResult } from "@/lib/migrations/types";
import type { Connection } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ACTION_COLUMN, ENVIRONMENT_COLUMN } from "./migration-row";

export type Environment = {
  connection: Connection;
  ledger: LedgerResult | null;
  error: string | null;
  summary: SetSummary;
};

/**
 * The picker for which database everything on this screen runs against. Running
 * against an environment means opening it, so choosing here opens that connection.
 */
export function TargetPicker({
  environments,
  targetId,
  onSelect,
}: {
  environments: Environment[];
  targetId: string;
  onSelect: (connectionId: string) => void;
}) {
  const target = environments.find((item) => item.connection.id === targetId);
  if (!target) return null;
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Running against</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={environments.length < 2}
          className="flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border bg-background px-2 text-xs font-medium outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default data-open:bg-muted/60"
        >
          <ConnectionColorMark connection={target.connection} />
          <span className="max-w-32 truncate">{target.connection.name}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-52">
          {environments.map((environment) => (
            <DropdownMenuItem
              key={environment.connection.id}
              onClick={() => onSelect(environment.connection.id)}
              className={environment.connection.id === targetId ? "font-medium" : undefined}
            >
              <ConnectionColorMark connection={environment.connection} />
              <span className="min-w-0 flex-1 truncate">{environment.connection.name}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {environment.summary.applied}/{environment.summary.total}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * The column headings of the migration list: one per environment, with how far
 * each has got. The target's column is tinted down the whole table, so which
 * database the buttons act on is the same thing you read the ticks in.
 */
export function EnvironmentHeader({
  environments,
  targetId,
  caption,
  loading,
  onSelect,
  onCompare,
}: {
  environments: Environment[];
  targetId: string;
  caption: string;
  loading: boolean;
  onSelect: (connectionId: string) => void;
  onCompare: (connectionId: string) => void;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center border-b bg-muted/20">
      <span className="min-w-0 flex-1 truncate px-3 text-xs text-muted-foreground">{caption}</span>
      {environments.map((environment) => {
        const { connection, summary, ledger, error } = environment;
        const target = connection.id === targetId;
        return (
          <button
            key={connection.id}
            type="button"
            disabled={target}
            aria-current={target ? "true" : undefined}
            title={
              target
                ? `${connection.name} is what Apply and Revert run against`
                : `Run against ${connection.name} instead`
            }
            onClick={() => onSelect(connection.id)}
            className={cn(
              "flex h-11 shrink-0 flex-col items-center justify-center gap-0.5 border-l text-[11px] outline-none",
              ENVIRONMENT_COLUMN,
              target
                ? "cursor-default bg-foreground/[0.04] font-medium"
                : "cursor-pointer text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              loading && "opacity-60",
            )}
          >
            <span className="flex max-w-full items-center gap-1">
              <ConnectionColorMark connection={connection} className="size-1.5" />
              <span className="truncate">{connection.name}</span>
            </span>
            {error ? (
              <span className="text-destructive">unreachable</span>
            ) : !ledger ? (
              <span className="text-muted-foreground/70">reading…</span>
            ) : (
              <span className="tabular-nums text-muted-foreground/80">
                {summary.applied}/{summary.total}
                {summary.drifted > 0 && <span className="text-amber-600 dark:text-amber-400"> !</span>}
              </span>
            )}
          </button>
        );
      })}
      <div className={cn("flex shrink-0 items-center justify-end border-l pr-2 pl-1", ACTION_COLUMN)}>
        {environments.length > 1 && (
          <Button
            size="icon-xs"
            variant="ghost"
            title="Compare the two schemas"
            aria-label="Compare schemas"
            onClick={() => {
              const other = environments.find((item) => item.connection.id !== targetId);
              if (other) onCompare(other.connection.id);
            }}
          >
            <GitCompareIcon />
          </Button>
        )}
      </div>
    </div>
  );
}
