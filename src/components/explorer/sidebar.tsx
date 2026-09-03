"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { PanelLeftCloseIcon, SearchIcon, SquareTerminalIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useBrowseState } from "@/lib/store/explorer";
import { tableKey, type TableInfo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ConnectionSwitcher } from "./connection-switcher";
import { useExplorerContext } from "./explorer-provider";
import { SchemaMultiSelect } from "./schema-multi-select";
import { TableList } from "./table-list";

const DEFAULT_SIDEBAR_WIDTH = 256;
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 480;
const SIDEBAR_RESIZE_STEP = 16;

type SidebarResize = {
  pointerId: number;
  startX: number;
  startWidth: number;
};

type Props = {
  width: number;
  onWidthChange: (width: number) => void;
  onCollapse: () => void;
};

function clampSidebarWidth(width: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));
}

function compareSchemas(left: string, right: string): number {
  const priority = new Map([
    ["public", 0],
    ["auth", 1],
  ]);
  const leftPriority = priority.get(left) ?? 2;
  const rightPriority = priority.get(right) ?? 2;
  return leftPriority - rightPriority || left.localeCompare(right);
}

function filterTables(
  tables: TableInfo[],
  search: string,
  selectedSchemas: string[] | null,
): TableInfo[] {
  const needle = search.trim().toLocaleLowerCase();
  return tables.filter((table) => {
    if (selectedSchemas !== null && !selectedSchemas.includes(table.schema)) return false;
    if (!needle) return true;
    return (
      table.name.toLocaleLowerCase().includes(needle) ||
      `${table.schema}.${table.name}`.toLocaleLowerCase().includes(needle)
    );
  });
}

