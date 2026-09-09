import { create } from "zustand";
import { persist } from "zustand/middleware";
import { logUiAction } from "../activity/client";
import { emptySet, mergeFiles, parseMigrationFiles, type ImportedFile, type MergeReport } from "../migrations/parse";
import {
  DEFAULT_LEDGER_SCHEMA,
  isLedgerSchema,
  type MigrationDirection,
  type MigrationSet,
} from "../migrations/types";
import { randomId } from "../utils";

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

type MigrationsState = {
  sets: MigrationSet[];
  /** The set each connection is looking at, by connection id. */
  activeSet: Record<string, string>;
  history: MigrationRunRecord[];
  /**
   * Schema the ledger table lives in, for every connection. Kept workspace-wide so
   * dev and prod look in the same place — comparing them means nothing otherwise.
   */
  ledgerSchema: string;
  setLedgerSchema: (schema: string) => void;
  /** Starts an empty set, ready for files to be added to it. */
  createSet: (name: string) => string;
  /** Folds files into a set, adding what is new and updating what is not. */
  addFiles: (setId: string, files: ImportedFile[]) => MergeReport;
  renameSet: (id: string, name: string) => void;
  removeSet: (id: string) => void;
  /** Drops one migration from a set, without touching any database. */
  removeStep: (setId: string, version: string) => void;
  setActive: (connectionId: string, setId: string) => void;
  record: (entry: Omit<MigrationRunRecord, "id" | "ranAt">) => void;
  clearHistory: (setId?: string) => void;
};

export const useMigrations = create<MigrationsState>()(
  persist(
    (set, get) => ({
      sets: [],
      activeSet: {},
      history: [],
      ledgerSchema: DEFAULT_LEDGER_SCHEMA,
      setLedgerSchema: (schema) => {
        if (!isLedgerSchema(schema)) return;
        set({ ledgerSchema: schema });
      },
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
      renameSet: (id, name) => {
        const clean = name.trim().replace(/\s+/g, " ").slice(0, 80);
        if (!clean) return;
        set((state) => ({
          sets: state.sets.map((candidate) =>
            candidate.id === id ? { ...candidate, name: clean } : candidate,
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
        set((state) => {
          const activeSet = { ...state.activeSet };
          for (const [connectionId, setId] of Object.entries(activeSet)) {
            if (setId === id) delete activeSet[connectionId];
          }
          return { sets: state.sets.filter((candidate) => candidate.id !== id), activeSet };
        });
        logUiAction("migrations.remove", { name: removed?.name });
      },
      setActive: (connectionId, setId) =>
        set((state) => ({ activeSet: { ...state.activeSet, [connectionId]: setId } })),
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

/** The set a connection is working with: the one it chose, else the newest imported. */
export function useActiveSet(connectionId: string): MigrationSet | null {
  const sets = useMigrations((state) => state.sets);
  const activeId = useMigrations((state) => state.activeSet[connectionId]);
  if (sets.length === 0) return null;
  const chosen = sets.find((candidate) => candidate.id === activeId);
  if (chosen) return chosen;
  return [...sets].sort((a, b) => b.importedAt - a.importedAt)[0] ?? null;
}
