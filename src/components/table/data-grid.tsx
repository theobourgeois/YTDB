"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  EyeOffIcon,
  FileJson2Icon,
  FileSpreadsheetIcon,
  Link2Icon,
  LoaderCircleIcon,
  Maximize2Icon,
  MinusIcon,
  PinIcon,
  PlusIcon,
  SquareArrowOutUpRightIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  tableKey,
  type Cell,
  type CellUpdate,
  type CellUpdateResult,
  type ColumnInfo,
  type Filter,
  type ForeignKey,
  type RowDeleteResult,
  type RowUpdate,
  type RowUpdateResult,
  type Sort,
  type TableInfo,
  type TableRef,
} from "@/lib/types";
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
import { displayColumns } from "@/lib/columns";
import { httpUrl } from "@/lib/urls";
import { CellEditor, isInlineChoiceEditor } from "./cell-editor";
import { FkCellValue } from "./fk-cell";
import { HighlightMatch } from "./highlight-match";
import { RowEditPanel, type RowEditTarget } from "./row-edit-panel";
import { RowPeek, type PeekState } from "./row-peek";

type FkContext = {
  table?: TableInfo;
  tables: TableInfo[];
  relatedRows: RelatedRows;
  connectionUrl: string;
  onOpenTable: (table: TableRef, filters: Filter[]) => void;
};

type Props = {
  columns: string[];
  columnInfo: Map<string, ColumnInfo>;
  rows: Cell[][];
  table: TableRef;
  tableKind: TableInfo["kind"];
  fileName: string;
  dimmed?: boolean;
  sort: Sort | null;
  columnWidths: Record<string, number>;
  jumpColumn?: string | null;
  search?: string;
  pinnedColumns: string[];
  hiddenColumns: string[];
  fk?: FkContext;
  onSortChange: (sort: Sort | null) => void;
  onColumnWidthsChange: (widths: Record<string, number>) => void;
  onTogglePin: (column: string) => void;
  onToggleHidden: (column: string) => void;
  /** Omitted when the relation cannot take new rows. */
  onInsertRow?: () => void;
  onUpdateCell: (update: CellUpdate) => Promise<CellUpdateResult>;
  /** Omitted when the relation cannot be edited, which hides the expand control. */
  onUpdateRow?: (update: Omit<RowUpdate, "table">) => Promise<RowUpdateResult>;
  onDeleteRows: (primaryKeys: Record<string, Cell>[]) => Promise<RowDeleteResult>;
};

type ContextCell = {
  rowIndex: number;
  cellIndex: number;
  value: Cell;
};

type ActiveCell = Pick<ContextCell, "rowIndex" | "cellIndex">;

type EditingCell = ActiveCell & { anchor: HTMLElement };

type ExportFormat = "json" | "csv";

type ColumnResize = {
  column: string;
  pointerId: number;
  startX: number;
  startWidth: number;
};

type GridRowsState = {
  source: Cell[][];
  current: Cell[][];
};

const MIN_COLUMN_WIDTH = 80;
const MAX_COLUMN_WIDTH = 640;
const COLUMN_RESIZE_STEP = 16;

function clampColumnWidth(width: number): number {
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(width)));
}

function columnStyle(width: number | undefined): CSSProperties | undefined {
  if (typeof width !== "number" || !Number.isFinite(width)) return undefined;
  const clampedWidth = clampColumnWidth(width);
  return { width: clampedWidth, minWidth: clampedWidth, maxWidth: clampedWidth };
}

function modifierOpensLink(event: KeyboardEvent | MouseEvent): boolean {
  if (event instanceof KeyboardEvent && event.type === "keyup") {
    if (event.key === "Meta" || event.key === "Control") {
      return event.key === "Meta" ? event.ctrlKey : event.metaKey;
    }
  }
  return event.metaKey || event.ctrlKey;
}

function CellValue({
  value,
  query,
  linkModifier = false,
}: {
  value: Cell;
  query: string;
  linkModifier?: boolean;
}) {
  if (value === null) return <span className="text-muted-foreground/60">null</span>;
  if (typeof value === "boolean") {
    const text = value ? "true" : "false";
    return (
      <span>
        <HighlightMatch text={text} query={query} />
      </span>
    );
  }
  const text = String(value);
  const link = httpUrl(value);
  return (
    <span
      title={text}
      className={
        link && linkModifier
          ? "underline-offset-2 decoration-foreground group-hover/cell:underline"
          : undefined
      }
    >
      <HighlightMatch text={text} query={query} />
    </span>
  );
}

function cellToText(value: Cell): string {
  return value === null ? "null" : String(value);
}

function rowsAsObjects(columns: string[], rows: Cell[][]) {
  return rows.map((row) =>
    Object.fromEntries(columns.map((column, index) => [column, row[index] ?? null])),
  );
}

function toJson(columns: string[], rows: Cell[][]): string {
  return JSON.stringify(rowsAsObjects(columns, rows), null, 2);
}

function csvCell(value: Cell): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(columns: string[], rows: Cell[][]): string {
  return [columns.map(csvCell), ...rows.map((row) => row.map(csvCell))]
    .map((row) => row.join(","))
    .join("\r\n");
}

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

