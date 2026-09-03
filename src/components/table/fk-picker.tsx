"use client";

import { useMemo, useState } from "react";
import { CheckIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAsync } from "@/hooks/use-async";
import { useDebounced } from "@/hooks/use-debounced";
import { api } from "@/lib/api";
import {
  displayColumnName,
  relatedLabel,
} from "@/lib/foreign-keys";
import { cn } from "@/lib/utils";
import type { Cell, ForeignKey, TableInfo } from "@/lib/types";

type Props = {
  connectionUrl: string;
  foreignKey: ForeignKey;
  referencedTable: TableInfo;
  value: Cell;
  onSelect: (value: Cell) => void;
};

export function FkPicker({
  connectionUrl,
  foreignKey,
  referencedTable,
  value,
  onSelect,
}: Props) {
  const [query, setQuery] = useState("");
  const search = useDebounced(query, 200);
  const keyColumn = foreignKey.referencedColumns[0];
  const displayColumn = displayColumnName(referencedTable.columns, foreignKey.referencedColumns);

  const rows = useAsync(
    `${connectionUrl}:${referencedTable.schema}.${referencedTable.name}:${search}`,
    (signal) =>
      api.lookup(
        connectionUrl,
        { table: foreignKey.referencedTable, search, limit: 30 },
        signal,
      ),
  );

  const items = useMemo(() => {
    const data = rows.data;
    if (!data || !keyColumn) return [];
    const keyIndex = data.columns.indexOf(keyColumn);
    if (keyIndex < 0) return [];
    return data.rows.map((row) => {
      const key = row[keyIndex] ?? null;
      const label = relatedLabel(data.columns, row, displayColumn);
      return { key, label, row };
    });
  }, [displayColumn, keyColumn, rows.data]);

  return (
    <div className="mt-1.5">
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={`Search ${foreignKey.referencedTable.schema}.${foreignKey.referencedTable.name}`}
        className="font-mono"
        aria-label="Search referenced rows"
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
      />
      <div className="mt-1.5 max-h-48 overflow-auto rounded-md border bg-background/50">
        {rows.error ? (
          <p className="px-2.5 py-2 text-xs text-destructive">{rows.error}</p>
        ) : !rows.data ? (
          <div className="flex flex-col gap-1 p-2">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-6 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="px-2.5 py-3 text-center text-xs text-muted-foreground">No matching rows</p>
        ) : (
          <ul>
            {items.map((item, index) => {
              const selected = String(item.key) === String(value);
              const label = item.label && item.label !== String(item.key) ? item.label : null;
              return (
                <li key={`${String(item.key)}:${index}`}>
                  <button
                    type="button"
                    onClick={() => onSelect(item.key)}
                    className={cn(
                      "flex h-7 w-full cursor-pointer items-center gap-2 px-2.5 text-left font-mono text-xs outline-none hover:bg-muted/60 focus-visible:bg-muted/60",
                      selected && "bg-primary/8",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {label ?? String(item.key ?? "")}
                    </span>
                    {label && (
                      <span className="max-w-[40%] truncate text-muted-foreground">
                        {String(item.key ?? "")}
                      </span>
                    )}
                    {selected && <CheckIcon className="size-3 shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
