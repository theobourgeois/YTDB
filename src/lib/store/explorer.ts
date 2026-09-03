import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Connection, Filter, Sort, TableRef } from "../types";
import { tableKey } from "../types";
import { randomId } from "../utils";
import { useConnections } from "./connections";
import { migrateLegacyStorage } from "./storage-migration";

const STORAGE_KEY = "ytdb:explorer";
migrateLegacyStorage("db-studio:explorer", STORAGE_KEY);

export const DEFAULT_PAGE_SIZE = 50;

/** Sidebar state, per connection. */
export type BrowseState = {
  search: string;
  selectedSchemas: string[] | null;
  collapsedSchemas: string[];
  pinnedTables: string[];
  recentTables: string[];
  sidebarWidth: number;
  sidebarCollapsed: boolean;
};

/** Grid state, per table. */
export type TableState = {
  filters: Filter[];
  search: string;
  sort: Sort | null;
  columnWidths: Record<string, number>;
  hiddenColumns: string[];
  /** Explicit pin order. Missing means primary keys stay frozen. */
  pinnedColumns?: string[];
  page: number;
  pageSize: number;
};

const EMPTY_BROWSE: BrowseState = {
  search: "",
  selectedSchemas: null,
  collapsedSchemas: [],
  pinnedTables: [],
  recentTables: [],
  sidebarWidth: 256,
  sidebarCollapsed: false,
};
const EMPTY_TABLE: TableState = {
  filters: [],
  search: "",
  sort: null,
  columnWidths: {},
  hiddenColumns: [],
  page: 0,
  pageSize: DEFAULT_PAGE_SIZE,
};

const BROWSE_LAYOUT_KEYS = [
  "selectedSchemas",
  "collapsedSchemas",
  "pinnedTables",
] as const satisfies readonly (keyof BrowseState)[];

const BROWSE_SESSION_KEYS = [
  "search",
  "recentTables",
  "sidebarWidth",
  "sidebarCollapsed",
] as const satisfies readonly (keyof BrowseState)[];

const TABLE_LAYOUT_KEYS = [
  "columnWidths",
  "hiddenColumns",
  "pinnedColumns",
  "pageSize",
] as const satisfies readonly (keyof TableState)[];

const TABLE_SESSION_KEYS = [
  "filters",
  "search",
  "sort",
  "page",
] as const satisfies readonly (keyof TableState)[];

type ExplorerState = {
  browse: Record<string, BrowseState>;
  tables: Record<string, TableState>;
  setBrowse: (connectionId: string, patch: Partial<BrowseState>) => void;
  setTable: (connectionId: string, table: TableRef, patch: Partial<TableState>) => void;
  copyLayout: (fromScope: string, toScope: string) => void;
};

function tableStateKey(scope: string, table: TableRef): string {
  return `${scope}:${tableKey(table)}`;
}

function layoutScope(connectionId: string): string {
  const connection = useConnections.getState().connections.find((item) => item.id === connectionId);
  return connection?.layoutGroup ?? connectionId;
}

function pick<T extends object>(
  source: Partial<T>,
  keys: readonly (keyof T)[],
): Partial<T> {
  const next: Partial<T> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      next[key] = source[key];
    }
  }
  return next;
}

function overlayBrowse(layout: BrowseState | undefined, session: BrowseState | undefined): BrowseState {
  const legacy = session as (Partial<BrowseState> & { schema?: string | null }) | undefined;
  const hasSchemaSelection = legacy && "selectedSchemas" in legacy;
  const selectedFromSession = hasSchemaSelection
    ? (legacy.selectedSchemas ?? null)
    : legacy?.schema
      ? [legacy.schema]
      : null;
  return {
    ...EMPTY_BROWSE,
    ...session,
    selectedSchemas: selectedFromSession,
    ...(layout
      ? {
          selectedSchemas: layout.selectedSchemas,
          collapsedSchemas: layout.collapsedSchemas,
          pinnedTables: layout.pinnedTables,
        }
      : {}),
  };
}

