import { create } from "zustand";
import { persist } from "zustand/middleware";
import { randomId } from "../utils";
import { migrateLegacyStorage } from "./storage-migration";

const STORAGE_KEY = "ytdb:queries";
migrateLegacyStorage("db-studio:queries", STORAGE_KEY);

export type QueryHistoryItem = {
  id: string;
  connectionId: string;
  sql: string;
  executedAt: number;
};

export type QueryFolder = {
  id: string;
  connectionId: string;
  name: string;
  collapsed: boolean;
  createdAt: number;
};

export type SavedQuery = {
  id: string;
  connectionId: string;
  folderId: string | null;
  name: string;
  sql: string;
  createdAt: number;
  updatedAt: number;
};

type SavedQueryInput = {
  name: string;
  sql: string;
  folderId: string | null;
};

type SavedQueryPatch = Partial<SavedQueryInput>;

type QueriesState = {
  drafts: Record<string, string>;
  history: QueryHistoryItem[];
  folders: QueryFolder[];
  saved: SavedQuery[];
  /** Saved query currently loaded in each connection's editor. */
  activeSaved: Record<string, string>;
  setDraft: (connectionId: string, sql: string) => void;
  record: (connectionId: string, sql: string) => void;
  remove: (id: string) => void;
  createFolder: (connectionId: string, name: string) => string;
  renameFolder: (id: string, name: string) => void;
  toggleFolder: (id: string) => void;
  removeFolder: (id: string) => void;
  saveQuery: (connectionId: string, input: SavedQueryInput) => string;
  updateSaved: (id: string, patch: SavedQueryPatch) => void;
  removeSaved: (id: string) => void;
  setActiveSaved: (connectionId: string, id: string | null) => void;
};

const MAX_HISTORY_ITEMS = 200;
const MAX_HISTORY_CHARACTERS = 1_000_000;
export const MAX_QUERY_NAME_LENGTH = 80;

function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, MAX_QUERY_NAME_LENGTH);
}

function withoutActive(activeSaved: Record<string, string>, ids: Set<string>) {
  const next = { ...activeSaved };
  for (const [connectionId, id] of Object.entries(next)) {
    if (ids.has(id)) delete next[connectionId];
  }
  return next;
}

export const useQueries = create<QueriesState>()(
  persist(
    (set, get) => ({
      drafts: {},
      history: [],
      folders: [],
      saved: [],
      activeSaved: {},
      setDraft: (connectionId, sql) =>
        set((state) => ({ drafts: { ...state.drafts, [connectionId]: sql } })),
      record: (connectionId, input) =>
        set((state) => {
          const sql = input.trim();
          if (!sql) return state;
          const existing = state.history.find(
            (item) => item.connectionId === connectionId && item.sql === sql,
          );
          const item: QueryHistoryItem = {
            id: existing?.id ?? randomId(),
            connectionId,
            sql,
            executedAt: Date.now(),
          };
          let storedItems = 0;
          let storedCharacters = 0;
          const history = [
            item,
            ...state.history.filter((candidate) => candidate.id !== item.id),
          ].filter((candidate) => {
            if (storedItems >= MAX_HISTORY_ITEMS) return false;
            if (storedCharacters + candidate.sql.length > MAX_HISTORY_CHARACTERS) return false;
            storedItems += 1;
            storedCharacters += candidate.sql.length;
            return true;
          });
          return { history };
        }),
      remove: (id) =>
        set((state) => ({ history: state.history.filter((item) => item.id !== id) })),
      createFolder: (connectionId, input) => {
        const id = randomId();
        const name = cleanName(input) || "Untitled folder";
        set((state) => ({
          folders: [
            ...state.folders,
            { id, connectionId, name, collapsed: false, createdAt: Date.now() },
          ],
        }));
        return id;
      },
      renameFolder: (id, input) => {
        const name = cleanName(input);
        if (!name) return;
        set((state) => ({
          folders: state.folders.map((folder) =>
            folder.id === id ? { ...folder, name } : folder,
          ),
        }));
      },
      toggleFolder: (id) =>
        set((state) => ({
          folders: state.folders.map((folder) =>
            folder.id === id ? { ...folder, collapsed: !folder.collapsed } : folder,
          ),
        })),
      removeFolder: (id) =>
        set((state) => ({
          folders: state.folders.filter((folder) => folder.id !== id),
          saved: state.saved.map((query) =>
            query.folderId === id ? { ...query, folderId: null } : query,
          ),
        })),
      saveQuery: (connectionId, input) => {
        const id = randomId();
        const now = Date.now();
        set((state) => ({
          saved: [
            ...state.saved,
            {
              id,
              connectionId,
              folderId: input.folderId,
              name: cleanName(input.name) || "Untitled query",
              sql: input.sql,
              createdAt: now,
              updatedAt: now,
            },
          ],
          activeSaved: { ...state.activeSaved, [connectionId]: id },
        }));
        return id;
      },
      updateSaved: (id, patch) =>
        set((state) => ({
          saved: state.saved.map((query) => {
            if (query.id !== id) return query;
            const name = patch.name === undefined ? query.name : cleanName(patch.name) || query.name;
            return {
              ...query,
              name,
              sql: patch.sql ?? query.sql,
              folderId: patch.folderId === undefined ? query.folderId : patch.folderId,
              updatedAt: patch.sql !== undefined && patch.sql !== query.sql ? Date.now() : query.updatedAt,
            };
          }),
        })),
      removeSaved: (id) =>
        set((state) => ({
          saved: state.saved.filter((query) => query.id !== id),
          activeSaved: withoutActive(state.activeSaved, new Set([id])),
        })),
      setActiveSaved: (connectionId, id) => {
        const { activeSaved } = get();
        if ((activeSaved[connectionId] ?? null) === id) return;
        set((state) => {
          const next = { ...state.activeSaved };
          if (id === null) delete next[connectionId];
          else next[connectionId] = id;
          return { activeSaved: next };
        });
      },
    }),
    { name: STORAGE_KEY },
  ),
);
