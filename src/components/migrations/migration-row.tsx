"use client";

import { useState } from "react";
import { CheckIcon, ChevronRightIcon, ClipboardCheckIcon, ClipboardXIcon, FileUploadIcon, CopyIcon, MinusIcon, MoreIcon, TerminalIcon, WarningIcon, UndoIcon } from "@/components/icons";
import { SqlCode, copySql } from "@/components/sql/sql-source";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PaneToggle } from "@/components/ui/pane-toggle";
import { transactionBadge, transactionNote } from "@/lib/migrations/sql";
import type { LedgerEntry, MigrationStep, StepStatus } from "@/lib/migrations/types";
import type { Connection } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Width of one environment column. Shared with the table header so the two line up. */
export const ENVIRONMENT_COLUMN = "w-24";
/** Width of the trailing action column, so every row's buttons align. */
export const ACTION_COLUMN = "w-[104px]";

export type EnvironmentStatus = {
  connection: Connection;
  status: StepStatus;
  entry: LedgerEntry | null;
  error: string | null;
};

export type RowActions = {
  onApplyThrough: () => void;
  onApplyOne: () => void;
  onRevertThrough: () => void;
  onMarkApplied: () => void;
  onMarkPending: () => void;
  onAttachRevert: () => void;
  onRemove: () => void;
  onOpenInEditor: (sql: string) => void;
};

type Props = {
  step: MigrationStep;
  environments: EnvironmentStatus[];
  /** The connection being run against; its column is the one the buttons act on. */
  targetId: string;
  status: StepStatus;
  /** True for the newest applied migration on the target, the only one Revert can undo alone. */
  isNewestApplied: boolean;
  expanded: boolean;
  busy: boolean;
  /** False when the files come straight from disk, so nothing here can add, replace or remove one. */
  editable?: boolean;
  onToggle: () => void;
  actions: RowActions;
};

const STATUS_LABEL: Record<StepStatus, string> = {
  applied: "applied",
  drifted: "applied, but the file changed since",
  pending: "not applied",
  unknown: "not read yet",
};

export function StatusMark({ status }: { status: StepStatus }) {
  if (status === "applied") {
    return <CheckIcon className="size-4 text-emerald-600 dark:text-emerald-400" />;
  }
  if (status === "drifted") {
    return <WarningIcon className="size-3.5 text-amber-600 dark:text-amber-400" />;
  }
  if (status === "unknown") {
    return <span className="size-1.5 rounded-full bg-muted-foreground/30" />;
  }
  return <MinusIcon className="size-3.5 text-muted-foreground/40" />;
}

function whenApplied(entry: LedgerEntry | null): string {
  if (!entry) return "";
  const applied = new Date(entry.appliedAt);
  return Number.isNaN(applied.getTime()) ? entry.appliedAt : applied.toLocaleString();
}

