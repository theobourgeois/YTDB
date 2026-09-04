"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { useExplorerContext } from "@/components/explorer/explorer-provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAsync } from "@/hooks/use-async";
import { useDebounced } from "@/hooks/use-debounced";
import { api } from "@/lib/api";
import {
  resolvePinnedColumns,
  toggleHiddenColumn,
  togglePinnedColumn,
} from "@/lib/columns";
import { isFilterComplete } from "@/lib/filters";
import {
  relatedLookupsForRows,
  relatedRowsMap,
  tableHref,
} from "@/lib/foreign-keys";
import { useExplorer, useTableState } from "@/lib/store/explorer";
import {
  tableKey,
  type Cell,
  type ColumnInfo,
  type Filter,
  type TableInfo,
  type TableRef,
} from "@/lib/types";
import { ColumnJump } from "./column-jump";
import { ColumnLayoutMenu } from "./column-layout";
import { DataGrid } from "./data-grid";
import { DefinitionView } from "./definition-view";
import { FilterBar } from "./filter-bar";
import { Pagination, type TablePane } from "./pagination";
import { RowInsertDialog } from "./row-insert-dialog";

/** Names the row that was just inserted by its primary key, when it has one. */
function insertedLabel(info: TableInfo, row: Cell[]): string {
  const keys = info.columns.flatMap((column, index) =>
    column.isPrimaryKey ? [`${column.name} ${String(row[index] ?? "null")}`] : [],
  );
  return keys.length > 0 ? `Inserted ${keys.join(", ")}` : "Row inserted";
}

