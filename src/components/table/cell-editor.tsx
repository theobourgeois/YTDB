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
import {
  NULL_SENTINEL,
  TEMPORAL_TYPES,
  choiceDraft,
  choiceItems,
  editorKind,
  formattedTemporalValue,
  isChoiceKind,
  nowValue,
  parseChoice,
  parseDraft,
  type ChoiceKind,
  type EditorKind,
} from "@/lib/cell-values";
import type { Cell, ColumnInfo, ForeignKey, TableInfo } from "@/lib/types";
import { FkPicker } from "./fk-picker";

type Props = {
  anchor: HTMLElement;
  column: ColumnInfo;
  value: Cell;
  foreignKey?: ForeignKey;
  referencedTable?: TableInfo;
  connectionUrl?: string;
  /**
   * Stacking layer for the popover editor. "peek" lifts it above the row peek
   * (z-60) that renders it, while staying under select popups (z-80).
   */
  layer?: "grid" | "peek";
  onClose: () => void;
  onSave: (value: Cell) => Promise<void>;
};

export function isInlineChoiceEditor(column: ColumnInfo): boolean {
  return isChoiceKind(editorKind(column));
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
  if (isChoiceKind(kind)) {
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
  layer = "grid",
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
          className={layer === "peek" ? "isolate z-70" : "isolate z-60"}
        >
          <Popover.Popup
            data-cell-editor
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