export function MigrationRow({
  step,
  environments,
  targetId,
  status,
  isNewestApplied,
  expanded,
  busy,
  editable = true,
  onToggle,
  actions,
}: Props) {
  const [pane, setPane] = useState<"apply" | "revert">("apply");
  const [copied, setCopied] = useState(false);
  const sql = pane === "revert" ? (step.revertSql ?? "") : step.applySql;
  const badge = transactionBadge(step.transaction);
  const note = transactionNote(step.transaction);

  const notes: string[] = [];
  if (status === "drifted") {
    notes.push("This file changed after it was applied here, so it is no longer the migration that ran.");
  }
  if (note) notes.push(note);

  async function copy() {
    await copySql(sql);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="border-b last:border-b-0">
      <div className={cn("flex h-10 items-center transition-colors hover:bg-muted/40", busy && "opacity-60")}>
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? `Hide SQL for ${step.version}` : `Show SQL for ${step.version}`}
          onClick={onToggle}
          className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <ChevronRightIcon
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/70 transition-transform",
              expanded && "rotate-90",
            )}
          />
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{step.version}</span>
          <span className="min-w-0 truncate text-sm">{step.name}</span>
          {badge && (
            <span className="shrink-0 rounded border border-amber-600/25 bg-amber-500/10 px-1.5 text-[10px] text-amber-700 dark:text-amber-400">
              {badge}
            </span>
          )}

        </button>

        {environments.map((environment) => {
          const target = environment.connection.id === targetId;
          return (
            <span
              key={environment.connection.id}
              title={
                environment.error
                  ? `${environment.connection.name}: ${environment.error}`
                  : `${step.version} is ${STATUS_LABEL[environment.status]} on ${environment.connection.name}${
                      environment.entry ? ` — ${whenApplied(environment.entry)}` : ""
                    }`
              }
              className={cn(
                "flex h-10 shrink-0 items-center justify-center",
                ENVIRONMENT_COLUMN,
                target && "bg-foreground/[0.04]",
              )}
            >
              <StatusMark status={environment.status} />
            </span>
          );
        })}

        <div className={cn("flex shrink-0 items-center justify-end gap-1 pr-2 pl-1", ACTION_COLUMN)}>
          {status === "pending" && (
            <Button size="xs" variant="outline" disabled={busy} onClick={actions.onApplyThrough}>
              Apply
            </Button>
          )}
          {isNewestApplied && step.revertSql && (
            <Button size="xs" variant="ghost" disabled={busy} onClick={actions.onRevertThrough}>
              <UndoIcon data-icon="inline-start" />
              Revert
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button size="icon-xs" variant="ghost" aria-label={`Actions for ${step.version}`} />
              }
              className="cursor-pointer"
            >
              <MoreIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuItem disabled={busy || status === "applied"} onClick={actions.onApplyThrough}>
                Apply everything through here
              </DropdownMenuItem>
              <DropdownMenuItem disabled={busy || status === "applied"} onClick={actions.onApplyOne}>
                Apply only this one
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={busy || status === "pending" || !step.revertSql}
                onClick={actions.onRevertThrough}
              >
                Revert back through here
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={busy || status === "applied"}
                onClick={actions.onMarkApplied}
              >
                <ClipboardCheckIcon />
                Mark as already applied
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={busy || status === "pending"}
                onClick={actions.onMarkPending}
              >
                <ClipboardXIcon />
                Mark as not applied
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {editable && (
                <DropdownMenuItem onClick={actions.onAttachRevert}>
                  <FileUploadIcon />
                  {step.revertSql ? "Replace revert file…" : "Add a revert file…"}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => actions.onOpenInEditor(sql)}>
                <TerminalIcon />
                Open {pane} SQL in editor
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void copy()}>
                <CopyIcon />
                Copy {pane} SQL
              </DropdownMenuItem>
              {editable && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={actions.onRemove}>
                    Remove from this set
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {expanded && (
        <div className="border-t bg-muted/25">
          <div className="flex items-center gap-2 px-3 py-1.5">
            <PaneToggle
              label={`SQL for ${step.version}`}
              value={pane}
              onChange={setPane}
              options={[
                { value: "apply", label: "Apply" },
                { value: "revert", label: "Revert" },
              ]}
            />
            <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
              {pane === "revert" ? (step.revertPath ?? "no revert file") : step.applyPath}
            </span>
            <Button size="xs" variant="ghost" className="ml-auto" onClick={() => void copy()}>
              {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          {notes.length > 0 && (
            <ul className="space-y-1 px-3 pb-2">
              {notes.map((warning) => (
                <li
                  key={warning}
                  className="flex gap-1.5 text-[11px] text-amber-700 dark:text-amber-400"
                >
                  <WarningIcon className="mt-px size-3 shrink-0" />
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          )}
          {sql ? (
            <SqlCode sql={sql} className="max-h-72 overflow-auto px-3 pb-3" />
          ) : (
            <div className="flex items-center gap-2 px-3 pb-3 text-xs text-muted-foreground">
              <span>No revert file, so this one cannot be undone from here.</span>
              {editable && (
                <Button size="xs" variant="outline" onClick={actions.onAttachRevert}>
                  <FileUploadIcon data-icon="inline-start" />
                  Add one
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
