"use client";

import { useState, type DragEvent as ReactDragEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronRightIcon, GripVerticalIcon, PinIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { tableKey, type TableInfo } from "@/lib/types";

type Props = {
  connectionId: string;
  tables: TableInfo[];
  search: string;
  collapsedSchemas: string[];
  pinnedTables: string[];
  onToggleSchema: (schema: string) => void;
  onTogglePin: (table: TableInfo) => void;
  onReorderPinned: (draggedKey: string, targetKey: string, edge: DropEdge) => void;
};

type DropEdge = "before" | "after";

function compareSchemas(left: string, right: string): number {
  const priority = new Map([
    ["public", 0],
    ["auth", 1],
  ]);
  const leftPriority = priority.get(left) ?? 2;
  const rightPriority = priority.get(right) ?? 2;
  return leftPriority - rightPriority || left.localeCompare(right);
}

function groupBySchema(tables: TableInfo[]): [string, TableInfo[]][] {
  const groups = new Map<string, TableInfo[]>();
  for (const table of tables) {
    groups.set(table.schema, [...(groups.get(table.schema) ?? []), table]);
  }
  return [...groups.entries()].sort(([left], [right]) => compareSchemas(left, right));
}

function queryPart(search: string, part: "schema" | "table"): string {
  const query = search.trim();
  const separator = query.lastIndexOf(".");
  if (separator === -1) return query;
  return part === "schema" ? query.slice(0, separator) : query.slice(separator + 1);
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return text;

  const parts: React.ReactNode[] = [];
  const lowerText = text.toLocaleLowerCase();
  const lowerQuery = query.toLocaleLowerCase();
  let cursor = 0;
  let match = lowerText.indexOf(lowerQuery);

  if (match === -1) return text;

  while (match !== -1) {
    if (match > cursor) parts.push(text.slice(cursor, match));
    parts.push(
      <mark
        key={match}
        className="rounded-[3px] bg-yellow-300/90 px-px text-yellow-950 dark:bg-yellow-400/85 dark:text-yellow-950"
      >
        {text.slice(match, match + query.length)}
      </mark>,
    );
    cursor = match + query.length;
    match = lowerText.indexOf(lowerQuery, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));

  return parts;
}

function TableRow({
  connectionId,
  table,
  search,
  pinned,
  showSchema,
  active,
  reorderable,
  dragging,
  dropEdge,
  onTogglePin,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onMove,
}: {
  connectionId: string;
  table: TableInfo;
  search: string;
  pinned: boolean;
  showSchema?: boolean;
  active: boolean;
  reorderable?: boolean;
  dragging?: boolean;
  dropEdge?: DropEdge | null;
  onTogglePin: (table: TableInfo) => void;
  onDragStart?: (event: ReactDragEvent<HTMLButtonElement>) => void;
  onDragOver?: (event: ReactDragEvent<HTMLLIElement>) => void;
  onDrop?: (event: ReactDragEvent<HTMLLIElement>) => void;
  onDragEnd?: () => void;
  onMove?: (direction: -1 | 1) => void;
}) {
  return (
    <li
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        "group/table-row relative flex h-7 items-center rounded-md text-[13px] transition-[color,background-color,opacity] hover:bg-muted/60",
        active && "bg-muted text-foreground",
        !active && "text-foreground/80",
        dragging && "opacity-45",
        dropEdge === "before" &&
          "before:absolute before:inset-x-1 before:top-0 before:z-10 before:h-0.5 before:-translate-y-1/2 before:rounded-full before:bg-primary",
        dropEdge === "after" &&
          "after:absolute after:inset-x-1 after:bottom-0 after:z-10 after:h-0.5 after:translate-y-1/2 after:rounded-full after:bg-primary",
      )}
    >
      {reorderable && (
        <button
          type="button"
          draggable
          aria-label={`Reorder ${table.schema}.${table.name}`}
          title="Drag to reorder; use Up and Down arrow keys"
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            onMove?.(event.key === "ArrowUp" ? -1 : 1);
          }}
          className="ml-1.5 flex size-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground opacity-50 outline-none transition-[color,background-color,opacity] hover:bg-foreground/10 hover:text-foreground hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:opacity-100 active:cursor-grabbing"
        >
          <GripVerticalIcon className="size-3.5" />
        </button>
      )}
      <Link
        href={`/${connectionId}/${encodeURIComponent(table.schema)}/${encodeURIComponent(table.name)}`}
        className={cn(
          "flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          reorderable ? "pl-1" : "pl-6",
        )}
      >
        <span className="truncate">
          <HighlightedText text={table.name} query={queryPart(search, "table")} />
        </span>
        {showSchema ? (
          <span className="ml-auto max-w-20 truncate text-[10px] text-muted-foreground">
            {table.schema}
          </span>
        ) : (
          table.kind === "view" && (
            <span className="ml-auto text-[10px] text-muted-foreground">view</span>
          )
        )}
      </Link>
      <button
        type="button"
        aria-label={`${pinned ? "Unpin" : "Pin"} ${table.schema}.${table.name}`}
        aria-pressed={pinned}
        title={pinned ? "Unpin table" : "Pin table"}
        onClick={() => onTogglePin(table)}
        className={cn(
          "mr-0.5 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none transition-[color,background-color,opacity] hover:bg-foreground/10 hover:text-foreground hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:opacity-100 group-hover/table-row:opacity-100",
          pinned && "text-foreground",
        )}
      >
        <PinIcon className={cn("size-3.5", pinned && "fill-current")} />
      </button>
    </li>
  );
}