function overlayTable(layout: TableState | undefined, session: TableState | undefined): TableState {
  return {
    ...EMPTY_TABLE,
    ...session,
    search: session?.search ?? EMPTY_TABLE.search,
    hiddenColumns: session?.hiddenColumns ?? EMPTY_TABLE.hiddenColumns,
    ...(layout
      ? {
          columnWidths: layout.columnWidths,
          hiddenColumns: layout.hiddenColumns,
          pinnedColumns: layout.pinnedColumns,
          pageSize: layout.pageSize,
        }
      : {}),
  };
}

export const useExplorer = create<ExplorerState>()(
  persist(
    (set) => ({
      browse: {},
      tables: {},
      setBrowse: (connectionId, patch) =>
        set((state) => {
          const layoutKey = layoutScope(connectionId);
          const layoutPatch = pick(patch, BROWSE_LAYOUT_KEYS);
          const sessionPatch = pick(patch, BROWSE_SESSION_KEYS);
          const browse = { ...state.browse };
          if (layoutKey === connectionId) {
            browse[connectionId] = {
              ...(browse[connectionId] ?? EMPTY_BROWSE),
              ...layoutPatch,
              ...sessionPatch,
            };
            return { browse };
          }
          if (Object.keys(layoutPatch).length > 0) {
            browse[layoutKey] = { ...(browse[layoutKey] ?? EMPTY_BROWSE), ...layoutPatch };
          }
          if (Object.keys(sessionPatch).length > 0) {
            browse[connectionId] = { ...(browse[connectionId] ?? EMPTY_BROWSE), ...sessionPatch };
          }
          return { browse };
        }),
      setTable: (connectionId, table, patch) =>
        set((state) => {
          const layoutKey = tableStateKey(layoutScope(connectionId), table);
          const sessionKey = tableStateKey(connectionId, table);
          const layoutPatch = pick(patch, TABLE_LAYOUT_KEYS);
          const sessionPatch = pick(patch, TABLE_SESSION_KEYS);
          const tables = { ...state.tables };
          if (layoutKey === sessionKey) {
            tables[sessionKey] = {
              ...(tables[sessionKey] ?? EMPTY_TABLE),
              ...layoutPatch,
              ...sessionPatch,
            };
            return { tables };
          }
          if (Object.keys(layoutPatch).length > 0) {
            tables[layoutKey] = { ...(tables[layoutKey] ?? EMPTY_TABLE), ...layoutPatch };
          }
          if (Object.keys(sessionPatch).length > 0) {
            tables[sessionKey] = { ...(tables[sessionKey] ?? EMPTY_TABLE), ...sessionPatch };
          }
          return { tables };
        }),
      copyLayout: (fromScope, toScope) =>
        set((state) => {
          if (fromScope === toScope) return state;
          const browse = { ...state.browse };
          const fromBrowse = browse[fromScope];
          if (fromBrowse) {
            browse[toScope] = {
              ...(browse[toScope] ?? EMPTY_BROWSE),
              ...pick(fromBrowse, BROWSE_LAYOUT_KEYS),
            };
          }
          const tables = { ...state.tables };
          const prefix = `${fromScope}:`;
          for (const [key, value] of Object.entries(state.tables)) {
            if (!key.startsWith(prefix)) continue;
            const destKey = `${toScope}:${key.slice(prefix.length)}`;
            tables[destKey] = {
              ...(tables[destKey] ?? EMPTY_TABLE),
              ...pick(value, TABLE_LAYOUT_KEYS),
            };
          }
          return { browse, tables };
        }),
    }),
    { name: STORAGE_KEY },
  ),
);

