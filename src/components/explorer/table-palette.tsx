"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { DatabaseIcon, HistoryIcon, PinIcon, SearchIcon, Table2Icon } from "lucide-react";
import { ConnectionColorMark } from "@/components/connections/connection-color";
import { api } from "@/lib/api";
import { useConnections } from "@/lib/store/connections";
import { useBrowseState, useExplorer } from "@/lib/store/explorer";
import { dismissPalettes, registerPaletteCloser } from "@/lib/palettes";
import { rankFuzzy, rankFuzzyMulti } from "@/lib/fuzzy";
import { tableKey, type Connection, type TableInfo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useExplorerContext } from "./explorer-provider";

const RECENT_LIMIT = 12;

const SECTION_LABEL = {
  pinned: "Pinned",
  recent: "Recent",
  tables: "Tables",
  connections: "Connections",
} as const;

type Section = keyof typeof SECTION_LABEL;

type TableRow = {
  type: "table";
  key: string;
  table: TableInfo;
  pinned: boolean;
  recent?: boolean;
  section?: Section;
};

type ConnectionRow = {
  type: "connection";
  key: string;
  connection: Connection;
  current: boolean;
  section?: Section;
};

type Row = TableRow | ConnectionRow;

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return text;
  const lowerText = text.toLocaleLowerCase();
  const lowerQuery = query.toLocaleLowerCase();
  const match = lowerText.indexOf(lowerQuery);
  if (match === -1) return text;
  return (
    <>
      {text.slice(0, match)}
      <mark className="rounded-[3px] bg-yellow-300/90 px-px text-yellow-950 dark:bg-yellow-400/85 dark:text-yellow-950">
        {text.slice(match, match + query.length)}
      </mark>
      {text.slice(match + query.length)}
    </>
  );
}

function tableHref(connectionId: string, table: TableInfo): string {
  return `/${connectionId}/${encodeURIComponent(table.schema)}/${encodeURIComponent(table.name)}`;
}

function connectionHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function connectionTexts(connection: Connection): string[] {
  return [connection.name, connectionHost(connection.url)].filter(Boolean);
}

function compareTables(left: TableInfo, right: TableInfo): number {
  const priority = new Map([
    ["public", 0],
    ["auth", 1],
  ]);
  const leftPriority = priority.get(left.schema) ?? 2;
  const rightPriority = priority.get(right.schema) ?? 2;
  return leftPriority - rightPriority || left.schema.localeCompare(right.schema) || left.name.localeCompare(right.name);
}

function withSection<T extends Row>(rows: T[], section: Section): T[] {
  return rows.map((row, index) => (index === 0 ? { ...row, section } : row));
}

function parseTableQuery(query: string): { schema: string | null; table: string } {
  const trimmed = query.trim();
  const colon = trimmed.indexOf(":");
  if (colon === -1) return { schema: null, table: trimmed };
  return {
    schema: trimmed.slice(0, colon).trim(),
    table: trimmed.slice(colon + 1).trim(),
  };
}

function schemasMatching(needle: string, schemas: string[]): string[] {
  if (!needle) return schemas;
  const lower = needle.toLocaleLowerCase();
  const exact = schemas.filter((schema) => schema.toLocaleLowerCase() === lower);
  if (exact.length > 0) return exact;
  const prefix = schemas.filter((schema) => schema.toLocaleLowerCase().startsWith(lower));
  if (prefix.length > 0) return prefix;
  return rankFuzzy(needle, schemas, (schema) => schema).map((hit) => hit.item);
}

function useOptionalTables(url: string | null) {
  const [cache] = useState(() => new Map<string, TableInfo[]>());
  const [settled, setSettled] = useState<{
    url: string;
    data?: TableInfo[];
    error: string | null;
  }>({ url: "", error: null });

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    api
      .tables(url, controller.signal)
      .then((data) => {
        cache.set(url, data);
        setSettled({ url, data, error: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const error = err instanceof Error ? err.message : String(err);
        setSettled((prev) => ({
          url,
          data: prev.url === url ? prev.data : cache.get(url),
          error,
        }));
      });
    return () => controller.abort();
  }, [cache, url]);

  if (!url) {
    return { data: undefined, error: null, loading: false };
  }

  const cached = settled.url === url ? settled.data : cache.get(url);
  return {
    data: cached,
    error: settled.url === url ? settled.error : null,
    loading: cached === undefined,
  };
}

