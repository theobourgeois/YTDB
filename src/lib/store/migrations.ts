import { create } from "zustand";
import { persist } from "zustand/middleware";
import { logUiAction } from "../activity/client";
import { emptySet, mergeFiles, parseMigrationFiles, type ImportedFile, type MergeReport } from "../migrations/parse";
import {
  DEFAULT_LEDGER_SCHEMA,
  MAX_NOTE_LENGTH,
  isLedgerSchema,
  type MigrationDirection,
  type MigrationSet,
} from "../migrations/types";
import { randomId } from "../utils";
import { useConnections } from "./connections";

const STORAGE_KEY = "ytdb:migrations";

/** Enough history to retrace a release; small enough to keep localStorage usable. */
const MAX_HISTORY_ITEMS = 300;

/** One attempt to run one migration against one connection, successful or not. */
export type MigrationRunRecord = {
  id: string;
  setId: string;
  setName: string;
  connectionId: string;
  /** Kept alongside the id so history stays readable after a connection is renamed or removed. */
  connectionName: string;
  direction: MigrationDirection;
  version: string;
  name: string;
  status: "ok" | "failed";
  /** True when the ledger was written without running any SQL. */
  recorded?: boolean;
  durationMs: number;
  error?: string;
  ranAt: number;
};

/** Which migrations the list shows. `pending:<connectionId>` narrows to one environment. */
export type ListStatusFilter = "all" | "pending" | "untouched" | "complete" | `pending:${string}`;

export type ListFilter = {
  query: string;
  status: ListStatusFilter;
};

export const DEFAULT_LIST_FILTER: ListFilter = { query: "", status: "all" };

type MigrationsState = {
  sets: MigrationSet[];
  history: MigrationRunRecord[];
  /**
   * Schema the ledger table lives in, for every connection. Kept workspace-wide so
   * dev and prod look in the same place — comparing them means nothing otherwise.
   */
  ledgerSchema: string;
  setLedgerSchema: (schema: string) => void;
  /**
   * The migrations folder each set of environments reads from, keyed by the
   * layout group the connections share (or the connection id when they share
   * none). Dev and prod of one project point at the same folder; another project
   * points at its own.
   */
  repoRoots: Record<string, string>;
  setRepoRoot: (scope: string, root: string | null) => void;
  /**
   * The git worktree each scope reads its folder out of instead, by the
   * checkout's top folder. Unset means the folder exactly as saved.
   */
  repoCheckouts: Record<string, string>;
  setRepoCheckout: (scope: string, checkout: string | null) => void;
  /** How the list is narrowed, kept per set of environments so it is still there next visit. */
  listFilters: Record<string, ListFilter>;
  setListFilter: (scope: string, patch: Partial<ListFilter>) => void;
  /** Starts an empty set, ready for files to be added to it. */
  createSet: (name: string) => string;
  /** Folds files into a set, adding what is new and updating what is not. */
  addFiles: (setId: string, files: ImportedFile[]) => MergeReport;
  /** Takes a set built elsewhere — rebuilt from a ledger, say — as it stands. */
  adoptSet: (set: MigrationSet) => string;
  renameSet: (id: string, name: string) => void;
  /** Sets an imported migration's note; an empty one removes it. */
  setNote: (id: string, note: string) => void;
  removeSet: (id: string) => void;
  /** Drops one migration from a set, without touching any database. */
  removeStep: (setId: string, version: string) => void;
  record: (entry: Omit<MigrationRunRecord, "id" | "ranAt">) => void;
  clearHistory: (setId?: string) => void;
};

