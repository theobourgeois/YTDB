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
import { summarize, type SetSummary } from "@/lib/migrations/status";
import type { LedgerResult, MigrationSet } from "@/lib/migrations/types";
import { useSharedLayoutPartners } from "@/lib/store/explorer";
import { useMigrations } from "@/lib/store/migrations";
import type { Connection } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MigrationHistory } from "./migration-history";
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
  const addFiles = useMigrations((state) => state.addFiles);
  const ledgerSchema = useMigrations((state) => state.ledgerSchema);
  const runRecords = useMigrations((state) => state.history);
  const partners = useSharedLayoutPartners(connection.id);
  const [pane, setPane] = useState<MigrationsPane>("migrations");

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
      ) : sets.length === 0 ? (
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
          <div className="p-4">
            <MigrationDropZone
              onFiles={onFiles}
              compact
              hint="Drop another folder to start a new migration."
              className="w-full"
            />
          </div>
        </ScrollArea>
      )}

      <MigrationsFooter
        caption={
          sets.length === 0
            ? "No migrations yet"
            : `${sets.length} migration${sets.length === 1 ? "" : "s"}`
        }
        pane={pane}
        onPaneChange={setPane}
        historyCount={historyEvents.length}
      />
    </div>
  );
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