export function Sidebar({ width: persistedWidth, onWidthChange, onCollapse }: Props) {
  const pathname = usePathname();
  const { connection, tables } = useExplorerContext();
  const [browse, setBrowse] = useBrowseState(connection.id);
  const [width, setWidth] = useState(() => clampSidebarWidth(persistedWidth));
  const resize = useRef<SidebarResize | null>(null);

  const schemas = useMemo(
    () => [...new Set((tables.data ?? []).map((table) => table.schema))].sort(compareSchemas),
    [tables.data],
  );
  const selectedSchemas = useMemo(
    () =>
      browse.selectedSchemas === null
        ? null
        : browse.selectedSchemas.filter((schema) => schemas.includes(schema)),
    [browse.selectedSchemas, schemas],
  );
  const visible = useMemo(
    () => filterTables(tables.data ?? [], browse.search, selectedSchemas),
    [tables.data, browse.search, selectedSchemas],
  );
  const queryHref = `/${encodeURIComponent(connection.id)}/query`;

  function expandMatchingSchemas(search: string, selected: string[] | null) {
    const matches = filterTables(tables.data ?? [], search, selected);
    const matchedSchemas = new Set(matches.map((table) => table.schema));
    return browse.collapsedSchemas.filter((schema) => !matchedSchemas.has(schema));
  }

  function updateSearch(search: string) {
    setBrowse({
      search,
      collapsedSchemas: search.trim()
        ? expandMatchingSchemas(search, selectedSchemas)
        : browse.collapsedSchemas,
    });
  }

  function updateSelectedSchemas(selected: string[] | null) {
    setBrowse({
      selectedSchemas: selected,
      collapsedSchemas: browse.search.trim()
        ? expandMatchingSchemas(browse.search, selected)
        : browse.collapsedSchemas,
    });
  }

  function toggleSchema(schema: string) {
    const collapsed = browse.collapsedSchemas.includes(schema)
      ? browse.collapsedSchemas.filter((item) => item !== schema)
      : [...browse.collapsedSchemas, schema];
    setBrowse({ collapsedSchemas: collapsed });
  }

  function togglePin(table: TableInfo) {
    const key = tableKey(table);
    const pinnedTables = browse.pinnedTables.includes(key)
      ? browse.pinnedTables.filter((item) => item !== key)
      : [...browse.pinnedTables, key];
    setBrowse({ pinnedTables });
  }

  function reorderPinned(draggedKey: string, targetKey: string, edge: "before" | "after") {
    if (draggedKey === targetKey) return;
    const pinnedTables = browse.pinnedTables.filter((key) => key !== draggedKey);
    const targetIndex = pinnedTables.indexOf(targetKey);
    if (targetIndex === -1) return;
    pinnedTables.splice(targetIndex + (edge === "after" ? 1 : 0), 0, draggedKey);
    setBrowse({ pinnedTables });
  }

  function beginResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    resize.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveResize(event: ReactPointerEvent<HTMLDivElement>) {
    const current = resize.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    setWidth(clampSidebarWidth(current.startWidth + event.clientX - current.startX));
  }

  function finishResize(event: ReactPointerEvent<HTMLDivElement>) {
    const current = resize.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const nextWidth = clampSidebarWidth(current.startWidth + event.clientX - current.startX);
    resize.current = null;
    setWidth(nextWidth);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onWidthChange(nextWidth);
  }

  function cancelResize(event: ReactPointerEvent<HTMLDivElement>) {
    const current = resize.current;
    if (!current || current.pointerId !== event.pointerId) return;
    resize.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onWidthChange(width);
  }

  function resizeWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    const nextWidth = clampSidebarWidth(width + direction * SIDEBAR_RESIZE_STEP);
    setWidth(nextWidth);
    onWidthChange(nextWidth);
  }

  function resetWidth(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const nextWidth = DEFAULT_SIDEBAR_WIDTH;
    setWidth(nextWidth);
    onWidthChange(nextWidth);
  }

  return (
    <aside
      id="database-explorer-sidebar"
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col border-r bg-sidebar"
    >
      <div className="flex flex-col gap-2 border-b border-sidebar-border/60 p-2 pb-2.5">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <ConnectionSwitcher current={connection} />
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Collapse database sidebar"
            title="Collapse sidebar"
            onClick={onCollapse}
          >
            <PanelLeftCloseIcon />
          </Button>
        </div>
        <Link
          href={queryHref}
          aria-current={pathname === queryHref ? "page" : undefined}
          className={cn(
            buttonVariants({ variant: pathname === queryHref ? "secondary" : "ghost", size: "sm" }),
            "h-8 w-full justify-start px-2",
          )}
        >
          <SquareTerminalIcon data-icon="inline-start" />
          SQL query
        </Link>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={browse.search}
            onChange={(event) => updateSearch(event.target.value)}
            placeholder="Search tables"
            aria-label="Search tables"
            className="h-9 bg-background/60 pr-9 pl-8"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 font-mono text-[10px] text-muted-foreground/55">
            ⌘P
          </kbd>
        </div>
        <SchemaMultiSelect
          schemas={schemas}
          selected={selectedSchemas}
          onChange={updateSelectedSchemas}
        />
      </div>

      <ScrollArea className="min-h-0 flex-1 pt-1.5">
        {tables.error ? (
          <p className="px-3 py-4 text-xs text-destructive">{tables.error}</p>
        ) : tables.data ? (
          <TableList
            connectionId={connection.id}
            tables={visible}
            search={browse.search}
            collapsedSchemas={browse.collapsedSchemas}
            pinnedTables={browse.pinnedTables}
            onToggleSchema={toggleSchema}
            onTogglePin={togglePin}
            onReorderPinned={reorderPinned}
          />
        ) : (
          <div className="flex flex-col gap-2 px-3 py-2">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-5 w-full" />
            ))}
          </div>
        )}
      </ScrollArea>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize database sidebar"
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuemax={MAX_SIDEBAR_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        title="Drag to resize; double-click to reset"
        onPointerDown={beginResize}
        onPointerMove={moveResize}
        onPointerUp={finishResize}
        onPointerCancel={cancelResize}
        onKeyDown={resizeWithKeyboard}
        onDoubleClick={resetWidth}
        className="group/resize absolute inset-y-0 -right-1 z-30 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors hover:after:bg-primary focus-visible:after:bg-primary"
      />
    </aside>
  );
}