function SelectionCheckbox({
  checked,
  mixed = false,
  label,
  className,
  onClick,
}: {
  checked: boolean;
  mixed?: boolean;
  label: string;
  className?: string;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? "mixed" : checked}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex size-4 cursor-pointer items-center justify-center rounded-[5px] border border-input bg-background text-transparent outline-none transition-[background-color,border-color,color,opacity] hover:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring/60",
        (checked || mixed) && "border-primary bg-primary text-primary-foreground",
        className,
      )}
    >
      {mixed ? (
        <MinusIcon className="size-3" strokeWidth={3} />
      ) : (
        <CheckIcon className="size-3" strokeWidth={3} />
      )}
    </button>
  );
}

export function DataGrid({
  columns,
  columnInfo,
  rows,
  table,
  tableKind,
  fileName,
  dimmed,
  sort,
  columnWidths: persistedColumnWidths,
  jumpColumn,
  search = "",
  pinnedColumns = [],
  hiddenColumns = [],
  fk,
  onSortChange,
  onColumnWidthsChange,
  onTogglePin,
  onToggleHidden,
  onInsertRow,
  onUpdateCell,
  onUpdateRow,
  onDeleteRows,
}: Props) {
  const [gridRowsState, setGridRowsState] = useState<GridRowsState>(() => ({
    source: rows,
    current: rows,
  }));
  const [columnWidths, setColumnWidths] = useState(persistedColumnWidths);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(() => new Set());
  const [contextCell, setContextCell] = useState<ContextCell | null>(null);
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [peek, setPeek] = useState<PeekState | null>(null);
  const [editRow, setEditRow] = useState<RowEditTarget | null>(null);
  const [copied, setCopied] = useState<"cell" | ExportFormat | null>(null);
  const [pendingDelete, setPendingDelete] = useState<number[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [linkModifier, setLinkModifier] = useState(false);
  const selectionAnchor = useRef<number | null>(null);
  const copyFeedbackTimer = useRef<number | null>(null);
  const columnWidthsRef = useRef(persistedColumnWidths);
  const columnResize = useRef<ColumnResize | null>(null);

  let gridRows = gridRowsState.current;
  if (gridRowsState.source !== rows) {
    gridRows = rows;
    setGridRowsState({ source: rows, current: rows });
  }
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRefs = useRef(new Map<string, HTMLTableCellElement>());
  const checkboxHeaderRef = useRef<HTMLTableCellElement>(null);
  const [freezeLeft, setFreezeLeft] = useState<Record<string, number>>({});

  const visibleColumns = useMemo(
    () => displayColumns(columns, pinnedColumns, hiddenColumns),
    [columns, pinnedColumns, hiddenColumns],
  );
  const pinnedVisible = useMemo(
    () => pinnedColumns.filter((column) => visibleColumns.includes(column)),
    [pinnedColumns, visibleColumns],
  );
  const pinnedSet = useMemo(() => new Set(pinnedVisible), [pinnedVisible]);
  const lastPinned = pinnedVisible.at(-1) ?? null;

  useLayoutEffect(() => {
    if (!jumpColumn) return;
    const header = headerRefs.current.get(jumpColumn);
    const scroller = scrollRef.current;
    if (!header || !scroller) return;
    const headerRect = header.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const padding = 24;
    const fullyVisible =
      headerRect.left >= scrollerRect.left + padding &&
      headerRect.right <= scrollerRect.right - padding;
    if (fullyVisible) return;
    const delta =
      headerRect.left + headerRect.width / 2 - (scrollerRect.left + scrollerRect.width / 2);
    scroller.scrollBy({ left: delta, behavior: "auto" });
  }, [jumpColumn, columns, gridRows]);

  useLayoutEffect(() => {
    const checkboxWidth = checkboxHeaderRef.current?.getBoundingClientRect().width ?? 40;
    let left = checkboxWidth;
    const next: Record<string, number> = {};
    for (const column of pinnedVisible) {
      next[column] = left;
      const width =
        headerRefs.current.get(column)?.getBoundingClientRect().width ??
        columnWidths[column] ??
        MIN_COLUMN_WIDTH;
      left += width;
    }
    // Frozen offsets are DOM measurements and must be synchronized after layout.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFreezeLeft((current) => {
      const keys = Object.keys(next);
      if (
        keys.length === Object.keys(current).length &&
        keys.every((key) => current[key] === next[key])
      ) {
        return current;
      }
      return next;
    });
  }, [pinnedVisible, visibleColumns, columnWidths, gridRows]);

  function freezeEdge(column: string | "checkbox"): boolean {
    if (pinnedVisible.length === 0) return column === "checkbox";
    return column === lastPinned;
  }

  function checkboxFreezeClass(kind: "header" | "body"): string {
    return cn(
      "sticky left-0 isolate bg-frozen-muted",
      kind === "header" ? "top-0 z-40" : "z-10",
      kind === "body" &&
        "group-hover/row:bg-frozen-hover group-data-selected/row:bg-frozen-selected group-data-selected/row:group-hover/row:bg-frozen-selected-hover",
      freezeEdge("checkbox") && "shadow-[4px_0_8px_-4px_rgba(0,0,0,0.35)]",
    );
  }

  function columnFreezeStyle(column: string): CSSProperties | undefined {
    const width = columnStyle(columnWidths[column]);
    if (!pinnedSet.has(column)) return width;
    const measured = freezeLeft[column];
    if (typeof measured === "number") return { ...width, left: measured };
    let left = 64;
    for (const pinned of pinnedVisible) {
      if (pinned === column) break;
      left += columnWidths[pinned] ?? 160;
    }
    return { ...width, left };
  }

  function columnFreezeClass(column: string, kind: "header" | "body"): string {
    if (!pinnedSet.has(column)) return "relative z-0";
    return cn(
      "sticky isolate bg-frozen",
      kind === "header" ? "top-0 z-30" : "z-[9]",
      kind === "body" &&
        "group-hover/row:bg-frozen-hover group-data-selected/row:bg-frozen-selected group-data-selected/row:group-hover/row:bg-frozen-selected-hover",
      freezeEdge(column) && "shadow-[4px_0_8px_-4px_rgba(0,0,0,0.35)]",
    );
  }

  function projectRows(data: Cell[][]): Cell[][] {
    return data.map((row) =>
      visibleColumns.map((column) => row[columns.indexOf(column)] ?? null),
    );
  }

  const selectedIndices = [...selectedRows].sort((left, right) => left - right);
  const selectedData = selectedIndices.map((index) => gridRows[index]).filter(Boolean);
  const allSelected = gridRows.length > 0 && selectedRows.size === gridRows.length;
  const someSelected = selectedRows.size > 0 && !allSelected;

  function toggleRow(rowIndex: number, event: ReactMouseEvent<HTMLButtonElement>) {
    setSelectedRows((current) => {
      const next = new Set(current);
      if (event.shiftKey && selectionAnchor.current !== null) {
        const start = Math.min(selectionAnchor.current, rowIndex);
        const end = Math.max(selectionAnchor.current, rowIndex);
        for (let index = start; index <= end; index += 1) next.add(index);
      } else if (next.has(rowIndex)) {
        next.delete(rowIndex);
      } else {
        next.add(rowIndex);
      }
      return next;
    });
    if (!event.shiftKey) selectionAnchor.current = rowIndex;
  }

  function toggleAllRows() {
    setSelectedRows(allSelected ? new Set() : new Set(gridRows.map((_, index) => index)));
    selectionAnchor.current = allSelected ? null : 0;
  }

  function nextSort(column: string): Sort | null {
    if (sort?.column !== column) return { column, direction: "asc" };
    if (sort.direction === "asc") return { column, direction: "desc" };
    return null;
  }

  function changeSort(column: string) {
    setSelectedRows(new Set());
    selectionAnchor.current = null;
    setActiveCell(null);
    setEditingCell(null);
    setPeek(null);
    setEditRow(null);
    onSortChange(nextSort(column));
  }

  function updateColumnWidth(column: string, width: number) {
    const nextWidths = { ...columnWidthsRef.current, [column]: clampColumnWidth(width) };
    columnWidthsRef.current = nextWidths;
    setColumnWidths(nextWidths);
    return nextWidths;
  }

  function beginColumnResize(column: string, event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const header = event.currentTarget.parentElement;
    const startWidth = columnWidths[column] ?? header?.getBoundingClientRect().width;
    if (!startWidth) return;

    columnResize.current = {
      column,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveColumnResize(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = columnResize.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    updateColumnWidth(resize.column, resize.startWidth + event.clientX - resize.startX);
  }

  function finishColumnResize(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = columnResize.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const nextWidths = updateColumnWidth(
      resize.column,
      resize.startWidth + event.clientX - resize.startX,
    );
    columnResize.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onColumnWidthsChange(nextWidths);
  }

  function cancelColumnResize(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = columnResize.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    columnResize.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onColumnWidthsChange(columnWidthsRef.current);
  }

  function resizeColumnWithKeyboard(
    column: string,
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    const currentWidth =
      columnWidthsRef.current[column] ?? event.currentTarget.parentElement?.getBoundingClientRect().width;
    if (!currentWidth) return;
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    onColumnWidthsChange(
      updateColumnWidth(column, currentWidth + direction * COLUMN_RESIZE_STEP),
    );
  }

  function resetColumnWidth(column: string, event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const nextWidths = { ...columnWidthsRef.current };
    delete nextWidths[column];
    columnWidthsRef.current = nextWidths;
    setColumnWidths(nextWidths);
    onColumnWidthsChange(nextWidths);
  }

  function selectContextRow(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const cell = target.closest<HTMLTableCellElement>("td[data-cell-index]");
    if (cell) {
      const rowIndex = Number(cell.dataset.rowIndex);
      const cellIndex = Number(cell.dataset.cellIndex);
      const value = gridRows[rowIndex]?.[cellIndex] ?? null;
      setContextCell({ rowIndex, cellIndex, value });
      setActiveCell({ rowIndex, cellIndex });
      return;
    }

    const header = target.closest<HTMLTableCellElement>("th[data-cell-index]");
    if (header) {
      setContextCell({
        rowIndex: -1,
        cellIndex: Number(header.dataset.cellIndex),
        value: null,
      });
      return;
    }

    setContextCell(null);
  }

  async function copy(text: string, format: "cell" | ExportFormat) {
    await writeClipboard(text);
    setCopied(format);
    if (copyFeedbackTimer.current !== null) window.clearTimeout(copyFeedbackTimer.current);
    copyFeedbackTimer.current = window.setTimeout(() => setCopied(null), 1400);
  }

  function copyRows(format: ExportFormat, data = selectedData) {
    const text =
      format === "json"
        ? toJson(visibleColumns, projectRows(data))
        : toCsv(visibleColumns, projectRows(data));
    void copy(text, format);
  }

  function exportRows(format: ExportFormat) {
    const text =
      format === "json"
        ? toJson(visibleColumns, projectRows(selectedData))
        : toCsv(visibleColumns, projectRows(selectedData));
    const blob = new Blob([text], {
      type: format === "json" ? "application/json;charset=utf-8" : "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileName.replace(/[^a-z0-9._-]+/gi, "-") || "rows"}.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function readOnlyReason(column: ColumnInfo | undefined): string | null {
    if (dimmed) return "Wait for the table to finish loading";
    if (tableKind !== "table") return "Views and foreign tables are read-only";
    if (![...columnInfo.values()].some((item) => item.isPrimaryKey)) {
      return "Editing requires a primary key";
    }
    if (!column) return "Column metadata is unavailable";
    if (column.isGenerated) return "Generated columns are read-only";
    if (column.isIdentity) return "Identity columns are read-only";
    return null;
  }

  function deleteReason(): string | null {
    if (dimmed) return "Wait for the table to finish loading";
    if (tableKind !== "table") return "Views and foreign tables are read-only";
    if (![...columnInfo.values()].some((item) => item.isPrimaryKey)) {
      return "Deleting requires a primary key";
    }
    return null;
  }

  /**
   * Whether this relation supports whole-row editing at all. Structural, so the
   * expand control does not appear and disappear as pages load: a table that
   * cannot be edited never shows one, and a loading one shows a disabled one.
   */
  function canEditRows(): boolean {
    if (!onUpdateRow || !fk?.table) return false;
    if (tableKind !== "table") return false;
    return [...columnInfo.values()].some((item) => item.isPrimaryKey);
  }

  function primaryKeyForRow(row: Cell[]): Record<string, Cell> {
    return Object.fromEntries(
      columns.flatMap((name, index) =>
        columnInfo.get(name)?.isPrimaryKey ? [[name, row[index] ?? null]] : [],
      ),
    );
  }

  function requestDelete(rowIndices: number[]) {
    if (deleteReason() || rowIndices.length === 0) return;
    setDeleteError(null);
    setPendingDelete([...new Set(rowIndices)].sort((left, right) => left - right));
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const primaryKeys = pendingDelete.flatMap((index) => {
        const row = gridRows[index];
        return row ? [primaryKeyForRow(row)] : [];
      });
      if (primaryKeys.length === 0) throw new Error("The selected rows are no longer available");
      await onDeleteRows(primaryKeys);
      const removed = new Set(pendingDelete);
      setGridRowsState((current) => ({
        ...current,
        current: current.current.filter((_, index) => !removed.has(index)),
      }));
      setSelectedRows(new Set());
      selectionAnchor.current = null;
      setActiveCell(null);
      setEditingCell(null);
      setPeek(null);
      setEditRow(null);
      setPendingDelete(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    function syncLinkModifier(event: KeyboardEvent | MouseEvent) {
      const next = modifierOpensLink(event);
      setLinkModifier((current) => (current === next ? current : next));
    }
    function clearLinkModifier() {
      setLinkModifier(false);
    }
    function onVisibilityChange() {
      if (document.hidden) clearLinkModifier();
    }
    window.addEventListener("keydown", syncLinkModifier);
    window.addEventListener("keyup", syncLinkModifier);
    window.addEventListener("mousemove", syncLinkModifier);
    window.addEventListener("blur", clearLinkModifier);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("keydown", syncLinkModifier);
      window.removeEventListener("keyup", syncLinkModifier);
      window.removeEventListener("mousemove", syncLinkModifier);
      window.removeEventListener("blur", clearLinkModifier);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (pendingDelete || editingCell || selectedRows.size === 0) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
          return;
        }
      }
      event.preventDefault();
      requestDelete([...selectedRows]);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingDelete, editingCell, selectedRows, dimmed, tableKind, columnInfo]);

  async function saveEditedCell(value: Cell) {
    if (!editingCell) return;
    const column = columns[editingCell.cellIndex];
    const row = gridRows[editingCell.rowIndex];
    if (!column || !row) throw new Error("The selected cell is no longer available");

    const primaryKey = Object.fromEntries(
      columns.flatMap((name, index) =>
        columnInfo.get(name)?.isPrimaryKey ? [[name, row[index] ?? null]] : [],
      ),
    );
    const result = await onUpdateCell({ table, column, primaryKey, value });
    setGridRowsState((current) => ({
      ...current,
      current: current.current.map((currentRow, rowIndex) => {
        if (rowIndex !== editingCell.rowIndex) return currentRow;
        return result.row;
      }),
    }));
    setEditingCell(null);
  }

  async function saveEditedRow(update: Omit<RowUpdate, "table">) {
    if (!onUpdateRow || !editRow) throw new Error("This row is no longer available");
    const result = await onUpdateRow(update);
    const { rowIndex } = editRow;
    setGridRowsState((current) => ({
      ...current,
      current: current.current.map((currentRow, index) =>
        index === rowIndex ? result.row : currentRow,
      ),
    }));
    setEditRow(null);
    return result;
  }

  function openPeek(anchor: HTMLElement, relation: ForeignKey, row: Cell[]) {
    const key = keyValuesForForeignKey(relation, columns, row);
    if (!key) return;
    setEditingCell(null);
    setPeek((current) => {
      // Clicking the same cell again (the td or the FK button inside it) closes the peek.
      if (current && (current.anchor.contains(anchor) || anchor.contains(current.anchor))) return null;
      return {
        anchor,
        stack: [{ table: relation.referencedTable, keyColumns: relation.referencedColumns, key }],
      };
    });
  }

  function fkLabel(relation: ForeignKey, row: Cell[]): string | null {
    const key = keyValuesForForeignKey(relation, columns, row);
    if (!key) return null;
    const cached = fk?.relatedRows.get(relatedCacheKey(relation.referencedTable, key));
    if (!cached) return null;
    const referenced = findTable(fk?.tables ?? [], relation.referencedTable);
    return relatedLabel(
      cached.columns,
      cached.row,
      displayColumnName(referenced?.columns ?? [], relation.referencedColumns),
    );
  }

  function referencedTitle(relation: ForeignKey): string {
    return `${tableKey(relation.referencedTable)}.${relation.referencedColumns.join(", ")}`;
  }

  const contextIsRow = contextCell !== null && contextCell.rowIndex >= 0;
  const contextUrl = contextIsRow && contextCell ? httpUrl(contextCell.value) : null;
  const contextColumn = contextCell ? columns[contextCell.cellIndex] : undefined;
  const contextRow =
    contextIsRow && contextCell ? gridRows[contextCell.rowIndex] : undefined;
  const contextPinned = Boolean(contextColumn && pinnedSet.has(contextColumn));
  const contextHiddenCount = hiddenColumns.filter((column) => columns.includes(column)).length;
  const contextCanHide = Boolean(contextColumn) && columns.length - contextHiddenCount > 1;
  const contextFk = contextColumn ? foreignKeyForColumn(fk?.table, contextColumn) : undefined;
  const contextFkKey =
    contextFk && contextRow ? keyValuesForForeignKey(contextFk, columns, contextRow) : null;
  const contextDeleteIndices =
    contextIsRow && contextCell && selectedRows.has(contextCell.rowIndex) && selectedRows.size > 1
      ? [...selectedRows]
      : contextIsRow && contextCell
        ? [contextCell.rowIndex]
        : [];
  const cannotDelete = deleteReason();
  const editableRows = canEditRows();
  const pendingDeleteCount = pendingDelete?.length ?? 0;
  const editingColumn = editingCell ? columns[editingCell.cellIndex] : undefined;
  const editingInfo = editingColumn ? columnInfo.get(editingColumn) : undefined;
  const editingInline = Boolean(editingInfo && isInlineChoiceEditor(editingInfo));
  const editingFk = editingColumn ? foreignKeyForColumn(fk?.table, editingColumn) : undefined;
  const editingReferenced = editingFk
    ? findTable(fk?.tables ?? [], editingFk.referencedTable)
    : undefined;

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col transition-opacity",
        dimmed && "opacity-50",
      )}
    >
      {selectedRows.size > 0 && (
        <div className="flex h-10 shrink-0 items-center gap-1.5 border-b bg-muted/20 px-2.5">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => {
              setSelectedRows(new Set());
              selectionAnchor.current = null;
            }}
            aria-label="Clear row selection"
          >
            <XIcon />
          </Button>
          <span className="mr-1 text-xs font-medium tabular-nums">
            {selectedRows.size} selected
          </span>
          <div className="mx-0.5 h-4 w-px bg-border" />
          <Button variant="ghost" size="sm" onClick={() => copyRows("json")}>
            <CopyIcon data-icon="inline-start" />
            {copied === "json" ? "Copied" : "Copy JSON"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => copyRows("csv")}>
            <CopyIcon data-icon="inline-start" />
            {copied === "csv" ? "Copied" : "Copy CSV"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="sm" />}
              className="cursor-pointer"
            >
              <DownloadIcon data-icon="inline-start" />
              Export
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={4} className="min-w-40">
              <DropdownMenuItem onClick={() => exportRows("json")}>
                <FileJson2Icon />
                Export JSON
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportRows("csv")}>
                <FileSpreadsheetIcon />
                Export CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="destructive"
            size="sm"
            className="ml-auto"
            disabled={Boolean(cannotDelete)}
            title={cannotDelete ?? undefined}
            onClick={() => requestDelete(selectedIndices)}
          >
            <Trash2Icon data-icon="inline-start" />
            Delete
          </Button>
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <ContextMenu onOpenChange={(open) => !open && setContextCell(null)}>
          <ContextMenuTrigger
            onContextMenuCapture={selectContextRow}
            className="w-max min-w-full"
          >
            <table className="w-max min-w-full border-separate border-spacing-0 font-mono text-xs">
              <thead className="sticky top-0 z-20 bg-frozen">
                <tr>
                  <th
                    ref={checkboxHeaderRef}
                    className={cn(
                      "h-8 w-16 border-b border-r pr-1.5 pl-2 font-normal text-muted-foreground",
                      checkboxFreezeClass("header"),
                    )}
                  >
                    <div className="flex items-center gap-1">
                      <span className="flex w-6 shrink-0 items-center justify-center">
                        <SelectionCheckbox
                          checked={allSelected}
                          mixed={someSelected}
                          label={
                            allSelected
                              ? "Clear all rows on this page"
                              : "Select all rows on this page"
                          }
                          onClick={toggleAllRows}
                        />
                      </span>
                      {editableRows && <span aria-hidden className="size-5 shrink-0" />}
                    </div>
                  </th>
                  {visibleColumns.map((column) => {
                    const cellIndex = columns.indexOf(column);
                    const info = columnInfo.get(column);
                    const direction = sort?.column === column ? sort.direction : null;
                    const sortLabel = direction === null
                      ? `Sort ${column} ascending`
                      : direction === "asc"
                        ? `Sort ${column} descending`
                        : `Clear sorting for ${column}`;
                    const jumped = jumpColumn === column;
                    const relation = foreignKeyForColumn(fk?.table, column);
                    return (
                      <th
                        key={column}
                        data-cell-index={cellIndex}
                        ref={(node) => {
                          if (node) headerRefs.current.set(column, node);
                          else headerRefs.current.delete(column);
                        }}
                        aria-sort={
                          direction === "asc"
                            ? "ascending"
                            : direction === "desc"
                              ? "descending"
                              : "none"
                        }
                        style={columnFreezeStyle(column)}
                        className={cn(
                          "relative h-8 max-w-80 border-b border-r p-0 text-left font-normal whitespace-nowrap select-none",
                          columnFreezeClass(column, "header"),
                          jumped &&
                            (pinnedSet.has(column)
                              ? "bg-frozen-jump shadow-[inset_0_-2px_0_0_var(--primary)]"
                              : "bg-primary/12 shadow-[inset_0_-2px_0_0_var(--primary)]"),
                        )}
                      >
                        <button
                          type="button"
                          aria-label={sortLabel}
                          title={sortLabel}
                          onClick={() => changeSort(column)}
                          className="group/sort flex h-full w-full items-center gap-2 overflow-hidden px-3 pr-5 text-left outline-none hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
                        >
                          {pinnedSet.has(column) && (
                            <PinIcon className="size-3 shrink-0 fill-current text-muted-foreground" />
                          )}
                          <span className={cn("truncate", info?.isPrimaryKey && "font-semibold")}>
                            {column}
                          </span>
                          {relation && (
                            <span
                              title={`References ${referencedTitle(relation)}`}
                              className="shrink-0 text-muted-foreground/70"
                            >
                              <Link2Icon className="size-3" />
                            </span>
                          )}
                          {info && (
                            <span className="shrink-0 text-muted-foreground/70">{info.type}</span>
                          )}
                          {direction === "asc" ? (
                            <ArrowUpIcon className="ml-auto size-3.5 shrink-0" />
                          ) : direction === "desc" ? (
                            <ArrowDownIcon className="ml-auto size-3.5 shrink-0" />
                          ) : (
                            <ArrowUpDownIcon className="ml-auto size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60" />
                          )}
                        </button>
                        <div
                          role="separator"
                          aria-orientation="vertical"
                          aria-label={`Resize ${column} column`}
                          aria-valuemin={MIN_COLUMN_WIDTH}
                          aria-valuemax={MAX_COLUMN_WIDTH}
                          aria-valuenow={columnWidths[column]}
                          tabIndex={0}
                          title="Drag to resize; double-click to reset"
                          onPointerDown={(event) => beginColumnResize(column, event)}
                          onPointerMove={moveColumnResize}
                          onPointerUp={finishColumnResize}
                          onPointerCancel={cancelColumnResize}
                          onKeyDown={(event) => resizeColumnWithKeyboard(column, event)}
                          onDoubleClick={(event) => resetColumnWidth(column, event)}
                          className="group/resize absolute inset-y-0 -right-1 z-40 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-1 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors hover:after:bg-primary focus-visible:after:bg-primary"
                        />
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {gridRows.map((row, rowIndex) => {
                  const selected = selectedRows.has(rowIndex);
                  return (
                    <tr
                      key={rowIndex}
                      data-selected={selected || undefined}
                      className="group/row hover:bg-muted/40 data-selected:bg-primary/[0.07] data-selected:hover:bg-primary/[0.09]"
                    >
                      <td
                        className={cn(
                          "h-7 w-16 border-b border-r pr-1.5 pl-2 text-muted-foreground tabular-nums",
                          checkboxFreezeClass("body"),
                        )}
                      >
                        <div className="flex items-center gap-1">
                          <span className="relative flex w-6 shrink-0 items-center justify-center">
                            <span
                              className={cn(
                                "transition-opacity group-hover/row:opacity-0",
                                selected && "opacity-0",
                              )}
                            >
                              {rowIndex + 1}
                            </span>
                            <SelectionCheckbox
                              checked={selected}
                              label={`${selected ? "Deselect" : "Select"} row ${rowIndex + 1}`}
                              onClick={(event) => toggleRow(rowIndex, event)}
                              className={cn(
                                "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
                                selected ? "opacity-100" : "opacity-0 group-hover/row:opacity-100",
                              )}
                            />
                          </span>
                          {editableRows && (
                            <button
                              type="button"
                              aria-label={`Expand row ${rowIndex + 1}`}
                              title={
                                dimmed
                                  ? "Wait for the table to finish loading"
                                  : `Expand row ${rowIndex + 1}`
                              }
                              disabled={dimmed}
                              onClick={() => setEditRow({ rowIndex, row, columns })}
                              className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none transition-[opacity,background-color,color] hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none group-hover/row:opacity-100"
                            >
                              <Maximize2Icon className="size-3" />
                            </button>
                          )}
                        </div>
                      </td>
                      {visibleColumns.map((column) => {
                        const cellIndex = columns.indexOf(column);
                        const cell = row[cellIndex] ?? null;
                        const info = columnInfo.get(column);
                        const reason = readOnlyReason(info);
                        const relation = foreignKeyForColumn(fk?.table, column);
                        const followable = Boolean(relation && cell !== null);
                        const url = httpUrl(cell);
                        const inlineEditing =
                          editingCell?.rowIndex === rowIndex &&
                          editingCell.cellIndex === cellIndex &&
                          Boolean(info && isInlineChoiceEditor(info));
                        return (
                          <td
                            key={column}
                            data-row-index={rowIndex}
                            data-cell-index={cellIndex}
                            title={
                              inlineEditing
                                ? undefined
                                : url
                                  ? `${url} · ⌘/Ctrl-click to open`
                                  : followable && relation
                                    ? `${referencedTitle(relation)} · Double-click to edit`
                                    : (reason ?? "Double-click to edit")
                            }
                            onClick={(event) => {
                              setActiveCell({ rowIndex, cellIndex });
                              if (!(event.metaKey || event.ctrlKey)) return;
                              if (url) {
                                event.preventDefault();
                                window.open(url, "_blank", "noopener,noreferrer");
                                return;
                              }
                              if (followable && relation) {
                                openPeek(event.currentTarget, relation, row);
                              }
                            }}
                            onDoubleClick={(event) => {
                              setActiveCell({ rowIndex, cellIndex });
                              setPeek(null);
                              if (!reason) {
                                setEditingCell({
                                  rowIndex,
                                  cellIndex,
                                  anchor: event.currentTarget,
                                });
                              }
                            }}
                            style={columnFreezeStyle(column)}
                            className={cn(
                              "group/cell h-7 max-w-80 border-b border-r px-3 whitespace-nowrap select-none",
                              url && linkModifier ? "cursor-pointer" : "cursor-default",
                              inlineEditing ? "overflow-visible" : "truncate",
                              columnFreezeClass(column, "body"),
                              jumpColumn === column &&
                                (pinnedSet.has(column) ? "bg-frozen-jump" : "bg-primary/6"),
                              activeCell?.rowIndex === rowIndex &&
                                activeCell.cellIndex === cellIndex &&
                                (pinnedSet.has(column)
                                  ? "z-[11] bg-frozen-active outline-2 -outline-offset-2 outline-primary/70"
                                  : "relative z-[3] bg-primary/4 outline-2 -outline-offset-2 outline-primary/70"),
                            )}
                          >
                            {inlineEditing && info && editingCell ? (
                              <CellEditor
                                anchor={editingCell.anchor}
                                column={info}
                                value={cell}
                                foreignKey={editingFk}
                                referencedTable={editingReferenced}
                                connectionUrl={fk?.connectionUrl}
                                onClose={() => setEditingCell(null)}
                                onSave={saveEditedCell}
                              />
                            ) : followable && relation ? (
                              <FkCellValue
                                value={cell}
                                label={fkLabel(relation, row)}
                                referenced={referencedTitle(relation)}
                                query={search}
                                onOpen={(event) => {
                                  event.stopPropagation();
                                  setActiveCell({ rowIndex, cellIndex });
                                  openPeek(event.currentTarget, relation, row);
                                }}
                              />
                            ) : (
                              <CellValue value={cell} query={search} linkModifier={linkModifier} />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              disabled={!contextIsRow || !contextCell}
              onClick={() => contextCell && void copy(cellToText(contextCell.value), "cell")}
            >
              <CopyIcon />
              Copy cell
              {contextColumn && (
                <span className="ml-auto max-w-24 truncate text-[10px] text-muted-foreground">
                  {contextColumn}
                </span>
              )}
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!contextUrl}
              onClick={() => {
                if (!contextUrl) return;
                window.open(contextUrl, "_blank", "noopener,noreferrer");
              }}
            >
              <SquareArrowOutUpRightIcon />
              Open URL
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!contextFk || !contextFkKey || !contextRow || !contextIsRow}
              onClick={() => {
                if (!contextFk || !contextRow || !contextCell) return;
                const target = scrollRef.current?.querySelector<HTMLElement>(
                  `td[data-row-index="${contextCell.rowIndex}"][data-cell-index="${contextCell.cellIndex}"]`,
                );
                if (!target) return;
                // Always open from the menu, never toggle an already-open peek closed.
                setPeek(null);
                openPeek(target, contextFk, contextRow);
              }}
            >
              <Link2Icon />
              View referenced row
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!contextFk || !contextFkKey || !fk}
              onClick={() => {
                if (!contextFk || !contextFkKey || !fk) return;
                fk.onOpenTable(
                  contextFk.referencedTable,
                  filtersForKey(contextFk.referencedColumns, contextFkKey),
                );
              }}
            >
              <SquareArrowOutUpRightIcon />
              Open referenced table
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={!onInsertRow} onClick={() => onInsertRow?.()}>
              <PlusIcon />
              Insert row
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={!contextColumn}
              onClick={() => contextColumn && onTogglePin(contextColumn)}
            >
              <PinIcon className={cn(contextPinned && "fill-current")} />
              {contextPinned ? "Unpin column" : "Pin column"}
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!contextColumn || !contextCanHide}
              onClick={() => contextColumn && onToggleHidden(contextColumn)}
            >
              <EyeOffIcon />
              Hide column
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={!contextIsRow || !contextCell}
              onClick={() =>
                contextCell && copyRows("json", [gridRows[contextCell.rowIndex]])
              }
            >
              <FileJson2Icon />
              Copy row as JSON
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!contextIsRow || !contextCell}
              onClick={() => contextCell && copyRows("csv", [gridRows[contextCell.rowIndex]])}
            >
              <FileSpreadsheetIcon />
              Copy row as CSV
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              disabled={!contextIsRow || !contextCell || Boolean(cannotDelete)}
              onClick={() => requestDelete(contextDeleteIndices)}
            >
              <Trash2Icon />
              {contextDeleteIndices.length > 1
                ? `Delete ${contextDeleteIndices.length} selected rows`
                : "Delete row"}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {gridRows.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-10">
            <p className="text-sm text-muted-foreground">No rows</p>
            {onInsertRow && (
              <Button variant="outline" size="sm" onClick={onInsertRow}>
                <PlusIcon data-icon="inline-start" />
                Insert row
              </Button>
            )}
          </div>
        )}
      </div>
      {editingCell && editingInfo && !editingInline && (
        <CellEditor
          key={`${editingCell.rowIndex}:${editingCell.cellIndex}`}
          anchor={editingCell.anchor}
          column={editingInfo}
          value={gridRows[editingCell.rowIndex]?.[editingCell.cellIndex] ?? null}
          foreignKey={editingFk}
          referencedTable={editingReferenced}
          connectionUrl={fk?.connectionUrl}
          onClose={() => setEditingCell(null)}
          onSave={saveEditedCell}
        />
      )}
      {peek && fk && (
        <RowPeek
          peek={peek}
          connectionUrl={fk.connectionUrl}
          tables={fk.tables}
          relatedRows={fk.relatedRows}
          onClose={() => setPeek(null)}
          onPeek={setPeek}
          onUpdateCell={onUpdateCell}
          onOpenTable={(nextTable, filters) => {
            setPeek(null);
            fk.onOpenTable(nextTable, filters);
          }}
        />
      )}
      {fk?.table && onUpdateRow && (
        <RowEditPanel
          target={editRow}
          table={fk.table}
          tables={fk.tables}
          connectionUrl={fk.connectionUrl}
          onOpenChange={(open) => !open && setEditRow(null)}
          onUpdate={saveEditedRow}
        />
      )}
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) {
            setPendingDelete(null);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent showCloseButton={!deleting} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingDeleteCount === 1
                ? "Delete this row?"
                : `Delete ${pendingDeleteCount} rows?`}
            </DialogTitle>
            <DialogDescription>
              This permanently deletes{" "}
              {pendingDeleteCount === 1 ? "the selected row" : `${pendingDeleteCount} selected rows`}{" "}
              from {tableKey(table)}. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p role="alert" className="font-mono text-xs text-destructive">
              {deleteError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={deleting}
              onClick={() => {
                setPendingDelete(null);
                setDeleteError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting && <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />}
              {deleting
                ? "Deleting…"
                : pendingDeleteCount === 1
                  ? "Delete row"
                  : `Delete ${pendingDeleteCount} rows`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
