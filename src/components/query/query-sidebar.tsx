"use client";

import { useState } from "react";
import { SearchField } from "@/components/ui/search-field";
import { QueryHistory } from "./query-history";

type Props = {
  connectionId: string;
  onSelectHistory: (sql: string) => void;
};

export function QuerySidebar({ connectionId, onSelectHistory }: Props) {
  const [search, setSearch] = useState("");

  return (
    <aside
      className="flex w-72 max-w-[35%] shrink-0 flex-col border-l bg-sidebar"
      aria-label="Query history"
    >
      <div className="flex h-11 shrink-0 items-center border-b px-2">
        <SearchField
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search history"
          aria-label="Search query history"
          className="min-w-0 flex-1"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <QueryHistory connectionId={connectionId} search={search} onSelect={onSelectHistory} />
      </div>
    </aside>
  );
}
