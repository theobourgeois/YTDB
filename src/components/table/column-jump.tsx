"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { rankFuzzy } from "@/lib/fuzzy";
import { cn } from "@/lib/utils";
import type { ColumnInfo } from "@/lib/types";

type Props = {
  columns: ColumnInfo[];
  resetKey: string;
  onActiveColumn: (column: string | null) => void;
};

export function ColumnJump({ columns, resetKey, onActiveColumn }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const clearTimer = useRef<number | null>(null);
  const activeNameRef = useRef<string | null>(null);
  const onActiveColumnRef = useRef(onActiveColumn);

  const matches = useMemo(() => rankFuzzy(query, columns, (column) => column.name), [query, columns]);
  const active = matches.length === 0 ? null : (matches[index % matches.length] ?? null);

  useEffect(() => {
    onActiveColumnRef.current = onActiveColumn;
  }, [onActiveColumn]);

  useEffect(() => {
    activeNameRef.current = active?.item.name ?? null;
  }, [active?.item.name]);

  function clearScheduled() {
    if (clearTimer.current !== null) {
      window.clearTimeout(clearTimer.current);
      clearTimer.current = null;
    }
  }

  function setColumn(name: string | null, persistMs = 0) {
    clearScheduled();
    onActiveColumnRef.current(name);
    if (name && persistMs > 0) {
      clearTimer.current = window.setTimeout(() => {
        onActiveColumnRef.current(null);
        clearTimer.current = null;
      }, persistMs);
    }
  }

  function close(keep: boolean) {
    const name = activeNameRef.current;
    setOpen(false);
    setQuery("");
    setIndex(0);
    if (keep && name) setColumn(name, 1400);
    else setColumn(null);
  }

  useEffect(() => {
    // Moving to another table intentionally resets this table-specific overlay.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(false);
    setQuery("");
    setIndex(0);
    clearScheduled();
    onActiveColumnRef.current(null);
  }, [resetKey]);

  useEffect(() => {
    if (!open) return;
    setColumn(active?.item.name ?? null);
  }, [open, active?.item.name]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        if (
          document.querySelector(
            "[data-slot=dialog-content], [data-table-palette], [data-command-palette]",
          )
        ) {
          return;
        }
        event.preventDefault();
        if (columns.length === 0) return;
        clearScheduled();
        if (open) {
          inputRef.current?.select();
          return;
        }
        setQuery("");
        setIndex(0);
        setOpen(true);
        return;
      }

      if (open && event.key === "Escape") {
        event.preventDefault();
        close(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, columns.length]);

  useEffect(() => () => clearScheduled(), []);

  function cycle(step: number) {
    if (matches.length === 0) return;
    setIndex((current) => (current + step + matches.length) % matches.length);
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) {
      event.preventDefault();
      cycle(1);
      return;
    }
    if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) {
      event.preventDefault();
      cycle(-1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      close(true);
    }
  }

  if (!open) return null;

  const matchLabel = !query.trim() ? "type a column" : active ? active.item.name : "no match";

  return (
    <div
      ref={rootRef}
      className="pointer-events-auto absolute bottom-2 left-2 z-30 flex max-w-[min(28rem,calc(100%-1rem))] items-center gap-2 rounded-md border bg-background/95 px-2 py-1 font-mono text-xs shadow-sm backdrop-blur-sm"
    >
      <span className="text-muted-foreground">:</span>
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setIndex(0);
        }}
        onKeyDown={onInputKeyDown}
        onBlur={(event) => {
          if (rootRef.current?.contains(event.relatedTarget as Node | null)) return;
          close(true);
        }}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        aria-label="Jump to column"
        className="w-36 min-w-0 bg-transparent text-foreground outline-none placeholder:text-muted-foreground/50"
        placeholder="column"
      />
      <span
        className={cn("min-w-0 truncate", active ? "text-foreground" : "text-muted-foreground")}
        title={active?.item.name}
      >
        {matchLabel}
      </span>
      {matches.length > 1 && (
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {index + 1}/{matches.length}
        </span>
      )}
    </div>
  );
}
