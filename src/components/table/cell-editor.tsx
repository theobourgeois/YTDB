"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Popover } from "@base-ui/react/popover";
import { LoaderCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Cell, ColumnInfo, ForeignKey, TableInfo } from "@/lib/types";
import { FkPicker } from "./fk-picker";

type EditorKind = "boolean" | "date" | "enum" | "json" | "number" | "text" | "time";
type ChoiceKind = "boolean" | "enum";

type Props = {
  anchor: HTMLElement;
  column: ColumnInfo;
  value: Cell;
  foreignKey?: ForeignKey;
  referencedTable?: TableInfo;
  connectionUrl?: string;
  onClose: () => void;
  onSave: (value: Cell) => Promise<void>;
};

const INTEGER_TYPES = new Set(["int2", "int4", "int8", "oid"]);
const NUMBER_TYPES = new Set(["decimal", "float4", "float8", "numeric"]);
const TEMPORAL_TYPES = new Set(["date", "time", "timestamp", "timestamptz", "timetz"]);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const NULL_SENTINEL = "__null__";

function editorKind(column: ColumnInfo): EditorKind {
  if (Array.isArray(column.enumValues) && column.enumValues.length > 0) return "enum";
  if (column.dataType === "bool") return "boolean";
  if (column.dataType === "date" || column.dataType === "timestamp") return "date";
  if (column.dataType === "time") return "time";
  if (column.dataType === "json" || column.dataType === "jsonb") return "json";
  if (INTEGER_TYPES.has(column.dataType) || NUMBER_TYPES.has(column.dataType)) return "number";
  return "text";
}

export function isInlineChoiceEditor(column: ColumnInfo): boolean {
  const kind = editorKind(column);
  return kind === "boolean" || kind === "enum";
}

function initialDraft(value: Cell, kind: EditorKind): string {
  if (value === null) return "";
  if (kind === "json") {
    try {
      const parsed = typeof value === "string" ? JSON.parse(value) : value;
      return JSON.stringify(parsed, null, 2);
    } catch {
      return typeof value === "string" ? JSON.stringify(value) : String(value);
    }
  }
  if (kind === "date" && typeof value === "string") return value.replace(" ", "T");
  return String(value);
}

function parseDraft(column: ColumnInfo, kind: EditorKind, draft: string): Cell {
  if (kind === "boolean") return draft === "true";
  if (kind === "enum") {
    if (!column.enumValues?.includes(draft)) throw new Error("Choose a valid enum value");
    return draft;
  }
  if (kind === "json") {
    if (!draft.trim()) throw new Error("JSON cannot be empty. Use NULL instead.");
    try {
      JSON.parse(draft);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Invalid JSON";
      throw new Error(detail);
    }
    return draft;
  }
  if (kind === "number") {
    const value = draft.trim();
    if (!value) throw new Error("Enter a number or use NULL");
    if (INTEGER_TYPES.has(column.dataType) && !/^[+-]?\d+$/.test(value)) {
      throw new Error("Enter a whole number");
    }
    if (
      NUMBER_TYPES.has(column.dataType) &&
      !/^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:e[+-]?\d+)?$/i.test(value) &&
      !/^[+-]?(?:Infinity|NaN)$/i.test(value)
    ) {
      throw new Error("Enter a valid number");
    }
    return value;
  }
  return draft;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function nowValue(dataType: string): string {
  const now = new Date();
  const localDate = `${now.getFullYear()}-${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getDate())}`;
  const localTime = `${twoDigits(now.getHours())}:${twoDigits(now.getMinutes())}:${twoDigits(now.getSeconds())}`;
  if (dataType === "date") return localDate;
  if (dataType === "timestamp") return `${localDate}T${localTime}`;
  if (dataType === "timestamptz") return now.toISOString();
  if (dataType === "time") return localTime;
  if (dataType === "timetz") {
    const offset = -now.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    return `${localTime}${sign}${twoDigits(Math.floor(Math.abs(offset) / 60))}:${twoDigits(Math.abs(offset) % 60)}`;
  }
  return now.toISOString();
}

