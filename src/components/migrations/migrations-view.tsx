"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ChevronsUpDownIcon,
  ClipboardCheckIcon,
  FolderUpIcon,
  Layers2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  TableIcon,
  TriangleAlertIcon,
  UndoIcon,
} from "lucide-react";
import { useExplorerContext } from "@/components/explorer/explorer-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PaneToggle } from "@/components/ui/pane-toggle";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAsync } from "@/hooks/use-async";
import { api } from "@/lib/api";
import {
  applyPlan,
  foreignEntries,
  ledgerEntry,
  newestApplied,
  revertPlan,
  stepStatus,
  summarize,
  type RunPlan,
} from "@/lib/migrations/status";
import {
  LEDGER_TABLE,
  type LedgerResult,
  type MigrationDirection,
  type MigrationStep,
} from "@/lib/migrations/types";
import { useSharedLayoutPartners, useExplorer } from "@/lib/store/explorer";
import type { MergeReport } from "@/lib/migrations/parse";
import { useActiveSet, useMigrations } from "@/lib/store/migrations";
import { useQueries } from "@/lib/store/queries";
import { cn } from "@/lib/utils";
import { EnvironmentHeader, TargetPicker, type Environment } from "./environment-header";
import { LedgerSchemaDialog } from "./ledger-schema-dialog";
import { MigrationHistory } from "./migration-history";
import { MigrationDropZone, useMigrationImport, type FolderDrop } from "./migration-import";
import { MigrationRow, StatusMark } from "./migration-row";
import { MigrationRunDialog, type RunProgress } from "./run-dialog";

type Pane = "migrations" | "history";

type LedgerRead = { ledger: LedgerResult | null; error: string | null };

type PendingRun = RunPlan & {
  direction: MigrationDirection;
  /** Writes the ledger without running anything, for adopting an existing schema. */
  recordOnly?: boolean;
};