export function TablePalette() {
  const router = useRouter();
  const params = useParams<{ connectionId: string; schema?: string; table?: string }>();
  const { connection, tables } = useExplorerContext();
  const connections = useConnections((state) => state.connections);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [scopedConnectionId, setScopedConnectionId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const scopedConnection = connections.find((item) => item.id === scopedConnectionId) ?? null;
  const targetConnection = scopedConnection ?? connection;
  const remoteUrl =
    scopedConnection && scopedConnection.id !== connection.id ? scopedConnection.url : null;
  const remoteTables = useOptionalTables(remoteUrl);
  const [currentBrowse, setBrowse] = useBrowseState(connection.id);
  const [targetBrowse, setTargetBrowse] = useBrowseState(targetConnection.id);
  const browse = targetConnection.id === connection.id ? currentBrowse : targetBrowse;
  const allTables = useMemo(
    () => (remoteUrl ? (remoteTables.data ?? []) : (tables.data ?? [])),
    [remoteTables.data, remoteUrl, tables.data],
  );
  const tablesLoading = remoteUrl ? remoteTables.loading : tables.loading;
  const tablesError = remoteUrl ? remoteTables.error : null;
  const schemas = useMemo(
    () => [...new Set(allTables.map((table) => table.schema))],
    [allTables],
  );
  const selectedSchemas =
    browse.selectedSchemas === null
      ? null
      : browse.selectedSchemas.filter((schema) => schemas.includes(schema));
  const visibleTables = useMemo(
    () =>
      selectedSchemas === null
        ? allTables
        : allTables.filter((table) => selectedSchemas.includes(table.schema)),
    [allTables, selectedSchemas],
  );

  const pinnedKeys = browse.pinnedTables;
  const recentKeys = browse.recentTables;

  const parsedQuery = useMemo(() => parseTableQuery(query), [query]);
  const highlightQuery = parsedQuery.table || (parsedQuery.schema ? "" : query.trim());

  const rows = useMemo((): Row[] => {
    const pinnedSet = new Set(pinnedKeys);
    const recentSet = new Set(recentKeys);
    const scopedSchemas =
      parsedQuery.schema === null ? null : schemasMatching(parsedQuery.schema, schemas);
    const scopedTables =
      scopedSchemas === null
        ? visibleTables
        : allTables.filter((table) => scopedSchemas.includes(table.schema));
    const tableByKey = new Map(scopedTables.map((table) => [tableKey(table), table]));
    const pinnedTables = pinnedKeys.flatMap((key) => {
      const table = tableByKey.get(key);
      return table ? [table] : [];
    });
    const recentTables = recentKeys.flatMap((key) => {
      const table = tableByKey.get(key);
      if (!table || pinnedSet.has(key)) return [];
      return [table];
    });

    const toTableRow = (
      table: TableInfo,
      extras: Pick<TableRow, "pinned" | "recent">,
    ): TableRow => ({
      type: "table",
      key: `table:${tableKey(table)}`,
      table,
      ...extras,
    });

    const toConnectionRow = (item: Connection): ConnectionRow => ({
      type: "connection",
      key: `connection:${item.id}`,
      connection: item,
      current: item.id === connection.id,
    });

    const tableQuery = parsedQuery.schema === null ? query.trim() : parsedQuery.table;
    const showConnections = scopedConnection === null && parsedQuery.schema === null;

    if (!tableQuery) {
      const listed = new Set([
        ...pinnedTables.map((table) => tableKey(table)),
        ...recentTables.map((table) => tableKey(table)),
      ]);
      const rest = scopedTables.filter((table) => !listed.has(tableKey(table))).sort(compareTables);
      const otherConnections = showConnections
        ? connections.filter((item) => item.id !== connection.id)
        : [];
      return [
        ...withSection(
          pinnedTables.map((table) => toTableRow(table, { pinned: true })),
          "pinned",
        ),
        ...withSection(
          recentTables.map((table) => toTableRow(table, { pinned: false, recent: true })),
          "recent",
        ),
        ...withSection(
          rest.map((table) => toTableRow(table, { pinned: false, recent: recentSet.has(tableKey(table)) })),
          "tables",
        ),
        ...withSection(otherConnections.map(toConnectionRow), "connections"),
      ];
    }

    const tableHits = rankFuzzyMulti(tableQuery, scopedTables, (table) =>
      parsedQuery.schema === null
        ? [table.name, `${table.schema}.${table.name}`, table.schema]
        : [table.name],
    )
      .map((hit) => ({
        ...hit,
        score:
          hit.score +
          (pinnedSet.has(tableKey(hit.item)) ? 80 : 0) +
          (recentSet.has(tableKey(hit.item)) ? 40 : 0),
      }))
      .sort((left, right) => right.score - left.score)
      .map((hit) =>
        toTableRow(hit.item, {
          pinned: pinnedSet.has(tableKey(hit.item)),
          recent: recentSet.has(tableKey(hit.item)),
        }),
      );

    const connectionHits = showConnections
      ? rankFuzzyMulti(query, connections, connectionTexts).map((hit) => toConnectionRow(hit.item))
      : [];

    return [
      ...withSection(connectionHits, "connections"),
      ...withSection(tableHits, "tables"),
    ];
  }, [
    allTables,
    connection.id,
    connections,
    scopedConnection,
    parsedQuery.schema,
    parsedQuery.table,
    pinnedKeys,
    query,
    recentKeys,
    schemas,
    visibleTables,
  ]);

  const active = rows[index] ?? null;

  useEffect(() => {
    // A new search scope intentionally starts from its first result.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIndex(0);
  }, [query, open, scopedConnectionId]);

  useEffect(() => {
    const option = listRef.current?.querySelector("[data-active=true]");
    option?.scrollIntoView({ block: "nearest" });
  }, [index, rows]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!params.schema || !params.table) return;
    const key = `${decodeURIComponent(params.schema)}.${decodeURIComponent(params.table)}`;
    const current = useExplorer.getState().browse[connection.id]?.recentTables ?? [];
    if (current[0] === key) return;
    setBrowse({
      recentTables: [key, ...current.filter((item) => item !== key)].slice(0, RECENT_LIMIT),
    });
  }, [connection.id, params.schema, params.table, setBrowse]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        if (event.shiftKey) return;
        event.preventDefault();
        if (open) {
          inputRef.current?.select();
          return;
        }
        dismissPalettes();
        setQuery("");
        setIndex(0);
        setScopedConnectionId(null);
        setOpen(true);
        return;
      }

      if (open && event.key === "Escape") {
        event.preventDefault();
        close();
      }
    }

    function onPointerDown(event: PointerEvent) {
      if (!open) return;
      if (rootRef.current?.contains(event.target as Node)) return;
      close();
    }

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setQuery("");
    setIndex(0);
    setScopedConnectionId(null);
  }

  useEffect(() => registerPaletteCloser(close), []);

  function scopeInto(item: Connection) {
    setScopedConnectionId(item.id);
    setQuery("");
    setIndex(0);
  }

  function clearScope() {
    setScopedConnectionId(null);
    setIndex(0);
    inputRef.current?.focus();
  }

  function go(row: Row) {
    close();
    if (row.type === "connection") {
      if (row.connection.id !== connection.id) router.push(`/${row.connection.id}`);
      return;
    }
    router.push(tableHref(targetConnection.id, row.table));
  }

  function togglePin(table: TableInfo) {
    const key = tableKey(table);
    const pinnedTables = browse.pinnedTables.includes(key)
      ? browse.pinnedTables.filter((item) => item !== key)
      : [...browse.pinnedTables, key];
    const updateBrowse = targetConnection.id === connection.id ? setBrowse : setTargetBrowse;
    updateBrowse({ pinnedTables });
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (rows.length === 0) return;
      setIndex((current) => (current + 1) % rows.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (rows.length === 0) return;
      setIndex((current) => (current - 1 + rows.length) % rows.length);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      if (scopedConnection || event.shiftKey) return;
      if (active?.type === "connection") scopeInto(active.connection);
      return;
    }
    if (event.key === "Backspace" && query === "" && scopedConnection) {
      event.preventDefault();
      clearScope();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey && active?.type === "table") {
        togglePin(active.table);
      } else if (active) {
        go(active);
      }
    }
  }

  const currentKey =
    targetConnection.id === connection.id && params.schema && params.table
      ? `${decodeURIComponent(params.schema)}.${decodeURIComponent(params.table)}`
      : null;

  if (!open) return null;

  return (
    <div
      ref={rootRef}
      data-table-palette=""
      className="fixed top-3 left-1/2 z-50 flex w-[min(36rem,calc(100%-1.5rem))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10"
    >
      <div className="flex items-center gap-2 border-b px-3">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        {scopedConnection && (
          <button
            type="button"
            onClick={clearScope}
            aria-label={`Stop searching ${scopedConnection.name}`}
            className="flex h-6 max-w-40 shrink-0 items-center gap-1.5 rounded-md bg-muted px-1.5 text-xs outline-none hover:bg-muted/80"
          >
            <ConnectionColorMark connection={scopedConnection} className="size-2" />
            <span className="truncate">{scopedConnection.name}</span>
          </button>
        )}
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onInputKeyDown}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          placeholder={
            scopedConnection
              ? `Search tables in ${scopedConnection.name}`
              : "Go to table (schema:name)"
          }
          aria-label={
            scopedConnection
              ? `Go to table in ${scopedConnection.name}`
              : "Go to table or connection"
          }
          className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div
        ref={listRef}
        role="listbox"
        aria-label={scopedConnection ? `Tables in ${scopedConnection.name}` : "Tables and connections"}
        className="max-h-[min(24rem,50vh)] overflow-auto py-1"
      >
        {tablesLoading && allTables.length === 0 && rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">Loading tables…</p>
        ) : tablesError && allTables.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">{tablesError}</p>
        ) : rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            {query.trim() ? "No matches" : "No tables"}
          </p>
        ) : (
          rows.map((row, rowIndex) => {
            const selected = rowIndex === index;
            if (row.type === "connection") {
              const host = connectionHost(row.connection.url);
              return (
                <div key={row.key}>
                  {row.section && (
                    <p className="px-3 pt-2 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                      {SECTION_LABEL[row.section]}
                    </p>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-active={selected || undefined}
                    onMouseEnter={() => setIndex(rowIndex)}
                    onClick={() => go(row)}
                    className={cn(
                      "flex h-8 w-full cursor-pointer items-center gap-2 px-3 text-left text-[13px] outline-none",
                      selected && "bg-primary/10",
                    )}
                  >
                    <DatabaseIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <ConnectionColorMark connection={row.connection} className="size-2" />
                    <span className={cn("min-w-0 truncate", row.current && "font-medium")}>
                      <HighlightedText text={row.connection.name} query={highlightQuery} />
                    </span>
                    <span className="ml-auto flex min-w-0 shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                      {selected ? (
                        <span>Tab to search</span>
                      ) : (
                        <span className="max-w-36 truncate">
                          {row.current ? "current" : host || "connection"}
                        </span>
                      )}
                    </span>
                  </button>
                </div>
              );
            }

            const current = tableKey(row.table) === currentKey;
            return (
              <div key={row.key}>
                {row.section && (
                  <p className="px-3 pt-2 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                    {SECTION_LABEL[row.section]}
                  </p>
                )}
                <div
                  onMouseEnter={() => setIndex(rowIndex)}
                  className={cn(
                    "group/table-result flex items-center",
                    selected && "bg-primary/10",
                  )}
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-active={selected || undefined}
                    onClick={() => go(row)}
                    className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 pl-3 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
                  >
                    {row.recent && !row.pinned ? (
                      <HistoryIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <Table2Icon className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className={cn("min-w-0 truncate", current && "font-medium")}>
                      <HighlightedText text={row.table.name} query={highlightQuery} />
                    </span>
                    <span className="ml-auto flex min-w-0 shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                      {row.table.kind === "view" && <span>view</span>}
                      <span className="max-w-36 truncate">{row.table.schema}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`${row.pinned ? "Unpin" : "Pin"} ${tableKey(row.table)}`}
                    aria-pressed={row.pinned}
                    title={row.pinned ? "Unpin table" : "Pin table"}
                    onClick={() => togglePin(row.table)}
                    className={cn(
                      "mr-2 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none transition-[color,background-color,opacity] hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:opacity-100 group-hover/table-result:opacity-100",
                      (row.pinned || selected) && "opacity-100",
                      row.pinned && "text-foreground",
                    )}
                  >
                    <PinIcon className={cn("size-3.5", row.pinned && "fill-current")} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="flex items-center justify-end gap-3 border-t px-3 py-1.5 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <kbd className="font-mono text-foreground/70">↑↓</kbd>
          Navigate
        </span>
        <span className="flex items-center gap-1">
          <kbd className="font-mono text-foreground/70">↵</kbd>
          Open
        </span>
        {active?.type === "table" && (
          <span className="flex items-center gap-1">
            <kbd className="font-mono text-foreground/70">⇧↵</kbd>
            {active.pinned ? "Unpin" : "Pin"}
          </span>
        )}
      </div>
    </div>
  );
}