function formattedTemporalValue(dataType: string, draft: string): string {
  if (!draft) return "—";
  if (dataType === "date") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(draft);
    if (match) return `${match[3]} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
  }
  if (dataType === "timestamp") {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/.exec(draft);
    if (match) return `${match[3]} ${MONTHS[Number(match[2]) - 1]} ${match[1]} ${match[4]}`;
  }
  if (dataType === "timestamptz") {
    const date = new Date(draft.replace(" ", "T"));
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
        timeZoneName: "shortOffset",
      }).format(date);
    }
  }
  return draft.replace("T", " ");
}

function choiceItems(kind: ChoiceKind, column: ColumnInfo): { value: string; label: string }[] {
  switch (kind) {
    case "boolean":
      return [
        { value: "true", label: "true" },
        { value: "false", label: "false" },
      ];
    case "enum":
      return (column.enumValues ?? []).map((value) => ({ value, label: value }));
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function choiceDraft(value: Cell): string {
  if (value === null) return NULL_SENTINEL;
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function parseChoice(kind: ChoiceKind, column: ColumnInfo, draft: string): Cell {
  if (draft === NULL_SENTINEL) return null;
  switch (kind) {
    case "boolean":
      return draft === "true";
    case "enum":
      if (!column.enumValues?.includes(draft)) throw new Error("Choose a valid enum value");
      return draft;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function InlineChoiceEditor({
  column,
  value,
  kind,
  onClose,
  onSave,
}: Props & { kind: ChoiceKind }) {
  const items = choiceItems(kind, column);
  const [open, setOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = choiceDraft(value);
  const labels = Object.fromEntries([
    ...(column.nullable ? [[NULL_SENTINEL, "null"] as const] : []),
    ...items.map((item) => [item.value, item.label] as const),
  ]);

  async function commit(nextDraft: string) {
    if (saving) return;

    let nextValue: Cell;
    try {
      nextValue = parseChoice(kind, column, nextDraft);
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "Invalid value");
      setOpen(true);
      return;
    }

    if (Object.is(nextValue, value)) {
      onClose();
      return;
    }

    setError(null);
    setSaving(true);
    try {
      await onSave(nextValue);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not update this cell");
      setSaving(false);
      setOpen(true);
    }
  }

  return (
    <div
      data-inline-cell-editor
      className="flex h-full min-h-0 w-full items-center"
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Select
        items={labels}
        value={selected}
        open={open}
        disabled={saving}
        onValueChange={(nextValue) => {
          if (!nextValue) return;
          void commit(nextValue);
        }}
        onOpenChange={(nextOpen, eventDetails) => {
          if (saving) return;
          if (eventDetails.reason === "item-press") {
            setOpen(false);
            return;
          }
          if (!nextOpen) {
            onClose();
            return;
          }
          setOpen(true);
        }}
      >
        <SelectTrigger
          size="sm"
          aria-label={`Edit ${column.name}`}
          className="h-full w-full min-h-0 justify-start gap-0 rounded-none border-0 bg-transparent p-0 font-mono text-xs shadow-none hover:bg-transparent focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent dark:hover:bg-transparent data-[size=sm]:h-full data-[size=sm]:rounded-none [&_svg]:hidden"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start" sideOffset={0} className="font-mono text-xs">
          {column.nullable && (
            <>
              <SelectItem value={NULL_SENTINEL} className="h-7 font-mono text-xs text-muted-foreground">
                null
              </SelectItem>
              <SelectSeparator />
            </>
          )}
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value} className="h-7 font-mono text-xs">
              {item.label}
            </SelectItem>
          ))}
          {error && (
            <p role="alert" className="px-2 py-1 text-xs text-destructive">
              {error}
            </p>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}

export function CellEditor(props: Props) {
  const kind = editorKind(props.column);
  if (kind === "boolean" || kind === "enum") {
    return <InlineChoiceEditor {...props} kind={kind} />;
  }
  return <PopoverCellEditor {...props} kind={kind} />;
}

function PopoverCellEditor({
  anchor,
  column,
  value,
  foreignKey,
  referencedTable,
  connectionUrl,
  onClose,
  onSave,
  kind,
}: Props & { kind: EditorKind }) {
  const [draft, setDraft] = useState(() => initialDraft(value, kind));
  const [isNull, setIsNull] = useState(value === null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const temporal = TEMPORAL_TYPES.has(column.dataType);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const editor = textareaRef.current ?? inputRef.current;
      if (!editor) return;
      editor.focus();
      try {
        editor.select();
      } catch {
        // Native date/time controls can be focused but do not expose a text selection.
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (saving) return;
    setError(null);

    let nextValue: Cell;
    try {
      nextValue = isNull ? null : parseDraft(column, kind, draft);
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "Invalid value");
      return;
    }

    setSaving(true);
    try {
      await onSave(nextValue);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not update this cell");
      setSaving(false);
    }
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void save();
    }
  }

  const fkPicker =
    foreignKey?.columns.length === 1 &&
    Boolean(referencedTable) &&
    Boolean(connectionUrl) &&
    (kind === "text" || kind === "number");
  const multiline = kind === "json" || (kind === "text" && column.dataType === "text");
  const popupWidth = kind === "json"
    ? "w-[min(28rem,calc(100vw-1rem))]"
    : fkPicker || multiline || temporal
      ? "w-[min(24rem,calc(100vw-1rem))]"
      : "w-[min(18rem,calc(100vw-1rem))]";

  return (
    <Popover.Root
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <Popover.Portal>
        <Popover.Positioner
          anchor={anchor}
          side="bottom"
          sideOffset={5}
          align="start"
          collisionPadding={8}
          className="isolate z-60"
        >
          <Popover.Popup
            className={`origin-(--transform-origin) rounded-lg bg-popover p-2.5 text-popover-foreground shadow-2xl ring-1 ring-foreground/15 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 ${popupWidth}`}
          >
            <form onSubmit={save}>
              {isNull ? (
                <button
                  type="button"
                  onClick={() => setIsNull(false)}
                  className="flex h-16 w-full cursor-pointer items-center justify-center rounded-lg border border-dashed border-input bg-muted/20 font-mono text-xs text-muted-foreground transition-colors hover:border-foreground/25 hover:bg-muted/40 hover:text-foreground"
                >
                  NULL — click to enter a value
                </button>
              ) : kind === "json" ? (
                <Textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleEditorKeyDown}
                  spellCheck={false}
                  className="min-h-40 resize-y font-mono text-xs"
                />
              ) : kind === "text" && column.dataType === "text" ? (
                <Textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleEditorKeyDown}
                  className="min-h-24 resize-y font-mono text-xs"
                />
              ) : (
                <Input
                  ref={inputRef}
                  type="text"
                  value={draft}
                  inputMode={kind === "number" ? "decimal" : undefined}
                  onChange={(event) => setDraft(event.target.value)}
                  className="font-mono"
                />
              )}

              {fkPicker && !isNull && foreignKey && referencedTable && connectionUrl && (
                <FkPicker
                  connectionUrl={connectionUrl}
                  foreignKey={foreignKey}
                  referencedTable={referencedTable}
                  value={draft || value}
                  onSelect={(nextValue) => {
                    setIsNull(false);
                    setDraft(nextValue === null ? "" : String(nextValue));
                  }}
                />
              )}

              {temporal && !isNull && (
                <div className="mt-1.5 px-0.5">
                  <p className="text-xs text-muted-foreground">Formatted value:</p>
                  <p className="mt-0.5 truncate font-mono text-xs text-foreground/90">
                    {formattedTemporalValue(column.dataType, draft)}
                  </p>
                </div>
              )}

              {error && (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  {error}
                </p>
              )}

              <div className="mt-2 flex items-end gap-2">
                <div className="flex shrink-0 flex-col items-start gap-0.5">
                  <button
                    type="submit"
                    disabled={saving}
                    className="group flex h-7 cursor-pointer items-center gap-2 rounded-md pr-2 text-sm whitespace-nowrap text-muted-foreground outline-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50"
                  >
                    <kbd className="flex h-6 min-w-8 items-center justify-center rounded-md border bg-muted/40 px-1.5 font-mono text-[11px] text-foreground shadow-xs">
                      {saving ? <LoaderCircleIcon className="size-3 animate-spin" /> : "↵"}
                    </kbd>
                    Save changes
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={saving}
                    className="flex h-7 cursor-pointer items-center gap-2 rounded-md pr-2 text-sm whitespace-nowrap text-muted-foreground outline-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50"
                  >
                    <kbd className="flex h-6 min-w-8 items-center justify-center rounded-md border bg-muted/40 px-1.5 font-mono text-[10px] text-foreground shadow-xs">
                      Esc
                    </kbd>
                    Cancel changes
                  </button>
                </div>
                <div className="ml-auto flex flex-col items-stretch gap-1">
                  {temporal && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setIsNull(false);
                        setDraft(nowValue(column.dataType));
                      }}
                    >
                      Set to NOW
                    </Button>
                  )}
                  {column.nullable && !isNull && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsNull(true)}
                    >
                      Set to NULL
                    </Button>
                  )}
                </div>
              </div>
            </form>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
