"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { CheckIcon } from "lucide-react";
import { ConnectionDialog } from "@/components/connections/connection-dialog";
import { useConnections } from "@/lib/store/connections";
import { useBrowseState, useExplorer, syncLayoutSharing } from "@/lib/store/explorer";
import { useThemeStore } from "@/lib/store/theme";
import { applyTheme, THEMES, type Theme } from "@/lib/themes";
import { dismissPalettes, registerPaletteCloser } from "@/lib/palettes";
import { rankFuzzy } from "@/lib/fuzzy";
import { tableKey, type TableRef } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useExplorerContext } from "./explorer-provider";

type PaletteMode = "commands" | "themes";

type Command = {
  id: string;
  title: string;
  keywords: string[];
  enabled: boolean;
  keepOpen?: boolean;
  run: () => void;
};

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

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

function currentTable(params: { schema?: string; table?: string }): TableRef | null {
  if (!params.schema || !params.table) return null;
  return {
    schema: decodeURIComponent(params.schema),
    name: decodeURIComponent(params.table),
  };
}

export function CommandPalette() {
  const router = useRouter();
  const params = useParams<{ connectionId: string; schema?: string; table?: string }>();
  const { connection, tables } = useExplorerContext();
  const addConnection = useConnections((state) => state.add);
  const [browse, setBrowse] = useBrowseState(connection.id);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PaletteMode>("commands");
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<PaletteMode>(mode);

  const savedTheme = useThemeStore((state) => state.theme);
  const table = currentTable(params);
  const pinned = table ? browse.pinnedTables.includes(tableKey(table)) : false;
  const tableState = useExplorer((state) =>
    table ? state.tables[`${connection.id}:${tableKey(table)}`] : undefined,
  );

  const commands = useMemo((): Command[] => {
    return [
      {
        id: "reload-tables",
        title: "Reload Tables",
        keywords: ["refresh", "reload", "tables", "sync"],
        enabled: true,
        run: () => tables.reload(),
      },
      {
        id: "pin-table",
        title: pinned ? "Unpin Table" : "Pin Table",
        keywords: ["pin", "unpin", "favorite", "star"],
        enabled: table !== null,
        run: () => {
          if (!table) return;
          const key = tableKey(table);
          const pinnedTables = browse.pinnedTables.includes(key)
            ? browse.pinnedTables.filter((item) => item !== key)
            : [...browse.pinnedTables, key];
          setBrowse({ pinnedTables });
        },
      },
      {
        id: "clear-filters",
        title: "Clear Filters",
        keywords: ["filter", "reset", "remove"],
        enabled: table !== null,
        run: () => {
          if (!table) return;
          useExplorer.getState().setTable(connection.id, table, { filters: [], page: 0 });
        },
      },
      {
        id: "clear-search",
        title: "Clear Search",
        keywords: ["find", "search", "reset"],
        enabled: table !== null && Boolean(tableState?.search),
        run: () => {
          if (!table) return;
          useExplorer.getState().setTable(connection.id, table, { search: "", page: 0 });
        },
      },
      {
        id: "reset-columns",
        title: "Reset Columns",
        keywords: ["pin", "hide", "frozen", "layout", "show"],
        enabled: table !== null,
        run: () => {
          if (!table) return;
          useExplorer.getState().setTable(connection.id, table, {
            pinnedColumns: undefined,
            hiddenColumns: [],
          });
        },
      },
      {
        id: "copy-table",
        title: "Copy Schema.Table",
        keywords: ["copy", "name", "qualified"],
        enabled: table !== null,
        run: () => {
          if (!table) return;
          void writeClipboard(tableKey(table));
        },
      },
      {
        id: "color-theme",
        title: "Color Theme",
        keywords: ["theme", "appearance", "dark", "light", "color", "set", "preferences"],
        enabled: true,
        keepOpen: true,
        run: () => {
          const current = useThemeStore.getState().theme;
          const currentIndex = THEMES.findIndex((theme) => theme.id === current);
          setMode("themes");
          setQuery("");
          setIndex(currentIndex === -1 ? 0 : currentIndex);
        },
      },
      {
        id: "add-connection",
        title: "Add Connection",
        keywords: ["new", "database", "postgres"],
        enabled: true,
        run: () => setConnectionDialogOpen(true),
      },
    ];
  }, [browse.pinnedTables, connection.id, pinned, setBrowse, table, tableState?.search, tables]);

  const commandRows = useMemo(() => {
    if (!query.trim()) return commands;
    return rankFuzzy(query, commands, (command) =>
      [command.title, ...command.keywords].join(" "),
    ).map((hit) => hit.item);
  }, [commands, query]);

  const themeRows = useMemo(() => {
    if (!query.trim()) return [...THEMES];
    return rankFuzzy(query, [...THEMES], (theme) =>
      [theme.name, ...theme.keywords].join(" "),
    ).map((hit) => hit.item);
  }, [query]);

  const rows = mode === "themes" ? themeRows : commandRows;
  const activeCommand = mode === "commands" ? (commandRows[index] ?? null) : null;
  const activeTheme = mode === "themes" ? (themeRows[index] ?? null) : null;

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    if (mode === "themes" && !query.trim()) {
      const currentIndex = THEMES.findIndex((theme) => theme.id === useThemeStore.getState().theme);
      // Selecting the saved theme is an intentional state reset when the palette mode changes.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIndex(currentIndex === -1 ? 0 : currentIndex);
      return;
    }
    setIndex(0);
  }, [query, open, mode]);

  useEffect(() => {
    const option = listRef.current?.querySelector("[data-active=true]");
    option?.scrollIntoView({ block: "nearest" });
  }, [index, rows]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open, mode]);

  useEffect(() => {
    if (!open || mode !== "themes") return;
    const theme = themeRows[index];
    if (theme) applyTheme(theme.id);
  }, [open, mode, index, themeRows]);

  function dismiss(options?: { revertTheme?: boolean }) {
    if (options?.revertTheme && modeRef.current === "themes") {
      applyTheme(useThemeStore.getState().theme);
    }
    setOpen(false);
    setQuery("");
    setIndex(0);
    setMode("commands");
  }

  function close() {
    dismiss({ revertTheme: true });
  }

  function backToCommands() {
    if (modeRef.current === "themes") {
      applyTheme(useThemeStore.getState().theme);
    }
    setMode("commands");
    setQuery("");
    setIndex(0);
  }

  useEffect(() => registerPaletteCloser(close), []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        if (open) {
          if (modeRef.current === "themes") {
            backToCommands();
          }
          inputRef.current?.select();
          return;
        }
        dismissPalettes();
        setQuery("");
        setIndex(0);
        setMode("commands");
        setOpen(true);
        return;
      }

      if (open && event.key === "Escape") {
        event.preventDefault();
        if (modeRef.current === "themes") {
          backToCommands();
          return;
        }
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

  function run(command: Command) {
    if (!command.enabled) return;
    if (!command.keepOpen) close();
    command.run();
  }

  function selectTheme(theme: Theme) {
    useThemeStore.getState().setTheme(theme.id);
    applyTheme(theme.id);
    dismiss({ revertTheme: false });
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
    if (event.key === "Enter") {
      event.preventDefault();
      if (mode === "themes") {
        if (activeTheme) selectTheme(activeTheme);
        return;
      }
      if (activeCommand) run(activeCommand);
    }
  }

  return (
    <>
      {open && (
        <div
          ref={rootRef}
          data-command-palette=""
          className="fixed top-3 left-1/2 z-50 flex w-[min(36rem,calc(100%-1.5rem))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10"
        >
          <div className="flex items-center gap-2 border-b px-3">
            <span className="font-mono text-sm text-muted-foreground">{">"}</span>
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKeyDown}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              placeholder={mode === "themes" ? "Select color theme" : "Type a command"}
              aria-label={mode === "themes" ? "Color theme" : "Command palette"}
              className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div
            ref={listRef}
            role="listbox"
            aria-label={mode === "themes" ? "Color themes" : "Commands"}
            className="max-h-[min(24rem,50vh)] overflow-auto py-1"
          >
            {rows.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                {mode === "themes" ? "No matching themes" : "No matching commands"}
              </p>
            ) : mode === "themes" ? (
              themeRows.map((theme, rowIndex) => {
                const selected = rowIndex === index;
                const current = theme.id === savedTheme;
                return (
                  <button
                    key={theme.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-active={selected || undefined}
                    onMouseEnter={() => setIndex(rowIndex)}
                    onClick={() => selectTheme(theme)}
                    className={cn(
                      "flex h-8 w-full cursor-pointer items-center gap-2 px-3 text-left text-[13px] outline-none",
                      selected && "bg-primary/10",
                    )}
                  >
                    <span
                      aria-hidden
                      className="size-3.5 shrink-0 rounded-sm border"
                      style={{ background: theme.swatch }}
                    />
                    <span className="min-w-0 truncate">
                      <HighlightedText text={theme.name} query={query.trim()} />
                    </span>
                    {current && (
                      <CheckIcon className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                );
              })
            ) : (
              commandRows.map((command, rowIndex) => {
                const selected = rowIndex === index;
                return (
                  <button
                    key={command.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-disabled={!command.enabled}
                    data-active={selected || undefined}
                    onMouseEnter={() => setIndex(rowIndex)}
                    onClick={() => run(command)}
                    className={cn(
                      "flex h-8 w-full cursor-pointer items-center px-3 text-left text-[13px] outline-none",
                      selected && "bg-primary/10",
                      !command.enabled && "cursor-default opacity-40",
                    )}
                  >
                    <span className="min-w-0 truncate">
                      <HighlightedText text={command.title} query={query.trim()} />
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
      <ConnectionDialog
        open={connectionDialogOpen}
        onOpenChange={setConnectionDialogOpen}
        onSubmit={(values) => {
          const { shareWith, ...input } = values;
          const created = addConnection(input);
          syncLayoutSharing(created.id, shareWith);
          router.push(`/${created.id}`);
        }}
      />
    </>
  );
}