export function TableView({ table }: { table: TableRef }) {
  const router = useRouter();
  const { connection, tables } = useExplorerContext();
  const [state, setState] = useTableState(connection.id, table);
  const [jumpColumn, setJumpColumn] = useState<string | null>(null);
  const [pane, setPane] = useState<TablePane>("data");
  const [inserting, setInserting] = useState(false);
  const [insertNotice, setInsertNotice] = useState<string | null>(null);
  const insertNoticeTimer = useRef<number | null>(null);

  const info = tables.data?.find(
    (item) => item.schema === table.schema && item.name === table.name,
  );
  const columnInfo = useMemo(
    () => new Map<string, ColumnInfo>(info?.columns.map((column) => [column.name, column]) ?? []),
    [info],
  );
  const pinnedColumns = useMemo(
    () => resolvePinnedColumns(state.pinnedColumns, info?.columns ?? []),
    [state.pinnedColumns, info],
  );

  const appliedFilters = useDebounced(state.filters.filter(isFilterComplete), 300);
  const appliedSearch = useDebounced(state.search.trim(), 300);
  const query = useMemo(
    () => ({
      table,
      filters: appliedFilters,
      search: appliedSearch,
      sort: state.sort,
      page: state.page,
      pageSize: state.pageSize,
    }),
    [table, appliedFilters, appliedSearch, state.sort, state.page, state.pageSize],
  );
  const rows = useAsync(
    `${connection.url}:${JSON.stringify(query)}`,
    (signal) => api.rows(connection.url, query, signal),
  );

  const relatedLookups = useMemo(() => {
    if (!info || !rows.data) return [];
    return relatedLookupsForRows(info, rows.data.columns, rows.data.rows);
  }, [info, rows.data]);
  const related = useAsync(
    relatedLookups.length === 0
      ? `${connection.url}:related:none`
      : `${connection.url}:related:${JSON.stringify(relatedLookups)}`,
    (signal) =>
      relatedLookups.length === 0
        ? Promise.resolve([])
        : api.related(connection.url, relatedLookups, signal),
  );
  const relatedRows = useMemo(
    () => relatedRowsMap(related.data ?? []),
    [related.data],
  );
  const definition = useAsync(
    pane === "definition" ? `${connection.url}:def:${tableKey(table)}` : `${connection.url}:def:idle`,
    (signal) =>
      pane === "definition"
        ? api.definition(connection.url, table, signal)
        : Promise.resolve({ sql: "" }),
  );

  function openTable(nextTable: TableRef, filters: Filter[]) {
    useExplorer.getState().setTable(connection.id, nextTable, {
      filters,
      page: 0,
    });
    router.push(tableHref(connection.id, nextTable));
  }

  /** Why this relation cannot be written to at all, or null when it can. */
  const writeReason = !info
    ? "Table metadata is unavailable"
    : info.kind !== "table"
      ? "Views and foreign tables are read-only"
      : null;

  async function insertRow(values: Record<string, Cell>) {
    const result = await api.insertRow(connection.url, { table, values });
    setInserting(false);
    setInsertNotice(info ? insertedLabel(info, result.row) : "Row inserted");
    if (insertNoticeTimer.current !== null) window.clearTimeout(insertNoticeTimer.current);
    insertNoticeTimer.current = window.setTimeout(() => setInsertNotice(null), 4000);
    rows.reload();
    return result;
  }

  function togglePin(column: string) {
    const nextPinned = togglePinnedColumn(pinnedColumns, column);
    const pinning = nextPinned.includes(column);
    setState({
      pinnedColumns: nextPinned,
      hiddenColumns: pinning
        ? state.hiddenColumns.filter((item) => item !== column)
        : state.hiddenColumns,
    });
  }

  function toggleHidden(column: string) {
    setState({
      hiddenColumns: toggleHiddenColumn(
        state.hiddenColumns,
        column,
        info?.columns.length ?? 0,
      ),
    });
  }

  return (
    <>
      <header className="flex h-11 items-center gap-2 border-b px-4">
        <span className="truncate text-muted-foreground">{table.schema}</span>
        <span className="text-muted-foreground/50">/</span>
        <span className="truncate font-medium">{table.name}</span>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {pane === "data" ? (
            <>
              {insertNotice ? (
                <span
                  role="status"
                  title={insertNotice}
                  className="min-w-0 truncate font-mono text-xs text-muted-foreground animate-in fade-in-0"
                >
                  {insertNotice}
                </span>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                disabled={Boolean(writeReason)}
                title={writeReason ?? "Insert a new row"}
                onClick={() => setInserting(true)}
              >
                <PlusIcon data-icon="inline-start" />
                New row
              </Button>
              <ColumnLayoutMenu
                columns={info?.columns ?? []}
                pinnedColumns={pinnedColumns}
                hiddenColumns={state.hiddenColumns}
                onTogglePin={togglePin}
                onToggleHidden={toggleHidden}
                onReset={() => setState({ pinnedColumns: undefined, hiddenColumns: [] })}
              />
            </>
          ) : null}
        </div>
      </header>

      {pane === "data" ? (
        <FilterBar
          filters={state.filters}
          search={state.search}
          columns={info?.columns ?? []}
          table={info}
          tables={tables.data ?? []}
          connectionUrl={connection.url}
          onFiltersChange={(filters) => setState({ filters, page: 0 })}
          onSearchChange={(search) => setState({ search, page: 0 })}
        />
      ) : null}

      <div className="relative flex min-h-0 flex-1 flex-col">
        {pane === "definition" ? (
          <DefinitionView
            sql={definition.loading ? undefined : definition.data?.sql || undefined}
            error={definition.error}
            loading={definition.loading}
          />
        ) : rows.error ? (
          <p className="flex-1 px-4 py-6 font-mono text-xs text-destructive">{rows.error}</p>
        ) : rows.data ? (
          <DataGrid
            key={JSON.stringify({
              table,
              filters: appliedFilters,
              search: appliedSearch,
              page: state.page,
              pageSize: state.pageSize,
            })}
            columns={rows.data.columns}
            columnInfo={columnInfo}
            rows={rows.data.rows}
            table={table}
            tableKind={info?.kind ?? "view"}
            fileName={`${table.schema}-${table.name}-rows`}
            dimmed={rows.loading}
            sort={state.sort}
            columnWidths={state.columnWidths}
            jumpColumn={jumpColumn}
            search={appliedSearch}
            pinnedColumns={pinnedColumns}
            hiddenColumns={state.hiddenColumns}
            fk={{
              table: info,
              tables: tables.data ?? [],
              relatedRows,
              connectionUrl: connection.url,
              onOpenTable: openTable,
            }}
            onSortChange={(sort) => setState({ sort })}
            onColumnWidthsChange={(columnWidths) => setState({ columnWidths })}
            onTogglePin={togglePin}
            onToggleHidden={toggleHidden}
            onInsertRow={writeReason ? undefined : () => setInserting(true)}
            onUpdateCell={(update) => api.updateCell(connection.url, update)}
            onUpdateRow={
              writeReason
                ? undefined
                : (update) => api.updateRow(connection.url, { table, ...update })
            }
            onDeleteRows={async (primaryKeys) => {
              const result = await api.deleteRows(connection.url, {
                table,
                primaryKeys,
              });
              const remaining =
                rows.data?.estimated || rows.data?.total == null
                  ? null
                  : Math.max(0, rows.data.total - result.deleted);
              if (remaining == null) {
                rows.reload();
                return result;
              }
              const lastPage = Math.max(0, Math.ceil(remaining / state.pageSize) - 1);
              if (state.page > lastPage) {
                setState({ page: lastPage });
              } else {
                rows.reload();
              }
              return result;
            }}
          />
        ) : (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 12 }, (_, index) => (
              <Skeleton key={index} className="h-6 w-full" />
            ))}
          </div>
        )}
        {pane === "data" ? (
          <ColumnJump
            columns={info?.columns ?? []}
            resetKey={tableKey(table)}
            onActiveColumn={(column) => {
              setJumpColumn(column);
              if (column && state.hiddenColumns.includes(column)) {
                setState({
                  hiddenColumns: state.hiddenColumns.filter((item) => item !== column),
                });
              }
            }}
          />
        ) : null}
      </div>

      {info && info.kind === "table" ? (
        <RowInsertDialog
          open={inserting}
          table={info}
          tables={tables.data ?? []}
          connectionUrl={connection.url}
          onOpenChange={setInserting}
          onInsert={insertRow}
        />
      ) : null}

      <Pagination
        pane={pane}
        onPaneChange={setPane}
        page={state.page}
        pageSize={state.pageSize}
        rowCount={rows.data?.rows.length ?? 0}
        total={rows.data?.total ?? null}
        estimated={rows.data?.estimated ?? false}
        hasMore={rows.data?.hasMore ?? false}
        capped={rows.data?.capped}
        onPageChange={(page) => setState({ page })}
        onPageSizeChange={(pageSize) => setState({ pageSize, page: 0 })}
      />
    </>
  );
}
