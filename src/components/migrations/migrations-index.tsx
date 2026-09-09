"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { ChevronRightIcon, Layers2Icon, PlusIcon } from "lucide-react";
import { ConnectionColorMark } from "@/components/connections/connection-color";
import { useExplorerContext } from "@/components/explorer/explorer-provider";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAsync } from "@/hooks/use-async";
import { api } from "@/lib/api";
import { buildHistory } from "@/lib/migrations/history";
import { discoverMigrations, summarize, type DiscoveredMigration, type SetSummary } from "@/lib/migrations/status";
import type { LedgerResult, MigrationSet } from "@/lib/migrations/types";
import { useSharedLayoutPartners } from "@/lib/store/explorer";
import { useMigrations } from "@/lib/store/migrations";
import type { Connection } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MigrationHistory } from "./migration-history";
import { setFromLedger } from "@/lib/migrations/parse";
import { MigrationDropZone, type FolderDrop } from "./migration-import";
import { MigrationsFooter, type MigrationsPane } from "./migrations-footer";

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

  const environmentConnections = useMemo(() => [connection, ...partners], [connection, partners]);
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
        environmentConnections.map((item) =>
          api.ledger(item.url, ledgerSchema, undefined, true).catch(() => null),
        ),
      );
      const byVersion = new Map<string, { version: string; name: string; applySql?: string; revertSql?: string }>();
      for (const read of reads) {
        for (const entry of read?.entries ?? []) {
          if (entry.setName?.trim() !== name) continue;
          const existing = byVersion.get(entry.version);
          // Any environment that kept the SQL will do; prefer one that has it.
          if (!existing?.applySql) byVersion.set(entry.version, entry);
        }
      }
      const { set: rebuilt, missing } = setFromLedger(name, [...byVersion.values()]);
      if (rebuilt.steps.length === 0) {
        setRestoreError(
          `${name} was applied before YTDB kept the SQL, so it cannot be rebuilt. Drop its folder instead.`,
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

  function newEmpty() {
    const name = window.prompt("Name this migration", "");
    if (name === null) return;
    const setId = createSet(name.trim() || "Untitled migration");
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
        sets.map((item) => item.name),
      ),
    [environmentConnections, ledgers.data, sets],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <Layers2Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-medium">Migrations</span>
        <span className="truncate text-xs text-muted-foreground">{connection.name}</span>
        {sets.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={newEmpty}>
              <PlusIcon data-icon="inline-start" />
              New migration
            </Button>
          </div>
        )}
      </header>

      {pane === "history" ? (
        <ScrollArea className="min-h-0 flex-1">
          <MigrationHistory
            events={historyEvents}
            connections={environmentConnections}
            loading={ledgers.loading}
          />
        </ScrollArea>
      ) : sets.length === 0 && discovered.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6">
          <MigrationDropZone onFiles={onFiles} className="w-full max-w-xl" />
          <p className="max-w-xl text-center text-xs text-muted-foreground">
            Each folder you drop becomes a migration of its own — open it to apply it to an
            environment, see where it stands, or revert it.
          </p>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
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
              <p className="px-4 py-2 text-xs text-muted-foreground">
                Run against these databases but not imported here. The SQL was stored with each
                one, so it can be opened without the folder.
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
          <div className="p-4">
            <MigrationDropZone
              onFiles={onFiles}
              compact
              hint={
                sets.length === 0
                  ? "Drop a folder of .sql files to start a migration."
                  : "Drop another folder to start a new migration."
              }
              className="w-full"
            />
          </div>
        </ScrollArea>
      )}

      <MigrationsFooter
        caption={caption(sets.length, discovered.length)}
        pane={pane}
        onPaneChange={setPane}
        historyCount={historyEvents.length}
      />
    </div>
  );
}

function caption(imported: number, discovered: number): string {
  if (imported === 0 && discovered === 0) return "No migrations yet";
  const parts = [`${imported} migration${imported === 1 ? "" : "s"}`];
  if (discovered > 0) {
    parts.push(`${discovered} more run against these databases but not imported here`);
  }
  return parts.join(" · ");
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
