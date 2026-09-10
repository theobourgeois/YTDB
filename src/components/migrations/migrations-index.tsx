"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { ChevronRightIcon, FolderOpenIcon, MoreIcon, RefreshIcon, StackIcon, PlusIcon, ClipboardCheckIcon, WarningIcon } from "@/components/icons";
import { ConnectionColorMark } from "@/components/connections/connection-color";
import { useExplorerContext } from "@/components/explorer/explorer-provider";
import { ViewHeader } from "@/components/explorer/view-header";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAsync } from "@/hooks/use-async";
import { api } from "@/lib/api";
import { buildHistory } from "@/lib/migrations/history";
import {
  applyPlan,
  discoverMigrations,
  scopeLedger,
  summarize,
  type DiscoveredMigration,
  type SetSummary,
} from "@/lib/migrations/status";
import type { AdoptEntry, LedgerResult, MigrationSet } from "@/lib/migrations/types";
import { useSharedLayoutPartners } from "@/lib/store/explorer";
import { useMigrations, useRepoRoot } from "@/lib/store/migrations";
import type { Connection } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MigrationHistory } from "./migration-history";
import { setFromLedger } from "@/lib/migrations/parse";
import { MigrationDropZone, type FolderDrop } from "./migration-import";
import { MigrationNameDialog } from "./migration-name-dialog";
import { MigrationsFooter, type MigrationsPane } from "./migrations-footer";
import { AdoptDialog, type AdoptPlan } from "./adopt-dialog";
import { RepoRootDialog } from "./repo-root-dialog";
import { useRepo } from "./use-repo";

type LedgerRead = { ledger: LedgerResult | null; error: string | null };

/**
 * The list of migrations, each its own page. A migration is one folder of SQL
 * that gets applied to dev, then prod, and reverted if it has to be — so it is a
 * place you open, not a mode the screen is in.
 */
