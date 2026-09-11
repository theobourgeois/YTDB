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
import { SqlDiff } from "./sql-diff";

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

/**
 * What a drifted migration's file is compared against: the SQL one database
 * actually ran. `appliedSql` is undefined while it is being read, and null when
 * that database's ledger did not keep it.
 */
export type DriftSource = {
  connectionName: string;
  appliedSql: string | null | undefined;
  error: string | null;
};

type Pane = "apply" | "revert" | "changes";

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
  /** Set when some environment ran a different version of this file. */
  drift: DriftSource | null;
  selected: boolean;
  /** `range` is true for a shift-click, which selects everything from the last one picked. */
  onSelect: (range: boolean) => void;
  onToggle: () => void;
  actions: RowActions;
};

/** A checkbox for picking rows, `mixed` when only some of what it stands for is picked. */
export function SelectBox({
  checked,
  label,
  onToggle,
}: {
  checked: boolean | "mixed";
  label: string;
  onToggle: (range: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={label}
      // Shift-click picks a range; without this it also selects the text between.
      onMouseDown={(event) => event.shiftKey && event.preventDefault()}
      onClick={(event) => onToggle(event.shiftKey)}
      className={cn(
        "flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[5px] border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60",
        checked
          ? "border-foreground bg-foreground text-background"
          : "border-input hover:border-foreground/50",
      )}
    >
      {checked === "mixed" ? (
        <MinusIcon className="size-3" />
      ) : checked ? (
        <CheckIcon className="size-3" />
      ) : null}
    </button>
  );
}

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
  drift,
  selected,
  onSelect,
  onToggle,
  actions,
}: Props) {
  // Null until a pane is picked: a drifted row opens on its changes, any other on its SQL.
  const [picked, setPicked] = useState<Pane | null>(null);
  const pane: Pane = picked === "changes" && !drift ? "apply" : (picked ?? (drift ? "changes" : "apply"));
  const sqlPane = pane === "revert" ? "revert" : "apply";
  const [copied, setCopied] = useState(false);
  const sql = sqlPane === "revert" ? (step.revertSql ?? "") : step.applySql;
  const badge = transactionBadge(step.transaction);
  const note = transactionNote(step.transaction);

  const notes: string[] = [];
  if (status === "drifted" && pane !== "changes") {
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
      <div
        className={cn(
          "flex h-10 items-center transition-colors hover:bg-muted/40",
          selected && "bg-muted/30",
          busy && "opacity-60",
        )}
      >
        <span className="flex h-10 shrink-0 items-center pl-3">
          <SelectBox
            checked={selected}
            label={selected ? `Deselect ${step.version}` : `Select ${step.version}`}
            onToggle={onSelect}
          />
        </span>
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
                Open {sqlPane} SQL in editor
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void copy()}>
                <CopyIcon />
                Copy {sqlPane} SQL
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
              onChange={setPicked}
              options={[
                ...(drift ? [{ value: "changes" as const, label: "Changes" }] : []),
                { value: "apply" as const, label: "Apply" },
                { value: "revert" as const, label: "Revert" },
              ]}
            />
            {pane === "changes" && drift ? (
              <span className="flex min-w-0 items-center gap-3 font-mono text-[11px]">
                <span className="shrink-0 text-red-600 dark:text-red-400">
                  − ran on {drift.connectionName}
                </span>
                <span className="truncate text-emerald-600 dark:text-emerald-400">
                  + {step.applyPath}
                </span>
              </span>
            ) : (
              <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                {pane === "revert" ? (step.revertPath ?? "no revert file") : step.applyPath}
              </span>
            )}
            {pane !== "changes" && (
              <Button size="xs" variant="ghost" className="ml-auto" onClick={() => void copy()}>
                {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            )}
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
          {pane === "changes" && drift ? (
            drift.error ? (
              <p className="px-3 pb-3 font-mono text-xs text-destructive">{drift.error}</p>
            ) : drift.appliedSql === undefined ? (
              <p className="px-3 pb-3 text-xs text-muted-foreground">
                Reading what ran on {drift.connectionName}…
              </p>
            ) : drift.appliedSql === null ? (
              <p className="px-3 pb-3 text-xs text-muted-foreground">
                {drift.connectionName} did not keep the SQL it ran, so there is nothing to compare against.
              </p>
            ) : (
              <SqlDiff before={drift.appliedSql} after={step.applySql} className="max-h-96 pb-2" />
            )
          ) : sql ? (
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
