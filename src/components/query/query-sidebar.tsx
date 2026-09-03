"use client";

import { useState } from "react";
import { FolderPlusIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQueries, type SavedQuery } from "@/lib/store/queries";
import { cn } from "@/lib/utils";
import { QueryHistory } from "./query-history";
import { SavedQueries } from "./saved-queries";

export type QuerySidebarTab = "saved" | "history";

type Props = {
  connectionId: string;
  tab: QuerySidebarTab;
  onTabChange: (tab: QuerySidebarTab) => void;
  activeSavedId: string | null;
  dirty: boolean;
  onSelectSaved: (query: SavedQuery) => void;
  onSelectHistory: (sql: string) => void;
};

const TABS: { id: QuerySidebarTab; label: string }[] = [
  { id: "saved", label: "Saved" },
  { id: "history", label: "History" },
];

export function QuerySidebar({
  connectionId,
  tab,
  onTabChange,
  activeSavedId,
  dirty,
  onSelectSaved,
  onSelectHistory,
}: Props) {
  const [search, setSearch] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const savedCount = useQueries(
    (state) => state.saved.filter((query) => query.connectionId === connectionId).length,
  );
  const historyCount = useQueries(
    (state) => state.history.filter((item) => item.connectionId === connectionId).length,
  );

  return (
    <aside
      className="flex w-72 max-w-[35%] shrink-0 flex-col border-l bg-sidebar"
      aria-label="Saved queries and history"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-2">
        <div
          role="tablist"
          aria-label="Query panel"
          className="flex h-7 items-center gap-0.5 rounded-lg bg-muted/70 p-0.5"
        >
          {TABS.map((item) => {
            const selected = item.id === tab;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => onTabChange(item.id)}
                className={cn(
                  "h-6 cursor-pointer rounded-md px-2.5 text-xs font-medium outline-none transition-[color,background-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring/60",
                  selected
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {tab === "saved" ? savedCount : historyCount}
        </span>
        {tab === "saved" && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New folder"
            title="New folder"
            onClick={() => setCreatingFolder(true)}
          >
            <FolderPlusIcon className="size-4" />
          </Button>
        )}
      </div>
      <div className="border-b p-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tab === "saved" ? "Search saved queries" : "Search history"}
            aria-label={tab === "saved" ? "Search saved queries" : "Search query history"}
            className="h-8 bg-background/60 pl-8 text-xs"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "saved" ? (
          <SavedQueries
            connectionId={connectionId}
            search={search}
            activeId={activeSavedId}
            dirty={dirty}
            creatingFolder={creatingFolder}
            onCreatingFolderChange={setCreatingFolder}
            onSelect={onSelectSaved}
          />
        ) : (
          <QueryHistory connectionId={connectionId} search={search} onSelect={onSelectHistory} />
        )}
      </div>
    </aside>
  );
}