export function MigrationsIndex() {
  const router = useRouter();
  const { connection } = useExplorerContext();
  const sets = useMigrations((state) => state.sets);
  const createSet = useMigrations((state) => state.createSet);
  const adoptSet = useMigrations((state) => state.adoptSet);
  const addFiles = useMigrations((state) => state.addFiles);
  const ledgerSchema = useMigrations((state) => state.ledgerSchema);
  const runRecords = useMigrations((state) => state.history);
  const partners = useSharedLayoutPartners(connection.id);
  const [pane, setPane] = useState<MigrationsPane>("migrations");
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [editingRoot, setEditingRoot] = useState(false);
  const [adopting, setAdopting] = useState<AdoptPlan | null>(null);

  const environmentConnections = useMemo(() => [connection, ...partners], [connection, partners]);
  const ledgerKey = environmentConnections.map((item) => item.url).join("|");

  const { scope, root } = useRepoRoot(connection.id);
  const setRepoRoot = useMigrations((state) => state.setRepoRoot);
  const repo = useRepo(root);
  const repoSets = useMemo(
    () => [...(repo.data?.sets ?? [])].sort((a, b) => b.importedAt - a.importedAt),
    [repo.data],
  );

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

  const historyEvents = useMemo(
    () =>
      buildHistory(
        environmentConnections.map((item) => ({
          connection: item,
          ledger: ledgers.data?.[item.id]?.ledger ?? null,
        })),
        runRecords,
      ),
    [environmentConnections, ledgers.data, runRecords],
  );

  const base = `/${encodeURIComponent(connection.id)}/migrations`;

  const onFiles = useCallback(
    (drop: FolderDrop) => {
      const setId = createSet(drop.name);
      addFiles(setId, drop.files);
      router.push(`${base}/${encodeURIComponent(setId)}`);
    },
    [createSet, addFiles, router, base],
  );

  /**
   * Pulls a migration back out of the databases that ran it. The SQL is stored
   * with each ledger row, so a browser that never had the folder can still open
   * it, apply it elsewhere, and revert it.
   */
  async function restore(name: string) {
    setRestoring(name);
    setRestoreError(null);
    try {
      const reads = await Promise.all(
        environmentConnections.map(async (item) => {
          try {
            return { read: await api.ledger(item.url, ledgerSchema, undefined, true), error: null };
          } catch (caught) {
            return { read: null, error: caught instanceof Error ? caught.message : String(caught) };
          }
        }),
      );

      const failure = reads.find((item) => item.error);
      if (failure?.error) {
        setRestoreError(failure.error);
        return;
      }

      // A bridge older than this page ignores the request for SQL rather than
      // refusing it, and says nothing about it either. A current bridge always
      // answers — `false` means the ledger has no SQL columns, which is a
      // different problem with a different fix.
      const stale = reads.some((item) => item.read && item.read.withSql === undefined);

      const byVersion = new Map<string, { version: string; name: string; applySql?: string; revertSql?: string }>();
      for (const { read } of reads) {
        for (const entry of read?.entries ?? []) {
          if (entry.setName.trim() !== name) continue;
          const existing = byVersion.get(entry.version);
          // Any environment that kept the SQL will do; prefer one that has it.
          if (!existing?.applySql) byVersion.set(entry.version, entry);
        }
      }
      const { set: rebuilt, missing } = setFromLedger(name, [...byVersion.values()]);
      if (rebuilt.steps.length === 0) {
        setRestoreError(
          stale
            ? "The YTDB running on your machine is older than this page and cannot send stored SQL. Restart it with `npx @theobourgeois/ytdb@latest`."
            : `${name} was applied before YTDB stored SQL, so it cannot be rebuilt. Drop its folder instead.`,
        );
        return;
      }
      adoptSet(rebuilt);
      if (missing.length > 0) {
        setRestoreError(
          `Rebuilt ${rebuilt.steps.length} of ${rebuilt.steps.length + missing.length}. No SQL was stored for ${missing.join(", ")}.`,
        );
      }
      router.push(`${base}/${encodeURIComponent(rebuilt.id)}`);
    } catch (caught) {
      setRestoreError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRestoring(null);
    }
  }

  function newEmpty(name: string) {
    const setId = createSet(name);
    router.push(`${base}/${encodeURIComponent(setId)}`);
  }

  const ordered = useMemo(
    () => [...sets].sort((a, b) => b.importedAt - a.importedAt),
    [sets],
  );

  const discovered = useMemo(
    () =>
      discoverMigrations(
        environmentConnections.map((item) => ({
          connection: item,
          ledger: ledgers.data?.[item.id]?.ledger ?? null,
        })),
        [...repoSets, ...sets].map((item) => item.name),
      ),
    [environmentConnections, ledgers.data, repoSets, sets],
  );

  /** Every row the folder has that this connection's ledger does not. */
  const adoptable = useMemo((): AdoptPlan => {
    const ledger = ledgers.data?.[connection.id]?.ledger ?? null;
    const entries: AdoptEntry[] = [];
    let touched = 0;
    if (!ledger) return { sets: 0, entries };
    for (const set of repoSets) {
      const plan = applyPlan(set, scopeLedger(ledger, set.name));
      if (plan.steps.length === 0) continue;
      touched += 1;
      for (const step of plan.steps) {
        entries.push({
          setName: set.name,
          version: step.version,
          name: step.name,
          checksum: step.checksum,
          applySql: step.applySql,
          revertSql: step.revertSql,
        });
      }
    }
    return { sets: touched, entries };
  }, [ledgers.data, connection.id, repoSets]);

  const loading = ledgers.loading || repo.loading;
  const empty = repoSets.length === 0 && sets.length === 0 && discovered.length === 0;

  function reload() {
    ledgers.reload();
    repo.reload();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader>
        <StackIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-medium">Migrations</span>
        {root && (
          <FolderCaption root={root} git={repo.data?.git ?? null} onEdit={() => setEditingRoot(true)} />
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={loading}
            aria-label="Refresh"
            title={root ? "Re-read the folder and every environment's ledger" : "Re-read every environment's ledger"}
            onClick={reload}
          >
            <RefreshIcon className={cn(loading && "animate-spin")} />
          </Button>
          {!root && (
            <Button size="sm" variant="ghost" onClick={() => setEditingRoot(true)}>
              <FolderOpenIcon data-icon="inline-start" />
              Read from a folder
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setNaming(true)}>
            <PlusIcon data-icon="inline-start" />
            New migration
          </Button>
          {root && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button size="icon-sm" variant="ghost" aria-label="More migration actions" />}
                className="cursor-pointer"
              >
                <MoreIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-72">
                <DropdownMenuItem
                  disabled={loading || adoptable.entries.length === 0}
                  onClick={() => setAdopting(adoptable)}
                >
                  <ClipboardCheckIcon />
                  Mark everything as applied on {connection.name}
                  <span className="ml-auto pl-3 font-mono text-[11px] text-muted-foreground">
                    {adoptable.entries.length}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setEditingRoot(true)}>
                  <FolderOpenIcon />
                  Change folder…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </ViewHeader>

      {repo.error && (
        <p className="flex items-start gap-2 border-b bg-destructive/5 px-4 py-1.5 text-xs text-destructive">
          <WarningIcon className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{repo.error}</span>
          <Button size="xs" variant="ghost" onClick={() => setEditingRoot(true)}>
            Change folder
          </Button>
        </p>
      )}

      {pane === "history" ? (
        <ScrollArea className="min-h-0 flex-1">
          <MigrationHistory
            events={historyEvents}
            connections={environmentConnections}
            loading={ledgers.loading}
          />
        </ScrollArea>
      ) : empty && root && repo.loading ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">Reading {root}…</p>
      ) : empty && root ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="text-sm">Nothing in {root} yet.</p>
          <p className="max-w-md text-xs text-muted-foreground">
            Each folder inside it that holds .sql files becomes a migration here, the moment
            it exists on the branch you have checked out.
          </p>
        </div>
      ) : empty ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6">
          <MigrationDropZone onFiles={onFiles} className="w-full max-w-xl" />
          <p className="text-xs text-muted-foreground">
            Or{" "}
            <button
              type="button"
              className="cursor-pointer underline underline-offset-4 hover:text-foreground"
              onClick={() => setEditingRoot(true)}
            >
              read straight from a folder on this computer
            </button>
            , so nothing has to be imported.
          </p>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          {repoSets.map((set) => (
            <MigrationCard
              key={set.id}
              set={set}
              href={`${base}/${encodeURIComponent(set.id)}`}
              environments={environmentConnections.map((item) => ({
                connection: item,
                summary: summarize(set, ledgers.data?.[item.id]?.ledger ?? null),
                read: Boolean(ledgers.data?.[item.id]?.ledger),
                error: ledgers.data?.[item.id]?.error ?? null,
              }))}
            />
          ))}
          {ordered.length > 0 && root && (
            <p
              className="border-b px-4 pt-2.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
              title="Imported into this browser rather than read from the folder."
            >
              Imported
            </p>
          )}
          {ordered.map((set) => (
            <MigrationCard
              key={set.id}
              set={set}
              href={`${base}/${encodeURIComponent(set.id)}`}
              environments={environmentConnections.map((item) => ({
                connection: item,
                summary: summarize(set, ledgers.data?.[item.id]?.ledger ?? null),
                read: Boolean(ledgers.data?.[item.id]?.ledger),
                error: ledgers.data?.[item.id]?.error ?? null,
              }))}
            />
          ))}
          {discovered.length > 0 && (
            <div className="border-b bg-muted/20">
              <p
                className="px-4 pt-2.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
                title="Applied to a database from elsewhere. The SQL is kept in its ledger, so it opens without the folder."
              >
                In the ledger only
              </p>
              {discovered.map((item) => (
                <DiscoveredRow
                  key={item.name}
                  migration={item}
                  busy={restoring === item.name}
                  onOpen={() => void restore(item.name)}
                />
              ))}
              {restoreError && (
                <p className="px-4 pt-1 pb-2 text-xs text-destructive">{restoreError}</p>
              )}
            </div>
          )}
          {!root && (
            <div className="p-4">
              <MigrationDropZone onFiles={onFiles} compact className="w-full" />
            </div>
          )}
        </ScrollArea>
      )}

      <MigrationsFooter
        caption={caption(repoSets.length, sets.length, discovered.length, root !== null && repo.loading)}
        pane={pane}
        onPaneChange={setPane}
        historyCount={historyEvents.length}
      />

      {editingRoot && (
        <RepoRootDialog
          root={root}
          environmentNames={environmentConnections.map((item) => item.name)}
          onOpenChange={setEditingRoot}
          onSave={(next) => setRepoRoot(scope, next)}
        />
      )}

      {adopting && (
        <AdoptDialog
          connection={connection}
          ledgerSchema={ledgerSchema}
          plan={adopting}
          onDone={() => ledgers.reload()}
          onOpenChange={(open) => !open && setAdopting(null)}
        />
      )}

      <MigrationNameDialog
        open={naming}
        title="New migration"
        submitLabel="Create"
        onOpenChange={setNaming}
        onSubmit={newEmpty}
      />
    </div>
  );
}