function GroupHeader({
  label,
  count,
  collapsed,
  pinned,
  search,
  onToggle,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  pinned?: boolean;
  search: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      onClick={onToggle}
      className="flex h-7 w-full cursor-pointer items-center gap-1 rounded-md px-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <ChevronRightIcon
        className={cn("size-3.5 transition-transform", !collapsed && "rotate-90")}
      />
      {pinned && <PinIcon className="mr-0.5 size-3 fill-current" />}
      <span className="truncate">
        {pinned ? label : <HighlightedText text={label} query={queryPart(search, "schema")} />}
      </span>
      <span className="ml-auto pr-1 tabular-nums opacity-60">{count}</span>
    </button>
  );
}

export function TableList({
  connectionId,
  tables,
  search,
  collapsedSchemas,
  pinnedTables,
  onToggleSchema,
  onTogglePin,
  onReorderPinned,
}: Props) {
  const params = useParams<{ schema?: string; table?: string }>();
  const [pinnedCollapsed, setPinnedCollapsed] = useState(false);
  const [draggedPinned, setDraggedPinned] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    key: string;
    edge: DropEdge;
  } | null>(null);
  const tableByKey = new Map(tables.map((table) => [tableKey(table), table]));
  const visiblePinned = pinnedTables.flatMap((key) => {
    const table = tableByKey.get(key);
    return table ? [table] : [];
  });

  function beginPinnedDrag(event: ReactDragEvent<HTMLButtonElement>, key: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", key);
    setDraggedPinned(key);
    setDropTarget(null);
  }

  function dragOverPinned(event: ReactDragEvent<HTMLLIElement>, key: string) {
    if (!draggedPinned || draggedPinned === key) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    setDropTarget((current) =>
      current?.key === key && current.edge === edge ? current : { key, edge },
    );
  }

  function dropPinned(event: ReactDragEvent<HTMLLIElement>, targetKey: string) {
    event.preventDefault();
    const draggedKey = draggedPinned ?? event.dataTransfer.getData("text/plain");
    const edge = dropTarget?.key === targetKey ? dropTarget.edge : "before";
    if (draggedKey) onReorderPinned(draggedKey, targetKey, edge);
    finishPinnedDrag();
  }

  function finishPinnedDrag() {
    setDraggedPinned(null);
    setDropTarget(null);
  }

  function movePinned(key: string, direction: -1 | 1) {
    const index = visiblePinned.findIndex((table) => tableKey(table) === key);
    const target = visiblePinned[index + direction];
    if (!target) return;
    onReorderPinned(key, tableKey(target), direction === -1 ? "before" : "after");
  }

  if (tables.length === 0) {
    return (
      <p className="px-3 py-8 text-center text-xs text-muted-foreground">
        {search.trim() ? "No tables match your search" : "No tables in these schemas"}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1 px-2 pb-4">
      {visiblePinned.length > 0 && (
        <div className="mb-1 border-b border-border/60 pb-1">
          <GroupHeader
            label="Pinned tables"
            count={visiblePinned.length}
            collapsed={pinnedCollapsed}
            pinned
            search={search}
            onToggle={() => setPinnedCollapsed((collapsed) => !collapsed)}
          />
          {!pinnedCollapsed && (
            <ul>
              {visiblePinned.map((table) => {
                const key = tableKey(table);
                return (
                  <TableRow
                    key={key}
                    connectionId={connectionId}
                    table={table}
                    search={search}
                    pinned
                    showSchema
                    active={params.schema === table.schema && params.table === table.name}
                    reorderable
                    dragging={draggedPinned === key}
                    dropEdge={dropTarget?.key === key ? dropTarget.edge : null}
                    onTogglePin={onTogglePin}
                    onDragStart={(event) => beginPinnedDrag(event, key)}
                    onDragOver={(event) => dragOverPinned(event, key)}
                    onDrop={(event) => dropPinned(event, key)}
                    onDragEnd={finishPinnedDrag}
                    onMove={(direction) => movePinned(key, direction)}
                  />
                );
              })}
            </ul>
          )}
        </div>
      )}

      {groupBySchema(tables).map(([schema, schemaTables]) => {
        const collapsed = collapsedSchemas.includes(schema);
        return (
          <div key={schema}>
            <GroupHeader
              label={schema}
              count={schemaTables.length}
              collapsed={collapsed}
              search={search}
              onToggle={() => onToggleSchema(schema)}
            />
            {!collapsed && (
              <ul>
                {schemaTables.map((table) => (
                  <TableRow
                    key={tableKey(table)}
                    connectionId={connectionId}
                    table={table}
                    search={search}
                    pinned={pinnedTables.includes(tableKey(table))}
                    active={params.schema === table.schema && params.table === table.name}
                    onTogglePin={onTogglePin}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
