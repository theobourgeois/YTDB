"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { CaretUpDownIcon, ChevronDownIcon, ChevronRightIcon, FolderOpenIcon, MoreIcon, NoteIcon, RefreshIcon, SearchIcon, StackIcon, PlusIcon, ClipboardCheckIcon, WarningIcon, XIcon } from "@/components/icons";
import { ConnectionColorMark } from "@/components/connections/connection-color";
import { useExplorerContext } from "@/components/explorer/explorer-provider";
import { ViewHeader } from "@/components/explorer/view-header";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchField } from "@/components/ui/search-field";
import { useAsync } from "@/hooks/use-async";
import { api } from "@/lib/api";
import { buildHistory } from "@/lib/migrations/history";
import {
  applyPlan,
  discoverMigrations,
  matchesFilter,
  scopeLedger,
  summarize,
  type DiscoveredMigration,
  type SetSummary,
} from "@/lib/migrations/status";
import type { AdoptEntry, LedgerResult, MigrationSet, RepoCheckout } from "@/lib/migrations/types";
import { useSharedLayoutPartners } from "@/lib/store/explorer";
import {
  useListFilter,
  useMigrations,
  useRepoRoot,
  type ListFilter,
  type ListStatusFilter,
} from "@/lib/store/migrations";
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
  const removeSet = useMigrations((state) => state.removeSet);
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

  const { scope, root, checkout } = useRepoRoot(connection.id);
  const setRepoRoot = useMigrations((state) => state.setRepoRoot);
  const setRepoCheckout = useMigrations((state) => state.setRepoCheckout);
  const filter = useListFilter(scope);
  const setListFilter = useMigrations((state) => state.setListFilter);
  const repo = useRepo(root, checkout);
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

  const cardEnvironments = useCallback(
    (set: MigrationSet): CardEnvironment[] =>
      environmentConnections.map((item) => ({
        connection: item,
        summary: summarize(set, ledgers.data?.[item.id]?.ledger ?? null),
        read: Boolean(ledgers.data?.[item.id]?.ledger),
        error: ledgers.data?.[item.id]?.error ?? null,
      })),
    [environmentConnections, ledgers.data],
  );

  const passes = useCallback(
    (set: MigrationSet) =>
      matchesFilter(
        set,
        cardEnvironments(set).map((item) => ({
          connectionId: item.connection.id,
          summary: item.summary,
          read: item.read,
        })),
        filter,
      ),
    [cardEnvironments, filter],
  );

  const shownRepoSets = useMemo(() => repoSets.filter(passes), [repoSets, passes]);
  const shownImported = useMemo(() => ordered.filter(passes), [ordered, passes]);
  const filtering = filter.query.trim() !== "" || filter.status !== "all";
  const hidden = repoSets.length + ordered.length - shownRepoSets.length - shownImported.length;

  function forgetImported() {
    for (const set of sets) removeSet(set.id);
  }

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
          <FolderCaption
            root={repo.data?.root ?? root}
            git={repo.data?.git ?? null}
            checkouts={repo.data?.checkouts ?? []}
            checkout={repo.data?.checkout ?? null}
            onEdit={() => setEditingRoot(true)}
            onPick={(path) => setRepoCheckout(scope, path)}
          />
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
          {(root || sets.length > 0) && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button size="icon-sm" variant="ghost" aria-label="More migration actions" />}
                className="cursor-pointer"
              >
                <MoreIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-72">
                {root && (
                  <>
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
                  </>
                )}
                {sets.length > 0 && (
                  <>
                    {root && <DropdownMenuSeparator />}
                    <DropdownMenuItem variant="destructive" onClick={forgetImported}>
                      Forget {sets.length} imported migration{sets.length === 1 ? "" : "s"}
                    </DropdownMenuItem>
                  </>
                )}
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
            ledgerSchema={ledgerSchema}
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
        <>
        <FilterBar
          filter={filter}
          environments={environmentConnections}
          hidden={hidden}
          onChange={(patch) => setListFilter(scope, patch)}
        />
        <ScrollArea className="min-h-0 flex-1">
          {shownRepoSets.map((set) => (
            <MigrationCard
              key={set.id}
              set={set}
              href={`${base}/${encodeURIComponent(set.id)}`}
              environments={cardEnvironments(set)}
            />
          ))}
          {shownImported.length > 0 && root && (
            <p
              className="border-b px-4 pt-2.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
              title="Imported into this browser rather than read from the folder."
            >
              Imported
            </p>
          )}
          {shownImported.map((set) => (
            <MigrationCard
              key={set.id}
              set={set}
              href={`${base}/${encodeURIComponent(set.id)}`}
              environments={cardEnvironments(set)}
            />
          ))}
          {filtering && shownRepoSets.length === 0 && shownImported.length === 0 && (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              Nothing matches.{" "}
              <button
                type="button"
                className="cursor-pointer underline underline-offset-4 hover:text-foreground"
                onClick={() => setListFilter(scope, { query: "", status: "all" })}
              >
                Clear the filter
              </button>
            </p>
          )}
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
        </>
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

const STATUS_LABEL: Record<Exclude<ListStatusFilter, `pending:${string}`>, string> = {
  all: "All",
  pending: "Not fully applied",
  untouched: "Not started anywhere",
  complete: "Applied everywhere",
};

function statusLabel(status: ListStatusFilter, environments: Connection[]): string {
  if (status.startsWith("pending:")) {
    const target = environments.find((item) => item.id === status.slice("pending:".length));
    return target ? `Pending on ${target.name}` : STATUS_LABEL.pending;
  }
  return STATUS_LABEL[status as keyof typeof STATUS_LABEL];
}