function caption(onDisk: number, imported: number, discovered: number, reading: boolean): string {
  if (reading && onDisk === 0) return "Reading folder…";
  if (onDisk === 0 && imported === 0 && discovered === 0) return "No migrations yet";
  const parts: string[] = [];
  if (onDisk > 0) parts.push(`${onDisk} migration${onDisk === 1 ? "" : "s"} on disk`);
  if (imported > 0) parts.push(`${imported} imported`);
  if (discovered > 0) parts.push(`${discovered} in the ledger only`);
  return parts.join(" · ");
}

/** Where the list is being read from, and which branch that folder is on right now. */
function FolderCaption({
  root,
  git,
  onEdit,
}: {
  root: string;
  git: { branch: string; commit: string; dirty: boolean } | null;
  onEdit: () => void;
}) {
  return (
    <button
      type="button"
      title={`Reading from ${root}${git ? ` on ${git.branch} (${git.commit}${git.dirty ? ", uncommitted changes" : ""})` : ""}. Click to change.`}
      onClick={onEdit}
      className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <FolderOpenIcon className="size-3.5 shrink-0" />
      <span className="max-w-64 truncate font-mono text-[11px]">{shortenPath(root)}</span>
      {git && (
        <span className="shrink-0 rounded border px-1.5 font-mono text-[10px]">
          {git.branch}
          {git.dirty && "*"}
        </span>
      )}
    </button>
  );
}

