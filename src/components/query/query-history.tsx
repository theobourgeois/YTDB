"use client";

import { useMemo } from "react";
import { Trash2Icon } from "lucide-react";
import { rankFuzzyMulti } from "@/lib/fuzzy";
import { useQueries, type QueryHistoryItem } from "@/lib/store/queries";

function historyTitle(sql: string): string {
  const firstLine = sql.split(/\r?\n/).find((line) => line.trim())?.trim() ?? sql;
  return firstLine.replace(/\s+/g, " ");
}

function executedLabel(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

export function QueryHistory({
  connectionId,
  search,
  onSelect,
}: {
  connectionId: string;
  search: string;
  onSelect: (sql: string) => void;
}) {
  const history = useQueries((state) => state.history);
  const remove = useQueries((state) => state.remove);
  const connectionHistory = useMemo(
    () => history.filter((item) => item.connectionId === connectionId),
    [connectionId, history],
  );
  const visible = useMemo(() => {
    if (!search.trim()) return connectionHistory;
    return rankFuzzyMulti(search, connectionHistory, (item) => [historyTitle(item.sql), item.sql]).map(
      (hit) => hit.item,
    );
  }, [connectionHistory, search]);

  if (visible.length === 0) {
    return (
      <p className="px-3 py-8 text-center text-xs text-muted-foreground">
        {connectionHistory.length === 0 ? "Queries you run will appear here." : "No matching queries."}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1 p-1.5">
      {visible.map((item: QueryHistoryItem) => (
        <li key={item.id} className="group flex items-start rounded-md hover:bg-muted/70">
          <button
            type="button"
            onClick={() => onSelect(item.sql)}
            title={item.sql}
            className="min-w-0 flex-1 rounded-md px-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <span className="block truncate font-mono text-xs text-foreground/90">
              {historyTitle(item.sql)}
            </span>
            <span className="mt-1 block text-[10px] text-muted-foreground">
              {executedLabel(item.executedAt)}
            </span>
          </button>
          <button
            type="button"
            onClick={() => remove(item.id)}
            aria-label="Remove query from history"
            title="Remove from history"
            className="mt-1.5 mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none hover:bg-foreground/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:opacity-100 group-hover:opacity-100"
          >
            <Trash2Icon className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}
