"use client";

import { useMemo, useState } from "react";
import { Columns3Icon, EyeIcon, EyeOffIcon, PinIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ColumnInfo } from "@/lib/types";

type Props = {
  columns: ColumnInfo[];
  pinnedColumns: string[];
  hiddenColumns: string[];
  onTogglePin: (column: string) => void;
  onToggleHidden: (column: string) => void;
  onReset: () => void;
};

export function ColumnLayoutMenu({
  columns,
  pinnedColumns,
  hiddenColumns,
  onTogglePin,
  onToggleHidden,
  onReset,
}: Props) {
  const [query, setQuery] = useState("");
  const pinned = new Set(pinnedColumns);
  const hidden = new Set(hiddenColumns);
  const hiddenCount = hiddenColumns.filter((column) =>
    columns.some((item) => item.name === column),
  ).length;
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return columns;
    return columns.filter((column) => column.name.toLocaleLowerCase().includes(needle));
  }, [columns, query]);

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) setQuery("");
      }}
    >
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" />}
        className="cursor-pointer"
      >
        <Columns3Icon data-icon="inline-start" />
        Columns
        {hiddenCount > 0 && (
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
            {columns.length - hiddenCount}/{columns.length}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-72 min-w-72 p-0">
        <div className="p-2 pb-1.5">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder="Filter columns"
            aria-label="Filter columns"
            className="h-8"
          />
        </div>
        <div className="max-h-72 overflow-auto px-1 pb-1">
          {matches.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">No columns</p>
          ) : (
            matches.map((column) => {
              const isPinned = pinned.has(column.name);
              const isHidden = hidden.has(column.name);
              const lastVisible = !isHidden && columns.length - hidden.size <= 1;
              return (
                <div
                  key={column.name}
                  className="flex items-center gap-0.5 rounded-lg px-0.5 py-0.5 hover:bg-accent"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={isPinned ? `Unpin ${column.name}` : `Pin ${column.name}`}
                    aria-pressed={isPinned}
                    title={isPinned ? "Unpin column" : "Pin column to the left"}
                    disabled={isHidden}
                    onClick={() => onTogglePin(column.name)}
                    className={cn(
                      "text-muted-foreground",
                      isPinned && "text-foreground",
                    )}
                  >
                    <PinIcon className={cn(isPinned && "fill-current")} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={isHidden ? `Show ${column.name}` : `Hide ${column.name}`}
                    aria-pressed={!isHidden}
                    title={isHidden ? "Show column" : "Hide column"}
                    disabled={lastVisible}
                    onClick={() => onToggleHidden(column.name)}
                    className="text-muted-foreground"
                  >
                    {isHidden ? <EyeOffIcon /> : <EyeIcon />}
                  </Button>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate px-1 font-mono text-xs",
                      column.isPrimaryKey && "font-semibold",
                      isHidden && "text-muted-foreground line-through",
                    )}
                    title={column.name}
                  >
                    {column.name}
                  </span>
                  <span className="max-w-20 shrink-0 truncate pr-1 text-[10px] text-muted-foreground">
                    {column.type}
                  </span>
                </div>
              );
            })
          )}
        </div>
        <DropdownMenuSeparator className="mx-0" />
        <div className="p-1">
          <DropdownMenuItem onClick={onReset}>
            <RotateCcwIcon />
            Reset columns
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
