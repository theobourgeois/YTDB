"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { PlusIcon, TableIcon, XIcon } from "@/components/icons";
import { useExplorer } from "@/lib/store/explorer";
import { routeHref } from "@/lib/routes";
import { openTableSearch, SHORTCUTS } from "@/lib/shortcuts";
import { tableKey } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useExplorerContext } from "./explorer-provider";
import { useTableTabs } from "./use-table-tabs";

/** A row of the tables opened on this connection, when tab view is on. */
export function TableTabs() {
  const { connection } = useExplorerContext();
  const { tabs, activeKey, close } = useTableTabs();
  const listRef = useRef<HTMLDivElement>(null);
  const setBrowse = useExplorer((state) => state.setBrowse);

  // Opening a table opens its tab. Read the list fresh so closing the tab in
  // view doesn't reopen it before the next one loads.
  useEffect(() => {
    if (!activeKey) return;
    const open = useExplorer.getState().browse[connection.id]?.openTabs ?? [];
    if (open.includes(activeKey)) return;
    setBrowse(connection.id, { openTabs: [...open, activeKey] });
  }, [activeKey, connection.id, setBrowse]);

  useEffect(() => {
    const tab = listRef.current?.querySelector("[aria-selected=true]");
    tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeKey, tabs.length]);

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Open tables"
      className="flex h-9 shrink-0 overflow-x-auto overflow-y-hidden bg-sidebar [scrollbar-width:none]"
    >
      {tabs.map((table) => {
        const key = tableKey(table);
        const active = key === activeKey;
        return (
          <div
            key={key}
            className={cn(
              "group/tab relative flex max-w-60 shrink-0 items-center border-r",
              active
                ? "bg-background text-foreground"
                : "border-b text-muted-foreground hover:text-foreground",
            )}
          >
            {active && <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-primary" />}
            <Link
              role="tab"
              aria-selected={active}
              href={routeHref({ kind: "table", connectionId: connection.id, table })}
              title={key}
              onMouseDown={(event) => {
                if (event.button === 1) event.preventDefault();
              }}
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                close(key);
              }}
              className="flex h-full min-w-0 items-center gap-1.5 pr-1 pl-3 text-xs outline-none"
            >
              <TableIcon className="size-3.5 shrink-0 opacity-70" />
              <span className="truncate">
                <span className="text-muted-foreground">{table.schema}.</span>
                {table.name}
              </span>
            </Link>
            <button
              type="button"
              aria-label={`Close ${key}`}
              title="Close"
              onClick={() => close(key)}
              className={cn(
                "mr-1.5 grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:opacity-100",
                active ? "opacity-100" : "opacity-0 group-hover/tab:opacity-100",
              )}
            >
              <XIcon className="size-3" />
            </button>
          </div>
        );
      })}
      <div className="flex min-w-0 flex-1 items-center border-b pl-1">
        <button
          type="button"
          aria-label="Open a table"
          title={`Open a table (${SHORTCUTS.tableSearch})`}
          onClick={() => openTableSearch()}
          className="grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <PlusIcon className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
