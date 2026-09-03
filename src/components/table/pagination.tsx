"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MAX_OFFSET } from "@/lib/query-limits";
import { cn } from "@/lib/utils";

const PAGE_SIZES = [25, 50, 100, 200];
const format = new Intl.NumberFormat();

export type TablePane = "data" | "definition";

type Props = {
  pane: TablePane;
  onPaneChange: (pane: TablePane) => void;
  page: number;
  pageSize: number;
  rowCount: number;
  total: number | null;
  estimated: boolean;
  hasMore: boolean;
  capped?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

export function Pagination({
  pane,
  onPaneChange,
  page,
  pageSize,
  rowCount,
  total,
  estimated,
  hasMore,
  capped,
  onPageChange,
  onPageSizeChange,
}: Props) {
  const start = rowCount === 0 ? 0 : page * pageSize + 1;
  const end = rowCount === 0 ? 0 : page * pageSize + rowCount;
  const displayTotal = total == null ? null : Math.max(total, end);

  return (
    <div className="flex items-center gap-2 border-t px-4 py-1.5 text-xs text-muted-foreground">
      <span
        className={cn("min-w-0 truncate", pane === "data" && "tabular-nums")}
        title={pane === "data" ? countTitle(estimated, capped) : undefined}
      >
        {statusLabel({ pane, start, end, displayTotal, estimated, hasMore, capped })}
      </span>
      <div className="ml-auto flex items-center gap-2">
        {pane === "data" ? (
          <div className="flex items-center gap-1">
            <Select
              value={String(pageSize)}
              onValueChange={(value) => value && onPageSizeChange(Number(value))}
            >
              <SelectTrigger size="sm" className="text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={page === 0}
              onClick={() => onPageChange(page - 1)}
              aria-label="Previous page"
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!hasMore}
              onClick={() => onPageChange(page + 1)}
              aria-label="Next page"
            >
              <ChevronRightIcon />
            </Button>
          </div>
        ) : null}
        <PaneToggle pane={pane} onPaneChange={onPaneChange} />
      </div>
    </div>
  );
}

function PaneToggle({
  pane,
  onPaneChange,
}: {
  pane: TablePane;
  onPaneChange: (pane: TablePane) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Table pane"
      className="flex h-7 items-center rounded-md border bg-muted/50 p-0.5"
    >
      <PaneButton active={pane === "data"} onClick={() => onPaneChange("data")}>
        Data
      </PaneButton>
      <PaneButton active={pane === "definition"} onClick={() => onPaneChange("definition")}>
        Definition
      </PaneButton>
    </div>
  );
}

function PaneButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-full rounded-sm px-2 text-xs transition-colors",
        active
          ? "bg-background text-foreground shadow-xs"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function statusLabel({
  pane,
  start,
  end,
  displayTotal,
  estimated,
  hasMore,
  capped,
}: {
  pane: TablePane;
  start: number;
  end: number;
  displayTotal: number | null;
  estimated: boolean;
  hasMore: boolean;
  capped?: boolean;
}): string {
  switch (pane) {
    case "definition":
      return "SQL definition · read only";
    case "data": {
      const range = `${format.format(start)}–${format.format(end)}`;
      const total =
        displayTotal == null
          ? hasMore || capped
            ? "+"
            : ""
          : ` of ${estimated ? "~" : ""}${format.format(displayTotal)}`;
      const cap = capped ? ` · first ${format.format(MAX_OFFSET)} rows` : "";
      return `${range}${total}${cap}`;
    }
    default: {
      const _exhaustive: never = pane;
      return _exhaustive;
    }
  }
}

function countTitle(estimated: boolean, capped?: boolean): string | undefined {
  if (capped) {
    return `Only the first ${format.format(MAX_OFFSET)} rows can be paged. Add a filter to go further.`;
  }
  if (estimated) return "Estimated from Postgres table statistics";
  return undefined;
}