export function MigrationsView() {
  const router = useRouter();
  const { connection, tables } = useExplorerContext();
  const sets = useMigrations((state) => state.sets);
  const createSet = useMigrations((state) => state.createSet);
  const addFiles = useMigrations((state) => state.addFiles);
  const renameSet = useMigrations((state) => state.renameSet);
  const removeSet = useMigrations((state) => state.removeSet);
  const removeStep = useMigrations((state) => state.removeStep);
  const chooseSet = useMigrations((state) => state.setActive);
  const recordRun = useMigrations((state) => state.record);
  const ledgerSchema = useMigrations((state) => state.ledgerSchema);
  const setLedgerSchema = useMigrations((state) => state.setLedgerSchema);
  const activeSet = useActiveSet(connection.id);
  const partners = useSharedLayoutPartners(connection.id);
  const setDraft = useQueries((state) => state.setDraft);
  const clearActiveSaved = useQueries((state) => state.setActiveSaved);

  const [pane, setPane] = useState<Pane>("migrations");
  const [expanded, setExpanded] = useState<string[]>([]);
  const [pendingRun, setPendingRun] = useState<PendingRun | null>(null);
  const [progress, setProgress] = useState<RunProgress[] | null>(null);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [lastImport, setLastImport] = useState<MergeReport | null>(null);
  const [revertFor, setRevertFor] = useState<string | null>(null);
  const [editingLedger, setEditingLedger] = useState(false);
  const revertInputRef = useRef<HTMLInputElement>(null);
  const stopRef = useRef(false);

  const environmentConnections = useMemo(
    () => [connection, ...partners],
    [connection, partners],
  );
  const ledgerKey = environmentConnections.map((item) => item.url).join("|");

  const ledgers = useAsync<Record<string, LedgerRead>>(
    `ledgers:${ledgerSchema}:${ledgerKey}`,
    async (signal) => {
    const reads = await Promise.all(
      environmentConnections.map(async (item): Promise<[string, LedgerRead]> => {
        try {
          return [
            item.id,
            { ledger: await api.ledger(item.url, ledgerSchema, signal), error: null },
          ];
        } catch (caught) {
          if (signal.aborted) throw caught;
          return [
            item.id,
            { ledger: null, error: caught instanceof Error ? caught.message : String(caught) },
          ];
        }
      }),
    );
      return Object.fromEntries(reads);
    },
  );

  const current = ledgers.data?.[connection.id] ?? null;
  const currentLedger = current?.ledger ?? null;

  const environments = useMemo(
    (): Environment[] =>
      environmentConnections.map((item) => {
        const read = ledgers.data?.[item.id] ?? null;
        return {
          connection: item,
          ledger: read?.ledger ?? null,
          error: read?.error ?? null,
          summary: summarize(activeSet, read?.ledger ?? null),
        };
      }),
    [environmentConnections, ledgers.data, activeSet],
  );

  const environmentIds = useMemo(
    () => new Set(environmentConnections.map((item) => item.id)),
    [environmentConnections],
  );
  const historyCount = useMigrations(
    (state) => state.history.filter((record) => environmentIds.has(record.connectionId)).length,
  );

  const summary = summarize(activeSet, currentLedger);
  const foreign = useMemo(() => foreignEntries(activeSet, currentLedger), [activeSet, currentLedger]);
  const newest = newestApplied(activeSet, currentLedger);

  /**
   * Files join the set already open, so a folder can arrive in pieces. With no set
   * open yet, one is started and named after whatever was dropped.
   */
  const onFiles = useCallback(
    (drop: FolderDrop) => {
      const setId = activeSet?.id ?? createSet(drop.name);
      const report = addFiles(setId, drop.files);
      chooseSet(connection.id, setId);
      setLastImport(report);
      setPane("migrations");
    },
    [activeSet?.id, createSet, addFiles, chooseSet, connection.id],
  );

  const pageImport = useMigrationImport(onFiles);

  function start(direction: MigrationDirection, plan: RunPlan, recordOnly = false) {
    // A plan with nothing in it but a blocker still opens, so the dialog can say why.
    if (plan.steps.length === 0 && !plan.blockedBy) return;
    setProgress(null);
    setPendingRun({ ...plan, direction, recordOnly });
  }

  /** Marking never runs SQL, so a missing revert file is no obstacle. */
  function markPlan(steps: MigrationStep[]): RunPlan {
    return { steps, blockedBy: null };
  }

  function closeRun() {
    if (running) return;
    setPendingRun(null);
    setProgress(null);
  }

  async function execute() {
    const plan = pendingRun;
    if (!plan || !activeSet) return;
    stopRef.current = false;
    setRunning(true);

    let steps: RunProgress[] = plan.steps.map((step) => ({
      version: step.version,
      name: step.name,
      status: "waiting",
    }));
    setProgress(steps);

    const patch = (index: number, change: Partial<RunProgress>) => {
      steps = steps.map((item, position) => (position === index ? { ...item, ...change } : item));
      setProgress(steps);
    };
    const skipFrom = (index: number) => {
      steps = steps.map((item, position) =>
        position >= index && item.status === "waiting" ? { ...item, status: "skipped" } : item,
      );
      setProgress(steps);
    };

    for (const [index, step] of plan.steps.entries()) {
      if (stopRef.current) {
        skipFrom(index);
        break;
      }
      const sql = plan.direction === "apply" ? step.applySql : step.revertSql;
      if (!sql && !plan.recordOnly) {
        patch(index, { status: "failed", error: "No revert file for this migration." });
        skipFrom(index + 1);
        break;
      }
      patch(index, { status: "running" });
      try {
        const result = await api.migrate(connection.url, {
          direction: plan.direction,
          version: step.version,
          name: step.name,
          checksum: step.checksum,
          setName: activeSet.name,
          sql: sql ?? "",
          ledgerSchema,
          recordOnly: plan.recordOnly,
        });
        patch(index, { status: "ok", durationMs: result.durationMs });
        recordRun({
          setId: activeSet.id,
          setName: activeSet.name,
          connectionId: connection.id,
          connectionName: connection.name,
          direction: plan.direction,
          version: step.version,
          name: step.name,
          status: "ok",
          recorded: plan.recordOnly,
          durationMs: result.durationMs,
        });
      } catch (caught) {
        const error = caught instanceof Error ? caught.message : String(caught);
        patch(index, { status: "failed", error });
        skipFrom(index + 1);
        recordRun({
          setId: activeSet.id,
          setName: activeSet.name,
          connectionId: connection.id,
          connectionName: connection.name,
          direction: plan.direction,
          version: step.version,
          name: step.name,
          status: "failed",
          durationMs: 0,
          error,
        });
        break;
      }
    }

    setRunning(false);
    ledgers.reload();
    tables.reload();
  }

  function openInEditor(sql: string) {
    setDraft(connection.id, sql);
    clearActiveSaved(connection.id, null);
    router.push(`/${encodeURIComponent(connection.id)}/query`);
  }

  function runAgainst(connectionId: string) {
    if (connectionId === connection.id) return;
    router.push(`/${encodeURIComponent(connectionId)}/migrations`);
  }

  function compareWith(targetId: string) {
    useExplorer.getState().setCompareTarget(connection.id, targetId);
    router.push(`/${encodeURIComponent(connection.id)}/diff`);
  }

  function newSet() {
    const name = window.prompt("Name this migration set", "Migrations");
    if (name === null) return;
    const id = createSet(name.trim() || "Migrations");
    chooseSet(connection.id, id);
    setLastImport(null);
  }

  function renameActiveSet() {
    if (!activeSet) return;
    const name = window.prompt("Rename this migration set", activeSet.name);
    if (name === null) return;
    renameSet(activeSet.id, name);
  }

  /** Files chosen for one migration's revert are labelled so the merge pairs them up. */
  async function takeRevertFile(list: FileList | null) {
    const file = list?.[0];
    const version = revertFor;
    setRevertFor(null);
    if (!file || !version || !activeSet) return;
    const report = addFiles(activeSet.id, [
      { path: `revert/${version}_${file.name}`, text: await file.text() },
    ]);
    setLastImport(report);
  }

  function toggleRow(version: string) {
    setExpanded((current) =>
      current.includes(version)
        ? current.filter((item) => item !== version)
        : [...current, version],
    );
  }

  if (sets.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <Header />
        {pane === "history" ? (
          <ScrollArea className="min-h-0 flex-1">
            <MigrationHistory connectionIds={environmentConnections.map((item) => item.id)} />
          </ScrollArea>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6">
            <MigrationDropZone onFiles={onFiles} className="w-full max-w-xl" />
            <p className="max-w-xl text-center text-xs text-muted-foreground">
              YTDB records every migration it runs in{" "}
              <code className="font-mono">
                {ledgerSchema}.{LEDGER_TABLE}
              </code>{" "}
              in the database it ran against, so each environment answers for itself what it has
              and has not had.
            </p>
          </div>
        )}
        <Footer
          caption="No migrations imported yet"
          pane={pane}
          onPaneChange={setPane}
          historyCount={historyCount}
        />
      </div>
    );
  }

  const applyAll = applyPlan(activeSet, currentLedger);
  const revertAll = revertPlan(activeSet, currentLedger);
  const busy = running || ledgers.loading;

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
    >
      <Header>
        <SetPicker
          activeName={activeSet?.name ?? "No folder"}
          sets={sets.map((item) => ({ id: item.id, name: item.name, steps: item.steps.length }))}
          activeId={activeSet?.id ?? null}
          onSelect={(id) => chooseSet(connection.id, id)}
          onCreate={newSet}
          onRename={renameActiveSet}
          onRemove={(id) => removeSet(id)}
        />
        <TargetPicker
          environments={environments}
          targetId={connection.id}
          onSelect={runAgainst}
        />
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={ledgers.loading}
            title="Re-read every environment's ledger"
            onClick={() => ledgers.reload()}
          >
            <RefreshCwIcon data-icon="inline-start" className={cn(ledgers.loading && "animate-spin")} />
            Refresh
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDragging(true)}>
            <FolderUpIcon data-icon="inline-start" />
            Import
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button size="icon-sm" variant="ghost" aria-label="More migration actions" />}
              className="cursor-pointer"
            >
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-64">
              <DropdownMenuItem
                disabled={busy || applyAll.steps.length === 0}
                onClick={() => start("apply", markPlan(applyAll.steps), true)}
              >
                <ClipboardCheckIcon />
                Mark {applyAll.steps.length} as already applied
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={busy || revertAll.steps.length === 0}
                onClick={() => start("revert", revertAll)}
              >
                <UndoIcon />
                Revert everything on {connection.name}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setEditingLedger(true)}>
                <TableIcon />
                Ledger table: {ledgerSchema}.{LEDGER_TABLE}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            disabled={busy || applyAll.steps.length === 0}
            onClick={() => start("apply", applyAll)}
          >
            <PlayIcon data-icon="inline-start" />
            {applyAll.steps.length === 0
              ? "Nothing pending"
              : `Apply ${applyAll.steps.length} to ${connection.name}`}
          </Button>
        </div>
      </Header>

      {partners.length === 0 && (
        <p className="border-b bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground">
          Only {connection.name} is tracked here.{" "}
          <Link href="/" className="text-foreground underline underline-offset-4">
            Link it to the same database in another environment
          </Link>{" "}
          to track both side by side.
        </p>
      )}

      {lastImport && (
        <ImportNote report={lastImport} onDismiss={() => setLastImport(null)} />
      )}

      {pageImport.error && (
        <p className="border-b bg-destructive/5 px-4 py-1.5 text-xs text-destructive">
          {pageImport.error}
        </p>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col">
        {pane === "history" ? (
          <ScrollArea className="min-h-0 flex-1">
            <MigrationHistory connectionIds={environmentConnections.map((item) => item.id)} />
          </ScrollArea>
        ) : current?.error ? (
          <p className="flex-1 px-4 py-6 font-mono text-xs text-destructive">{current.error}</p>
        ) : (
          <>
          <EnvironmentHeader
            environments={environments}
            targetId={connection.id}
            caption={listCaption(summary, ledgers.loading)}
            loading={ledgers.loading}
            onSelect={runAgainst}
            onCompare={compareWith}
          />
          <ScrollArea className={cn("min-h-0 flex-1", ledgers.loading && "opacity-70")}>
            {(activeSet?.steps.length ?? 0) === 0 && (
              <div className="p-6">
                <MigrationDropZone
                  onFiles={onFiles}
                  compact
                  hint="Drop .sql files here to fill this set. They can arrive a folder at a time or one at a time."
                />
              </div>
            )}
            {(activeSet?.steps ?? []).map((step) => (
              <MigrationRow
                key={step.version}
                step={step}
                targetId={connection.id}
                status={stepStatus(step, currentLedger)}
                environments={environments.map((environment) => ({
                  connection: environment.connection,
                  status: stepStatus(step, environment.ledger),
                  entry: ledgerEntry(step, environment.ledger),
                  error: environment.error,
                }))}
                isNewestApplied={newest?.version === step.version}
                expanded={expanded.includes(step.version)}
                busy={busy}
                onToggle={() => toggleRow(step.version)}
                actions={{
                  // Applying a row applies everything still pending up to it, so
                  // the target can never end up with a gap in the middle.
                  onApplyThrough: () =>
                    start("apply", applyPlan(activeSet, currentLedger, step.version)),
                  onApplyOne: () => start("apply", { steps: [step], blockedBy: null }),
                  onRevertThrough: () =>
                    start("revert", revertPlan(activeSet, currentLedger, step.version)),
                  onMarkApplied: () => start("apply", markPlan([step]), true),
                  onMarkPending: () => start("revert", markPlan([step]), true),
                  onAttachRevert: () => {
                    setRevertFor(step.version);
                    window.requestAnimationFrame(() => revertInputRef.current?.click());
                  },
                  onRemove: () => activeSet && removeStep(activeSet.id, step.version),
                  onOpenInEditor: openInEditor,
                }}
              />
            ))}
            {foreign.length > 0 && <ForeignList entries={foreign} connectionName={connection.name} />}
          </ScrollArea>
          </>
        )}

        {dragging && (
          <div
            className="absolute inset-0 z-20 flex items-center justify-center bg-background/85 p-6"
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void pageImport.importFrom(event.dataTransfer);
            }}
          >
            <MigrationDropZone onFiles={onFiles} className="w-full max-w-xl bg-background" />
          </div>
        )}
      </div>

      <Footer
        pane={pane}
        onPaneChange={setPane}
        historyCount={historyCount}
        caption={statusLine({
            name: activeSet?.name ?? "",
            connectionName: connection.name,
            summary,
            initialized: currentLedger?.initialized ?? null,
            loading: ledgers.loading,
          foundIn: currentLedger?.initialized ? currentLedger.schema : null,
          configuredSchema: ledgerSchema,
        })}
      />

      <input
        ref={revertInputRef}
        type="file"
        accept=".sql"
        className="sr-only"
        onChange={(event) => {
          void takeRevertFile(event.target.files);
          event.target.value = "";
        }}
      />

      {editingLedger && (
      <LedgerSchemaDialog
        schema={ledgerSchema}
        found={environments
          .filter((item) => item.ledger?.initialized)
          .map((item) => ({ name: item.connection.name, schema: item.ledger?.schema ?? ledgerSchema }))}
        onOpenChange={setEditingLedger}
        onSave={(next) => {
          setLedgerSchema(next);
          ledgers.reload();
        }}
      />
      )}

      {pendingRun && (
        <MigrationRunDialog
          open
          direction={pendingRun.direction}
          connection={connection}
          steps={pendingRun.steps}
          blockedBy={pendingRun.blockedBy}
          progress={progress}
          running={running}
          recordOnly={pendingRun.recordOnly ?? false}
          onRun={() => void execute()}
          onStop={() => {
            stopRef.current = true;
          }}
          onClose={closeRun}
        />
      )}
    </div>
  );
}

