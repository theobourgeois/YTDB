"use client";

import { useMemo } from "react";
import { Popover } from "@base-ui/react/popover";
import {
  ArrowUpRightIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  KeyRoundIcon,
  Link2Icon,
  LoaderCircleIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAsync } from "@/hooks/use-async";
import { api } from "@/lib/api";
import {
  displayColumnName,
  filtersForKey,
  findTable,
  foreignKeyForColumn,
  keyValuesForForeignKey,
  relatedCacheKey,
  relatedLabel,
  type RelatedRows,
} from "@/lib/foreign-keys";
import { tableKey, type Cell, type Filter, type TableInfo, type TableRef } from "@/lib/types";
import { cn } from "@/lib/utils";

export type PeekFrame = {
  table: TableRef;
  keyColumns: string[];
  key: Cell[];
};

export type PeekState = {
  anchor: HTMLElement;
  stack: PeekFrame[];
};

type Props = {
  peek: PeekState;
  connectionUrl: string;
  tables: TableInfo[];
  relatedRows: RelatedRows;
  onClose: () => void;
  onPeek: (peek: PeekState) => void;
  onOpenTable: (table: TableRef, filters: Filter[]) => void;
};

function cellText(value: Cell): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export function RowPeek({
  peek,
  connectionUrl,
  tables,
  relatedRows,
  onClose,
  onPeek,
  onOpenTable,
}: Props) {
  const frame = peek.stack[peek.stack.length - 1];
  if (!frame) return null;

  return (
    <Popover.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Popover.Portal>
        <Popover.Positioner
          anchor={peek.anchor}
          side="bottom"
          sideOffset={6}
          align="start"
          collisionPadding={8}
          className="isolate z-60"
        >
          <Popover.Popup
            data-row-peek
            className="flex max-h-[min(32rem,calc(100vh-2rem))] w-[min(32rem,calc(100vw-1rem))] origin-(--transform-origin) flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-xl ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95"
          >
            <PeekBody
              key={relatedCacheKey(frame.table, frame.key)}
              frame={frame}
              canGoBack={peek.stack.length > 1}
              connectionUrl={connectionUrl}
              tables={tables}
              relatedRows={relatedRows}
              onBack={() => onPeek({ ...peek, stack: peek.stack.slice(0, -1) })}
              onFollow={(next) => onPeek({ ...peek, stack: [...peek.stack, next] })}
              onOpenTable={onOpenTable}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function PeekBody({
  frame,
  canGoBack,
  connectionUrl,
  tables,
  relatedRows,
  onBack,
  onFollow,
  onOpenTable,
}: {
  frame: PeekFrame;
  canGoBack: boolean;
  connectionUrl: string;
  tables: TableInfo[];
  relatedRows: RelatedRows;
  onBack: () => void;
  onFollow: (frame: PeekFrame) => void;
  onOpenTable: (table: TableRef, filters: Filter[]) => void;
}) {
  const table = findTable(tables, frame.table);
  const cached = relatedRows.get(relatedCacheKey(frame.table, frame.key));
  const query = useMemo(
    () => ({
      table: frame.table,
      filters: filtersForKey(frame.keyColumns, frame.key),
      sort: null,
      page: 0,
      pageSize: 1,
    }),
    [frame],
  );
  const rows = useAsync(
    `${connectionUrl}:${JSON.stringify(query)}`,
    (signal) => api.rows(connectionUrl, query, signal),
  );

  const columns = rows.data?.columns ?? cached?.columns ?? table?.columns.map((column) => column.name);
  const row = rows.data?.rows[0] ?? cached?.row;
  const missing = Boolean(rows.data && rows.data.rows.length === 0 && !cached);
  const title = relatedRowTitle(table, frame, columns, row);
  const incoming = table?.referencedBy ?? [];

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b bg-muted/20 px-3 py-2.5">
        {canGoBack && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Back"
            onClick={onBack}
          >
            <ChevronLeftIcon />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Link2Icon className="size-3 shrink-0" />
            <span className="truncate font-mono">{tableKey(frame.table)}</span>
          </p>
          <p title={title} className="mt-0.5 truncate font-mono text-sm font-medium">
            {title}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onOpenTable(frame.table, filtersForKey(frame.keyColumns, frame.key))}
        >
          Open
          <ArrowUpRightIcon data-icon="inline-end" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {rows.error && !cached ? (
          <p className="px-3 py-4 font-mono text-xs text-destructive">{rows.error}</p>
        ) : missing ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">Referenced row was not found.</p>
        ) : !columns || !row ? (
          <div className="flex flex-col gap-2 p-3.5">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-5 w-full" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[minmax(7rem,38%)_minmax(0,1fr)] gap-4 border-b bg-muted/25 px-3.5 py-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              <span>Field</span>
              <span>Value</span>
            </div>
            <dl className="divide-y divide-border/60">
              {columns.map((column, index) => {
                const info = table?.columns.find((item) => item.name === column);
                const value = row[index] ?? null;
                const valueText = cellText(value);
                const fk = foreignKeyForColumn(table, column);
                const fkKey = fk ? keyValuesForForeignKey(fk, columns, row) : null;
                const referenced = fk ? findTable(tables, fk.referencedTable) : undefined;
                const cachedRelated =
                  fk && fkKey
                    ? relatedRows.get(relatedCacheKey(fk.referencedTable, fkKey))
                    : undefined;
                const label = cachedRelated
                  ? relatedLabel(
                      cachedRelated.columns,
                      cachedRelated.row,
                      displayColumnName(referenced?.columns ?? [], fk?.referencedColumns ?? []),
                    )
                  : null;
                const showLabel = Boolean(label && label !== valueText);
                const followable = Boolean(fk && fkKey);

                return (
                  <div
                    key={column}
                    className="grid grid-cols-[minmax(7rem,38%)_minmax(0,1fr)] items-start gap-4 px-3.5 py-2 hover:bg-muted/15"
                  >
                    <dt className="flex min-w-0 items-center gap-1.5">
                      {info?.isPrimaryKey && (
                        <KeyRoundIcon
                          aria-label="Primary key"
                          className="size-3 shrink-0 text-muted-foreground"
                        />
                      )}
                      <span
                        title={column}
                        className={cn(
                          "min-w-0 truncate font-mono text-xs",
                          info?.isPrimaryKey && "font-semibold",
                        )}
                      >
                        {column}
                      </span>
                      {info && (
                        <span
                          title={info.type}
                          className="min-w-0 truncate text-[10px] text-muted-foreground/70"
                        >
                          {info.type}
                        </span>
                      )}
                    </dt>
                    <dd className="min-w-0 font-mono text-xs leading-5 tabular-nums">
                      {followable && fk && fkKey ? (
                        <button
                          type="button"
                          title={`${valueText} → ${tableKey(fk.referencedTable)}`}
                          onClick={() =>
                            onFollow({
                              table: fk.referencedTable,
                              keyColumns: fk.referencedColumns,
                              key: fkKey,
                            })
                          }
                          className="group -m-1 flex max-w-full cursor-pointer items-center gap-1.5 rounded-md p-1 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60"
                        >
                          <Link2Icon className="size-3 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 truncate underline decoration-foreground/20 underline-offset-2">
                            {showLabel ? label : valueText}
                          </span>
                          {showLabel && (
                            <span className="min-w-0 truncate text-muted-foreground/60">
                              {valueText}
                            </span>
                          )}
                          <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                        </button>
                      ) : (
                        <p
                          title={valueText}
                          className={cn(
                            "break-words whitespace-pre-wrap",
                            value === null && "italic text-muted-foreground/60",
                          )}
                        >
                          {valueText}
                        </p>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </>
        )}

        {incoming.length > 0 && columns && row && (
          <div className="border-t bg-muted/10 px-3 py-2.5">
            <p className="mb-1.5 px-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              Referenced by
            </p>
            <ul className="flex flex-col gap-1">
              {incoming.map((item) => {
                const values = item.referencedColumns.map((column) => {
                  const index = columns.indexOf(column);
                  return index >= 0 ? (row[index] ?? null) : null;
                });
                const filters = filtersForKey(item.columns, values);
                const disabled = filters.length !== item.columns.length;
                return (
                  <li key={`${tableKey(item.table)}:${item.name}`}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onOpenTable(item.table, filters)}
                      className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50"
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">
                        {tableKey(item.table)}.{item.columns.join(", ")}
                      </span>
                      <ArrowUpRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {rows.loading && cached && (
        <p className="flex shrink-0 items-center gap-1.5 border-t px-3 py-1.5 text-[10px] text-muted-foreground">
          <LoaderCircleIcon className="size-3 animate-spin" />
          Refreshing
        </p>
      )}
    </>
  );
}

function relatedRowTitle(
  table: TableInfo | undefined,
  frame: PeekFrame,
  columns: string[] | undefined,
  row: Cell[] | undefined,
): string {
  if (columns && row) {
    const label = relatedLabel(
      columns,
      row,
      displayColumnName(table?.columns ?? [], frame.keyColumns),
    );
    if (label) return label;
  }
  return frame.key.map(cellText).join(", ");
}
