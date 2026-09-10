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

type QueriesState = {
  drafts: Record<string, string>;
  /** Height of the SQL editor pane, in pixels. */
  editorHeight: number;
  history: QueryHistoryItem[];
  setDraft: (connectionId: string, sql: string) => void;
  setEditorHeight: (height: number) => void;
  record: (connectionId: string, sql: string) => void;
  remove: (id: string) => void;
};

export const DEFAULT_EDITOR_HEIGHT = 224;
export const MIN_EDITOR_HEIGHT = 144;
export const MAX_EDITOR_HEIGHT = 800;

const MAX_HISTORY_ITEMS = 200;
const MAX_HISTORY_CHARACTERS = 1_000_000;

export const useQueries = create<QueriesState>()(
  persist(
    (set) => ({
      drafts: {},
      editorHeight: DEFAULT_EDITOR_HEIGHT,
      history: [],
      setDraft: (connectionId, sql) =>
        set((state) => ({ drafts: { ...state.drafts, [connectionId]: sql } })),
      setEditorHeight: (height) =>
        set({
          editorHeight: Math.min(MAX_EDITOR_HEIGHT, Math.max(MIN_EDITOR_HEIGHT, Math.round(height))),
        }),
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
    }),
    { name: STORAGE_KEY },
  ),
);
