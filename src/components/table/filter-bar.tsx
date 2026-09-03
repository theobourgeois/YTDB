"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { rankFuzzy } from "@/lib/fuzzy";
import { newFilter } from "@/lib/filters";
import { cn } from "@/lib/utils";
import type { ColumnInfo, Filter } from "@/lib/types";
import { HighlightMatch } from "./highlight-match";
import { FilterRow } from "./filter-row";

type Props = {
  filters: Filter[];
  search: string;
  columns: ColumnInfo[];
  onFiltersChange: (filters: Filter[]) => void;
  onSearchChange: (search: string) => void;
};

type MenuItem =
  | { type: "search"; query: string }
  | { type: "column"; column: ColumnInfo };

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function hasOpenOverlay() {
  return Boolean(
    document.querySelector(
      "[data-slot=dialog-content], [data-slot=select-content], [data-slot=combobox-content], [data-table-palette], [data-command-palette], [data-row-peek]",
    ),
  );
}

function placeholder(columns: ColumnInfo[], hasFilters: boolean) {
  if (hasFilters) return "Add more filters...";
  const names = columns.slice(0, 3).map((column) => column.name);
  if (names.length === 0) return "Filter or search…";
  return `Filter by ${names.join(", ")}${columns.length > 3 ? "…" : ""}`;
}