export function useBrowseState(connectionId: string) {
  const layoutKey = useConnections(
    (state) => state.connections.find((item) => item.id === connectionId)?.layoutGroup ?? connectionId,
  );
  const layout = useExplorer((state) =>
    layoutKey === connectionId ? undefined : state.browse[layoutKey],
  );
  const session = useExplorer((state) => state.browse[connectionId]);
  const setBrowse = useExplorer((state) => state.setBrowse);
  return [
    overlayBrowse(layout, session),
    (patch: Partial<BrowseState>) => setBrowse(connectionId, patch),
  ] as const;
}

export function useTableState(connectionId: string, table: TableRef) {
  const layoutKey = useConnections(
    (state) => state.connections.find((item) => item.id === connectionId)?.layoutGroup ?? connectionId,
  );
  const layout = useExplorer((state) =>
    layoutKey === connectionId ? undefined : state.tables[tableStateKey(layoutKey, table)],
  );
  const session = useExplorer((state) => state.tables[tableStateKey(connectionId, table)]);
  const setTable = useExplorer((state) => state.setTable);
  return [
    overlayTable(layout, session),
    (patch: Partial<TableState>) => setTable(connectionId, table, patch),
  ] as const;
}

/** Link connections so they share pins, hidden columns, widths, and schema filters. */
export function syncLayoutSharing(sourceId: string, shareWithIds: string[]): void {
  const members = [...new Set([sourceId, ...shareWithIds])];
  const { connections, update } = useConnections.getState();
  const explorer = useExplorer.getState();
  const source = connections.find((connection) => connection.id === sourceId);
  if (!source) return;

  const groups = new Map<string, string[]>();
  for (const connection of connections) {
    if (!connection.layoutGroup) continue;
    const list = groups.get(connection.layoutGroup) ?? [];
    list.push(connection.id);
    groups.set(connection.layoutGroup, list);
  }

  const previousGroup = source.layoutGroup;
  const previousMembers = previousGroup ? (groups.get(previousGroup) ?? [sourceId]) : [sourceId];
  const leavers = previousMembers.filter((id) => !members.includes(id));

  for (const id of leavers) {
    explorer.copyLayout(previousGroup ?? sourceId, id);
    update(id, { layoutGroup: undefined });
  }

  if (previousGroup) {
    const remaining = previousMembers.filter((id) => !leavers.includes(id) && id !== sourceId);
    if (remaining.length === 1) {
      const lastId = remaining[0];
      if (lastId) {
        explorer.copyLayout(previousGroup, lastId);
        update(lastId, { layoutGroup: undefined });
      }
    }
  }

  if (members.length <= 1) {
    if (previousGroup) {
      explorer.copyLayout(previousGroup, sourceId);
      update(sourceId, { layoutGroup: undefined });
    }
    return;
  }

  const groupId = previousGroup ?? randomId();
  if (!previousGroup) explorer.copyLayout(sourceId, groupId);

  for (const id of members) {
    const connection = connections.find((item) => item.id === id);
    if (!connection) continue;
    if (connection.layoutGroup && connection.layoutGroup !== groupId) {
      const oldGroup = connection.layoutGroup;
      const leftover = (groups.get(oldGroup) ?? []).filter(
        (memberId) => memberId !== id && !members.includes(memberId),
      );
      if (leftover.length === 1) {
        const lastId = leftover[0];
        if (lastId) {
          explorer.copyLayout(oldGroup, lastId);
          update(lastId, { layoutGroup: undefined });
        }
      } else if (leftover.length === 0) {
        /* group dissolves */
      }
    }
    update(id, { layoutGroup: groupId });
  }
}

const EMPTY_PARTNERS: Connection[] = [];

export function useSharedLayoutPartners(connectionId: string) {
  const connections = useConnections((state) => state.connections);
  const layoutGroup = useConnections(
    (state) => state.connections.find((item) => item.id === connectionId)?.layoutGroup,
  );
  if (!layoutGroup) return EMPTY_PARTNERS;
  return connections.filter(
    (item) => item.layoutGroup === layoutGroup && item.id !== connectionId,
  );
}