function Footer({
  caption,
  pane,
  onPaneChange,
  historyCount,
}: {
  caption: string;
  pane: Pane;
  onPaneChange: (pane: Pane) => void;
  historyCount: number;
}) {
  return (
    <footer className="flex shrink-0 items-center gap-2 border-t px-4 py-1.5 text-xs text-muted-foreground">
      <span className="min-w-0 truncate">{caption}</span>
      <div className="ml-auto">
        <PaneToggle
          label="Migrations pane"
          value={pane}
          onChange={onPaneChange}
          options={[
            { value: "migrations", label: "Migrations" },
            { value: "history", label: historyCount > 0 ? `History (${historyCount})` : "History" },
          ]}
        />
      </div>
    </footer>
  );
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
      <Layers2Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="font-medium">Migrations</span>
      {children}
    </header>
  );
}

function SetPicker({
  activeId,
  activeName,
  sets,
  onSelect,
  onCreate,
  onRename,
  onRemove,
}: {
  activeId: string | null;
  activeName: string;
  sets: { id: string; name: string; steps: number }[];
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-lg bg-muted/70 px-2 text-xs outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-open:bg-muted">
        <span className="max-w-40 truncate font-medium">{activeName}</span>
        <ChevronsUpDownIcon className="size-3 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        {sets.map((item) => (
          <DropdownMenuItem
            key={item.id}
            onClick={() => onSelect(item.id)}
            className={item.id === activeId ? "font-medium" : undefined}
          >
            <span className="min-w-0 flex-1 truncate">{item.name}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{item.steps}</span>
          </DropdownMenuItem>
        ))}
        {sets.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onClick={onCreate}>
          <PlusIcon />
          New empty set
        </DropdownMenuItem>
        {activeId && (
          <>
            <DropdownMenuItem onClick={onRename}>
              <PencilIcon />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => onRemove(activeId)}>
              Forget this set
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ImportNote({
  report,
  onDismiss,
}: {
  report: MergeReport;
  onDismiss: () => void;
}) {
  const parts: string[] = [];
  if (report.added > 0) parts.push(`added ${report.added}`);
  if (report.updated > 0) parts.push(`updated ${report.updated}`);
  if (report.reverts > 0) parts.push(`${report.reverts} revert file${report.reverts === 1 ? "" : "s"}`);
  return (
    <div className="flex items-start gap-2 border-b bg-muted/30 px-4 py-1.5 text-xs">
      <span className="min-w-0 flex-1">
        {parts.length > 0 ? `Imported: ${parts.join(", ")}` : "Nothing new in those files"}
        {report.skipped.length > 0 && (
          <span className="text-muted-foreground">
            {" "}
            · skipped {report.skipped.slice(0, 2).join(", ")}
            {report.skipped.length > 2 && ` and ${report.skipped.length - 2} more`}
          </span>
        )}
      </span>
      <Button size="xs" variant="ghost" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}

function ForeignList({
  entries,
  connectionName,
}: {
  entries: { version: string; name: string; appliedAt: string; setName: string | null }[];
  connectionName: string;
}) {
  return (
    <div className="border-t bg-muted/20">
      <p className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground">
        <TriangleAlertIcon className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        Applied on {connectionName} but not in this folder — the folder may be out of date.
      </p>
      {entries.map((entry) => (
        <div key={entry.version} className="flex items-center gap-2 px-4 py-1.5 text-xs opacity-70">
          <StatusMark status="applied" />
          <span className="shrink-0 font-mono text-muted-foreground">{entry.version}</span>
          <span className="min-w-0 flex-1 truncate">{entry.name || "—"}</span>
          <span className="shrink-0 text-muted-foreground/70">
            {new Date(entry.appliedAt).toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The left-hand caption of the column header: what the folder holds. */
function listCaption(summary: ReturnType<typeof summarize>, loading: boolean): string {
  if (loading && summary.total === 0) return "Reading…";
  const migrations = `${summary.total} migration${summary.total === 1 ? "" : "s"}`;
  return summary.foreign > 0
    ? `${migrations} · ${summary.foreign} more applied but missing from this folder`
    : migrations;
}

function statusLine({
  name,
  connectionName,
  summary,
  initialized,
  loading,
  foundIn,
  configuredSchema,
}: {
  name: string;
  connectionName: string;
  summary: ReturnType<typeof summarize>;
  initialized: boolean | null;
  loading: boolean;
  /** The schema this database's ledger was actually found in. */
  foundIn: string | null;
  configuredSchema: string;
}): string {
  if (loading && initialized === null) return "Reading ledgers…";
  if (initialized === false) {
    return `${connectionName} has never had a migration run by YTDB, so all ${summary.total} are pending`;
  }
  const parts: string[] = [];
  if (summary.pending === 0) parts.push(`${connectionName} is up to date with ${name}`);
  else parts.push(`${summary.pending} of ${summary.total} still to apply to ${connectionName}`);
  if (summary.drifted > 0) {
    parts.push(`${summary.drifted} file${summary.drifted === 1 ? "" : "s"} changed since it ran`);
  }
  if (foundIn && foundIn !== configuredSchema) {
    parts.push(`ledger kept in ${foundIn}, not ${configuredSchema}`);
  }
  return parts.join(" · ");
}