export function FilterBar({
  filters,
  search,
  columns,
  onFiltersChange,
  onSearchChange,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [typedSinceFocus, setTypedSinceFocus] = useState(false);

  const columnMatches = useMemo(() => {
    if (!typedSinceFocus || !search.trim()) return columns;
    return rankFuzzy(search, columns, (column) => column.name).map((hit) => hit.item);
  }, [columns, search, typedSinceFocus]);

  const menuItems = useMemo((): MenuItem[] => {
    const items: MenuItem[] = [];
    if (typedSinceFocus && search.trim()) {
      items.push({ type: "search", query: search.trim() });
    }
    for (const column of columnMatches) {
      items.push({ type: "column", column });
    }
    return items;
  }, [columnMatches, search, typedSinceFocus]);

  const activeIndex = menuItems.length === 0 ? 0 : Math.min(index, menuItems.length - 1);
  const active = menuItems[activeIndex] ?? null;

  function focusInput() {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }

  function pickColumn(name: string) {
    const wasTyping = typedSinceFocus;
    setOpen(false);
    setTypedSinceFocus(false);
    if (wasTyping) onSearchChange("");
    const filter = newFilter(name);
    onFiltersChange([...filters, filter]);
    setActiveId(filter.id);
  }

  function pickItem(item: MenuItem) {
    switch (item.type) {
      case "search":
        setOpen(false);
        setTypedSinceFocus(false);
        return;
      case "column":
        pickColumn(item.column.name);
        return;
      default: {
        const _exhaustive: never = item;
        return _exhaustive;
      }
    }
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) setOpen(true);
      if (menuItems.length === 0) return;
      setIndex((current) => (current + 1) % menuItems.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) setOpen(true);
      if (menuItems.length === 0) return;
      setIndex((current) => (current - 1 + menuItems.length) % menuItems.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (open && active) {
        pickItem(active);
        if (active.type === "column") event.currentTarget.blur();
      } else setOpen(false);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (open) {
        setOpen(false);
        return;
      }
      if (search) {
        onSearchChange("");
        return;
      }
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Backspace" && !search && filters.length > 0) {
      event.preventDefault();
      const last = filters[filters.length - 1];
      if (!last) return;
      if (last.id === activeId) setActiveId(null);
      onFiltersChange(filters.slice(0, -1));
    }
  }

  useEffect(() => {
    if (!open) return;
    document.getElementById(`filter-col-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (rootRef.current?.contains(target)) return;
      if (
        target instanceof HTMLElement &&
        target.closest("[data-slot=select-content], [data-slot=combobox-content]")
      ) {
        return;
      }
      setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (hasOpenOverlay()) return;
      if (columns.length === 0) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        focusInput();
        return;
      }

      const filterKey = event.key === "/" || event.key.toLowerCase() === "f";
      if (!filterKey || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.repeat || isTypingTarget(event.target)) return;
      event.preventDefault();
      focusInput();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [columns.length]);

  const showMenu = open && columns.length > 0;
  const showHint = !search && filters.length === 0 && !open;

  return (
    <div className="border-b px-4 py-2">
      <div
        ref={rootRef}
        className={cn(
          "relative flex min-h-8 flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent bg-clip-padding px-2 py-1 text-sm transition-colors",
          "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
        )}
        onClick={() => {
          inputRef.current?.focus();
          if (columns.length > 0) setOpen(true);
        }}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("[data-filter-chip]")) setOpen(false);
        }}
      >
        {filters.map((filter) => (
          <FilterRow
            key={filter.id}
            filter={filter}
            columns={columns}
            autoStart={filter.id === activeId}
            onChange={(next) =>
              onFiltersChange(filters.map((item) => (item.id === next.id ? next : item)))
            }
            onRemove={() => {
              if (filter.id === activeId) setActiveId(null);
              onFiltersChange(filters.filter((item) => item.id !== filter.id));
            }}
            onSettled={() => {
              if (filter.id === activeId) setActiveId(null);
            }}
          />
        ))}
        <input
          ref={inputRef}
          value={search}
          onChange={(event) => {
            setTypedSinceFocus(true);
            setOpen(true);
            setIndex(event.target.value.trim() ? 1 : 0);
            onSearchChange(event.target.value);
          }}
          onFocus={() => {
            setTypedSinceFocus(false);
            setIndex(0);
            if (columns.length > 0) setOpen(true);
          }}
          onKeyDown={onInputKeyDown}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          placeholder={placeholder(columns, filters.length > 0)}
          aria-label="Filter or search table"
          aria-expanded={showMenu}
          aria-controls="filter-column-list"
          aria-activedescendant={active ? `filter-col-${activeIndex}` : undefined}
          aria-autocomplete="list"
          role="combobox"
          className="h-6 min-w-40 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {search ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Clear search"
            className="ml-auto"
            onClick={(event) => {
              event.stopPropagation();
              onSearchChange("");
              inputRef.current?.focus();
            }}
          >
            <XIcon />
          </Button>
        ) : showHint ? (
          <kbd className="pointer-events-none ml-auto font-mono text-[10px] text-muted-foreground/55">
            /
          </kbd>
        ) : null}

        {showMenu ? (
          <div
            id="filter-column-list"
            data-filter-menu=""
            role="listbox"
            aria-label="Filter columns"
            className="absolute top-[calc(100%+6px)] left-0 z-50 max-h-72 min-w-64 overflow-auto rounded-lg bg-popover py-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
          >
            {menuItems.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">No matching columns</p>
            ) : (
              menuItems.map((item, itemIndex) => {
                const selected = itemIndex === activeIndex;
                switch (item.type) {
                  case "search":
                    return (
                      <div key="search">
                        <button
                          id={`filter-col-${itemIndex}`}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onMouseEnter={() => setIndex(itemIndex)}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={(event) => {
                            event.stopPropagation();
                            pickItem(item);
                          }}
                          className={cn(
                            "flex h-8 w-full cursor-pointer items-center gap-2 px-2.5 text-left text-sm outline-none",
                            selected && "bg-accent text-accent-foreground",
                          )}
                        >
                          <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">Search all columns</span>
                          <span className="max-w-32 truncate font-mono text-xs text-muted-foreground">
                            {item.query}
                          </span>
                        </button>
                        {columnMatches.length > 0 ? <div className="my-1 h-px bg-border" /> : null}
                      </div>
                    );
                  case "column":
                    return (
                      <button
                        key={item.column.name}
                        id={`filter-col-${itemIndex}`}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onMouseEnter={() => setIndex(itemIndex)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={(event) => {
                          event.stopPropagation();
                          pickItem(item);
                          inputRef.current?.blur();
                        }}
                        className={cn(
                          "flex h-8 w-full cursor-pointer items-center px-2.5 text-left font-mono text-[13px] outline-none",
                          selected && "bg-accent text-accent-foreground",
                        )}
                      >
                        <HighlightMatch
                          text={item.column.name}
                          query={typedSinceFocus ? search : ""}
                        />
                      </button>
                    );
                  default: {
                    const _exhaustive: never = item;
                    return _exhaustive;
                  }
                }
              })
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