/** Search and a status filter, sitting over the list like the sidebar's table search does. */
function FilterBar({
  filter,
  environments,
  hidden,
  onChange,
}: {
  filter: ListFilter;
  environments: Connection[];
  hidden: number;
  onChange: (patch: Partial<ListFilter>) => void;
}) {
  const active = filter.status !== "all";
  return (
    <div className="flex items-center gap-1 border-b px-2 py-1">
      <SearchField
        value={filter.query}
        onChange={(event) => onChange({ query: event.target.value })}
        placeholder="Search migrations"
        aria-label="Search migrations"
        className="min-w-0 flex-1"
        trailing={
          filter.query ? (
            <button
              type="button"
              aria-label="Clear search"
              className="cursor-pointer rounded p-0.5 hover:text-foreground"
              onClick={() => onChange({ query: "" })}
            >
              <XIcon className="size-3.5" />
            </button>
          ) : null
        }
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button size="sm" variant={active ? "outline" : "ghost"} />}
          className="cursor-pointer"
        >
          {statusLabel(filter.status, environments)}
          <ChevronDownIcon data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuRadioGroup
            value={filter.status}
            onValueChange={(value) => onChange({ status: value as ListStatusFilter })}
          >
            {(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((value) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {STATUS_LABEL[value]}
              </DropdownMenuRadioItem>
            ))}
            {environments.length > 1 && <DropdownMenuSeparator />}
            {environments.length > 1 &&
              environments.map((item) => (
                <DropdownMenuRadioItem key={item.id} value={`pending:${item.id}`}>
                  <ConnectionColorMark connection={item} className="size-1.5" />
                  Pending on {item.name}
                </DropdownMenuRadioItem>
              ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {hidden > 0 && (
        <span className="shrink-0 pr-1 text-[11px] tabular-nums text-muted-foreground">
          {hidden} hidden
        </span>
      )}
    </div>
  );
}

/**
 * Where the list is being read from, and which branch that folder is on right
 * now. When the repository has other worktrees with the same folder, the branch
 * opens a list of them to read from instead.
 */
function FolderCaption({
  root,
  git,
  checkouts,
  checkout,
  onEdit,
  onPick,
}: {
  root: string;
  git: { branch: string; commit: string; dirty: boolean } | null;
  checkouts: RepoCheckout[];
  checkout: string | null;
  onEdit: () => void;
  onPick: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  // The folder is searched too, so a Conductor workspace is found by its city as well as its branch.
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return checkouts;
    return checkouts.filter(
      (item) => item.branch.toLowerCase().includes(needle) || item.path.toLowerCase().includes(needle),
    );
  }, [checkouts, query]);
  const hover =
    "cursor-pointer rounded-md outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60";
  const branch = git && (
    <span className="shrink-0 rounded border px-1.5 font-mono text-[10px]">
      {git.branch}
      {git.dirty && "*"}
    </span>
  );

  return (
    <div className="flex min-w-0 items-center text-xs text-muted-foreground">
      <button
        type="button"
        title={`Reading from ${root}. Click to change.`}
        onClick={onEdit}
        className={cn("flex min-w-0 items-center gap-1.5 px-1.5 py-0.5", hover)}
      >
        <FolderOpenIcon className="size-3.5 shrink-0" />
        <span className="max-w-64 truncate font-mono text-[11px]">{shortenPath(root)}</span>
      </button>
      {git && checkouts.length > 1 ? (
        <Combobox<RepoCheckout>
          items={shown}
          filter={null}
          value={checkouts.find((item) => item.path === checkout) ?? null}
          inputValue={query}
          onInputValueChange={(next) => setQuery(next)}
          // Each opening starts from the whole list, not whatever was typed last time.
          onOpenChange={(open) => open && setQuery("")}
          itemToStringLabel={(item) => item.branch}
          isItemEqualToValue={(item, current) => item.path === current.path}
          onValueChange={(item) => item && onPick(item.path)}
        >
          <ComboboxPrimitive.Trigger
            title={`${git.branch} (${git.commit}${git.dirty ? ", uncommitted changes" : ""}). Read from another worktree.`}
            className={cn("flex shrink-0 items-center gap-0.5 px-1 py-0.5", hover)}
          >
            {branch}
            <CaretUpDownIcon className="size-3" />
          </ComboboxPrimitive.Trigger>
          <ComboboxContent className="w-max min-w-56">
            <div className="m-1 mb-0 flex h-8 items-center gap-1.5 rounded-lg px-2 text-muted-foreground focus-within:bg-muted/60">
              <SearchIcon className="size-3.5 shrink-0" />
              <ComboboxPrimitive.Input
                placeholder="Search worktrees"
                spellCheck={false}
                autoComplete="off"
                className="h-full min-w-0 flex-1 bg-transparent text-[0.8rem] text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>
            <ComboboxEmpty>No matching worktrees</ComboboxEmpty>
            <ComboboxList>
              {(item: RepoCheckout) => (
                <ComboboxItem key={item.path} value={item} title={item.path}>
                  <span className="font-mono text-xs">{item.branch}</span>
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      ) : (
        git && (
          <span className="px-1" title={`${git.branch} (${git.commit}${git.dirty ? ", uncommitted changes" : ""})`}>
            {branch}
          </span>
        )
      )}
    </div>
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
        <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
          <span className="truncate">{set.name}</span>
          {set.note && (
            <span title={set.note} className="shrink-0 text-muted-foreground">
              <NoteIcon className="size-3.5" />
            </span>
          )}
        </p>
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