/** The last two segments of a path, enough to tell folders apart without the whole thing. */
function shortenPath(path: string): string {
  const parts = path.split(/[\/]/).filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : path;
}

type CardEnvironment = {
  connection: Connection;
  summary: SetSummary;
  read: boolean;
  error: string | null;
};

function MigrationCard({
  set,
  href,
  environments,
}: {
  set: MigrationSet;
  href: string;
  environments: CardEnvironment[];
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 border-b px-4 py-3 outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{set.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {set.steps.length === 0
            ? "No files yet"
            : `${set.steps.length} migration${set.steps.length === 1 ? "" : "s"}`}
          {set.steps.length > 0 && ` · ${set.steps[0].version}–${set.steps.at(-1)?.version}`}
          {set.skipped.length > 0 && ` · ${set.skipped.length} skipped`}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {environments.map((environment) => (
          <EnvironmentPill key={environment.connection.id} environment={environment} />
        ))}
      </div>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/60" />
    </Link>
  );
}

/** A migration the ledgers know about but this browser has no files for. */
function DiscoveredRow({
  migration,
  busy,
  onOpen,
}: {
  migration: DiscoveredMigration;
  busy: boolean;
  onOpen: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-t px-4 py-2.5 first:border-t-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{migration.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {migration.total} migration{migration.total === 1 ? "" : "s"}
          {migration.versions.length > 0 &&
            ` · ${migration.versions[0]}–${migration.versions.at(-1)}`}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {migration.applied.map((environment) => (
          <span
            key={environment.connectionId}
            className="flex h-6 items-center gap-1.5 rounded-lg border border-dashed px-2 text-[11px] text-muted-foreground"
          >
            <span className="max-w-24 truncate">{environment.connectionName}</span>
            <span className="tabular-nums">
              {environment.count}/{migration.total}
            </span>
          </span>
        ))}
      </div>
      <Button size="xs" variant="outline" disabled={busy} onClick={onOpen}>
        {busy ? "Opening…" : "Open"}
      </Button>
    </div>
  );
}

/** Where one environment stands on one migration, at a glance. */
function EnvironmentPill({ environment }: { environment: CardEnvironment }) {
  const { connection, summary, read, error } = environment;
  const complete = read && summary.total > 0 && summary.pending === 0 && summary.drifted === 0;
  const untouched = read && summary.applied === 0 && summary.drifted === 0;
  return (
    <span
      title={
        error
          ? `${connection.name}: ${error}`
          : !read
            ? `${connection.name}: reading…`
            : `${connection.name}: ${summary.applied} of ${summary.total} applied`
      }
      className={cn(
        "flex h-6 items-center gap-1.5 rounded-lg border px-2 text-[11px]",
        error && "border-destructive/30 text-destructive",
        complete && "border-emerald-600/30 bg-emerald-500/10",
        !error && !complete && !untouched && "border-amber-600/30 bg-amber-500/10",
        untouched && "text-muted-foreground",
      )}
    >
      <ConnectionColorMark connection={connection} className="size-1.5" />
      <span className="max-w-24 truncate">{connection.name}</span>
      <span className="tabular-nums">
        {error ? "—" : !read ? "…" : `${summary.applied}/${summary.total}`}
      </span>
    </span>
  );
}