export const useMigrations = create<MigrationsState>()(
  persist(
    (set, get) => ({
      sets: [],
      history: [],
      ledgerSchema: DEFAULT_LEDGER_SCHEMA,
      setLedgerSchema: (schema) => {
        if (!isLedgerSchema(schema)) return;
        set({ ledgerSchema: schema });
      },
      listFilters: {},
      setListFilter: (scope, patch) =>
        set((state) => ({
          listFilters: {
            ...state.listFilters,
            [scope]: { ...(state.listFilters[scope] ?? DEFAULT_LIST_FILTER), ...patch },
          },
        })),
      repoRoots: {},
      setRepoRoot: (scope, root) =>
        set((state) => {
          const repoRoots = { ...state.repoRoots };
          const clean = root?.trim();
          if (clean) repoRoots[scope] = clean;
          else delete repoRoots[scope];
          logUiAction("migrations.folder", { set: Boolean(clean) });
          // A new folder may be another repository entirely, so the picked worktree goes with the old one.
          const repoCheckouts = { ...state.repoCheckouts };
          delete repoCheckouts[scope];
          return { repoRoots, repoCheckouts };
        }),
      repoCheckouts: {},
      setRepoCheckout: (scope, checkout) =>
        set((state) => {
          const repoCheckouts = { ...state.repoCheckouts };
          if (checkout) repoCheckouts[scope] = checkout;
          else delete repoCheckouts[scope];
          logUiAction("migrations.checkout", { set: Boolean(checkout) });
          return { repoCheckouts };
        }),
      createSet: (name) => {
        const created = emptySet(name);
        set((state) => ({ sets: [...state.sets, created] }));
        return created.id;
      },
      addFiles: (setId, files) => {
        const target = get().sets.find((candidate) => candidate.id === setId);
        const parsed = parseMigrationFiles(files);
        const report = mergeFiles(target?.steps ?? [], parsed);
        if (target) {
          set((state) => ({
            sets: state.sets.map((candidate) =>
              candidate.id === setId
                ? { ...candidate, steps: report.steps, skipped: report.skipped, importedAt: Date.now() }
                : candidate,
            ),
          }));
        }
        logUiAction("migrations.import", {
          name: target?.name,
          added: report.added,
          updated: report.updated,
          reverts: report.reverts,
          skipped: report.skipped.length,
        });
        return report;
      },
      adoptSet: (incoming) => {
        set((state) => ({ sets: [...state.sets, incoming] }));
        logUiAction("migrations.import", {
          name: incoming.name,
          migrations: incoming.steps.length,
          source: "ledger",
        });
        return incoming.id;
      },
      renameSet: (id, name) => {
        const clean = name.trim().replace(/\s+/g, " ").slice(0, 80);
        if (!clean) return;
        set((state) => ({
          sets: state.sets.map((candidate) =>
            candidate.id === id ? { ...candidate, name: clean } : candidate,
          ),
        }));
      },
      setNote: (id, note) => {
        const clean = note.trim().slice(0, MAX_NOTE_LENGTH) || undefined;
        set((state) => ({
          sets: state.sets.map((candidate) =>
            candidate.id === id ? { ...candidate, note: clean } : candidate,
          ),
        }));
      },
      removeStep: (setId, version) =>
        set((state) => ({
          sets: state.sets.map((candidate) =>
            candidate.id === setId
              ? { ...candidate, steps: candidate.steps.filter((step) => step.version !== version) }
              : candidate,
          ),
        })),
      removeSet: (id) => {
        const removed = get().sets.find((candidate) => candidate.id === id);
        set((state) => ({ sets: state.sets.filter((candidate) => candidate.id !== id) }));
        logUiAction("migrations.remove", { name: removed?.name });
      },
      record: (entry) =>
        set((state) => ({
          history: [
            { ...entry, id: randomId(), ranAt: Date.now() },
            ...state.history,
          ].slice(0, MAX_HISTORY_ITEMS),
        })),
      clearHistory: (setId) =>
        set((state) => ({
          history: setId ? state.history.filter((item) => item.setId !== setId) : [],
        })),
    }),
    { name: STORAGE_KEY },
  ),
);

export function useMigrationSet(setId: string): MigrationSet | null {
  return useMigrations((state) => state.sets.find((candidate) => candidate.id === setId) ?? null);
}

export function useListFilter(scope: string): ListFilter {
  return useMigrations((state) => state.listFilters[scope] ?? DEFAULT_LIST_FILTER);
}

/**
 * The folder this connection's environments read migrations from, if one is
 * set, and the worktree it is read out of when one was picked.
 */
export function useRepoRoot(connectionId: string): {
  scope: string;
  root: string | null;
  checkout: string | null;
} {
  const scope = useConnections(
    (state) => state.connections.find((item) => item.id === connectionId)?.layoutGroup ?? connectionId,
  );
  const root = useMigrations((state) => state.repoRoots[scope] ?? null);
  const checkout = useMigrations((state) => state.repoCheckouts[scope] ?? null);
  return { scope, root, checkout };
}
