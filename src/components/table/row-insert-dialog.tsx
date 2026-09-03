"use client";

import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { Popover } from "@base-ui/react/popover";
import { ClockIcon, KeyRoundIcon, LoaderCircleIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  TEMPORAL_TYPES,
  choiceItems,
  editorKind,
  formattedTemporalValue,
  isChoiceKind,
  nowValue,
  parseDraft,
  type EditorKind,
} from "@/lib/cell-values";
import { findTable, foreignKeyForColumn } from "@/lib/foreign-keys";
import {
  tableKey,
  type Cell,
  type ColumnInfo,
  type ForeignKey,
  type RowInsertResult,
  type TableInfo,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { FkPicker } from "./fk-picker";

/** How a column is filled in: a typed value, its database default, or NULL. */
type FieldMode = "value" | "default" | "null";
type Field = { mode: FieldMode; draft: string };

type Props = {
  open: boolean;
  table: TableInfo;
  tables: TableInfo[];
  connectionUrl: string;
  onOpenChange: (open: boolean) => void;
  onInsert: (values: Record<string, Cell>) => Promise<RowInsertResult>;
};

/** Generated and identity columns are always written by the database itself. */
function isWritable(column: ColumnInfo): boolean {
  return !column.isGenerated && !column.isIdentity;
}

function isRequired(column: ColumnInfo): boolean {
  return !column.nullable && !column.hasDefault;
}

/** A choice column has no empty state to show, so it starts on its first option. */
function valueField(column: ColumnInfo): Field {
  const kind = editorKind(column);
  return {
    mode: "value",
    draft: isChoiceKind(kind) ? (choiceItems(kind, column)[0]?.value ?? "") : "",
  };
}

function initialField(column: ColumnInfo): Field {
  if (column.hasDefault) return { mode: "default", draft: "" };
  if (column.nullable) return { mode: "null", draft: "" };
  return valueField(column);
}

/** Ties each field's label, control, and validation focus together. */
function fieldId(column: string): string {
  return `insert-${column}`;
}

function defaultLabel(column: ColumnInfo): string {
  if (column.isIdentity) return "generated identity value";
  return column.defaultExpression ?? "DEFAULT";
}

export function RowInsertDialog(props: Props) {
  // The form keeps its state until the dialog is opened again, so it survives the
  // close animation instead of blanking out mid-flight.
  const [session, setSession] = useState({ open: props.open, id: 0 });
  const [saving, setSaving] = useState(false);
  if (session.open !== props.open) {
    setSession({ open: props.open, id: props.open ? session.id + 1 : session.id });
    setSaving(false);
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        // An insert in flight owns the dialog until it succeeds or reports an error.
        if (!open && saving) return;
        props.onOpenChange(open);
      }}
    >
      <DialogContent
        showCloseButton={!saving}
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        <InsertForm key={session.id} {...props} onSavingChange={setSaving} />
      </DialogContent>
    </Dialog>
  );
}

function InsertForm({
  table,
  tables,
  connectionUrl,
  onOpenChange,
  onInsert,
  onSavingChange,
}: Props & { onSavingChange: (saving: boolean) => void }) {
  const columns = useMemo(() => table.columns.filter(isWritable), [table.columns]);
  const [fields, setFields] = useState<Record<string, Field>>(() =>
    Object.fromEntries(columns.map((column) => [column.name, initialField(column)])),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [focusColumn, setFocusColumn] = useState<string | null>(
    () => columns.find((column) => isRequired(column))?.name ?? null,
  );

  const skipped = table.columns.length - columns.length;

  function markSaving(next: boolean) {
    setSaving(next);
    onSavingChange(next);
  }

  function updateField(column: string, patch: Partial<Field>) {
    setFields((current) => ({
      ...current,
      [column]: { ...(current[column] ?? { mode: "value", draft: "" }), ...patch },
    }));
    // Any edit invalidates the last attempt's summary and this field's own complaint.
    setError(null);
    setFieldErrors((current) => {
      if (!(column in current)) return current;
      const next = { ...current };
      delete next[column];
      return next;
    });
  }

  function setMode(column: ColumnInfo, mode: FieldMode) {
    if (mode === "value") {
      updateField(column.name, fields[column.name]?.draft ? { mode } : valueField(column));
      setFocusColumn(column.name);
      return;
    }
    updateField(column.name, { mode });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;

    const values: Record<string, Cell> = {};
    const nextErrors: Record<string, string> = {};
    for (const column of columns) {
      const field = fields[column.name] ?? initialField(column);
      if (field.mode === "default") continue;
      if (field.mode === "null") {
        values[column.name] = null;
        continue;
      }
      const kind = editorKind(column);
      // Numbers and JSON have no empty form; only a nullable column can offer NULL instead.
      if (!field.draft.trim() && (kind === "number" || kind === "json")) {
        nextErrors[column.name] = column.nullable
          ? "Enter a value or switch this column to NULL"
          : "Enter a value";
        continue;
      }
      try {
        values[column.name] = parseDraft(column, kind, field.draft);
      } catch (validationError) {
        nextErrors[column.name] =
          validationError instanceof Error ? validationError.message : "Invalid value";
      }
    }

    setFieldErrors(nextErrors);
    const firstInvalid = columns.find((column) => nextErrors[column.name]);
    if (firstInvalid) {
      setError("Some values could not be used. Check the highlighted fields.");
      // The offending control is already mounted, so autoFocus cannot reach it.
      document.getElementById(fieldId(firstInvalid.name))?.focus();
      return;
    }

    setError(null);
    markSaving(true);
    try {
      await onInsert(values);
    } catch (insertError) {
      setError(insertError instanceof Error ? insertError.message : "Could not insert this row");
    } finally {
      markSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <DialogHeader className="shrink-0 gap-1.5 p-4 pr-10">
        <DialogTitle>Insert row</DialogTitle>
        <DialogDescription className="text-xs">
          <span className="font-mono">{tableKey(table)}</span>
          {skipped > 0 && (
            <>
              {" · "}
              {skipped} generated {skipped === 1 ? "column" : "columns"} omitted
            </>
          )}
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto border-t px-4">
        {columns.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Every column is filled in by the database. Insert to add a row of defaults.
          </p>
        ) : (
          columns.map((column) => {
            const field = fields[column.name] ?? initialField(column);
            const kind = editorKind(column);
            const relation = foreignKeyForColumn(table, column.name);
            return (
              <FieldRow
                key={column.name}
                column={column}
                field={field}
                kind={kind}
                error={fieldErrors[column.name]}
                autoFocus={focusColumn === column.name}
                disabled={saving}
                foreignKey={relation}
                referencedTable={
                  relation ? findTable(tables, relation.referencedTable) : undefined
                }
                connectionUrl={connectionUrl}
                onDraftChange={(draft) => updateField(column.name, { mode: "value", draft })}
                onModeChange={(mode) => setMode(column, mode)}
              />
            );
          })
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="shrink-0 border-t bg-destructive/5 px-4 py-2.5 font-mono text-xs text-destructive"
        >
          {error}
        </p>
      )}

      <DialogFooter className="mx-0 mb-0 shrink-0">
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />}
          {saving ? "Inserting…" : "Insert row"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function FieldRow({
  column,
  field,
  kind,
  error,
  autoFocus,
  disabled,
  foreignKey,
  referencedTable,
  connectionUrl,
  onDraftChange,
  onModeChange,
}: {
  column: ColumnInfo;
  field: Field;
  kind: EditorKind;
  error?: string;
  autoFocus: boolean;
  disabled: boolean;
  foreignKey?: ForeignKey;
  referencedTable?: TableInfo;
  connectionUrl: string;
  onDraftChange: (draft: string) => void;
  onModeChange: (mode: FieldMode) => void;
}) {
  const temporal = TEMPORAL_TYPES.has(column.dataType);
  const required = isRequired(column);
  const pickable =
    foreignKey?.columns.length === 1 &&
    Boolean(referencedTable) &&
    (kind === "text" || kind === "number");

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter is a newline in a textarea, so the form needs the usual escape hatch.
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <div className="py-2.5">
      <div className="flex items-center gap-1.5">
        {column.isPrimaryKey && (
          <KeyRoundIcon aria-label="Primary key" className="size-3 shrink-0 text-muted-foreground" />
        )}
        <label
          htmlFor={fieldId(column.name)}
          title={column.name}
          className={cn(
            "min-w-0 truncate font-mono text-xs",
            column.isPrimaryKey && "font-semibold",
          )}
        >
          {column.name}
        </label>
        <span title={column.type} className="min-w-0 truncate text-[10px] text-muted-foreground/70">
          {column.type}
        </span>
        {required && <span className="shrink-0 text-[10px] text-muted-foreground/70">required</span>}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {pickable && foreignKey && referencedTable && (
            <FkFieldPicker
              column={column}
              foreignKey={foreignKey}
              referencedTable={referencedTable}
              connectionUrl={connectionUrl}
              value={field.mode === "value" ? field.draft : ""}
              disabled={disabled}
              onSelect={(value) => onDraftChange(value === null ? "" : String(value))}
            />
          )}
          {temporal && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={disabled}
              title={`Set ${column.name} to the current time`}
              onClick={() => onDraftChange(nowValue(column.dataType))}
            >
              <ClockIcon data-icon="inline-start" />
              Now
            </Button>
          )}
          {column.hasDefault && (
            <FieldChip
              active={field.mode === "default"}
              disabled={disabled}
              onClick={() => onModeChange(field.mode === "default" ? "value" : "default")}
            >
              Default
            </FieldChip>
          )}
          {column.nullable && (
            <FieldChip
              active={field.mode === "null"}
              disabled={disabled}
              onClick={() => onModeChange(field.mode === "null" ? "value" : "null")}
            >
              Null
            </FieldChip>
          )}
        </div>
      </div>

      <div className="mt-1.5">
        {field.mode !== "value" ? (
          <button
            type="button"
            id={fieldId(column.name)}
            disabled={disabled}
            onClick={() => onModeChange("value")}
            className="group flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg border border-dashed border-input bg-muted/20 px-2.5 text-left font-mono text-xs text-muted-foreground transition-colors hover:border-foreground/25 hover:bg-muted/40 hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
          >
            <span className="min-w-0 flex-1 truncate">
              {field.mode === "null" ? "NULL" : defaultLabel(column)}
            </span>
            <span className="shrink-0 text-[10px] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              set a value
            </span>
          </button>
        ) : isChoiceKind(kind) ? (
          <Select
            items={Object.fromEntries(
              choiceItems(kind, column).map((item) => [item.value, item.label] as const),
            )}
            value={field.draft}
            disabled={disabled}
            onValueChange={(value) => value && onDraftChange(String(value))}
          >
            <SelectTrigger
              id={fieldId(column.name)}
              aria-invalid={Boolean(error)}
              className="w-full font-mono text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start" className="font-mono text-xs">
              {choiceItems(kind, column).map((item) => (
                <SelectItem key={item.value} value={item.value} className="h-7 font-mono text-xs">
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : kind === "json" || (kind === "text" && column.dataType === "text") ? (
          <Textarea
            id={fieldId(column.name)}
            autoFocus={autoFocus}
            value={field.draft}
            disabled={disabled}
            spellCheck={kind !== "json"}
            aria-invalid={Boolean(error)}
            placeholder={kind === "json" ? "{ }" : undefined}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={handleKeyDown}
            className={cn("resize-y font-mono text-xs", kind === "json" ? "min-h-20" : "min-h-16")}
          />
        ) : (
          <Input
            id={fieldId(column.name)}
            type="text"
            autoFocus={autoFocus}
            value={field.draft}
            disabled={disabled}
            inputMode={kind === "number" ? "decimal" : undefined}
            aria-invalid={Boolean(error)}
            onChange={(event) => onDraftChange(event.target.value)}
            className="font-mono text-xs"
          />
        )}
      </div>

      {temporal && field.mode === "value" && field.draft && (
        <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
          {formattedTemporalValue(column.dataType, field.draft)}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function FieldChip({
  active = false,
  disabled,
  onClick,
  children,
}: {
  active?: boolean;
  disabled: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-5 cursor-pointer items-center rounded-md border px-1.5 text-[10px] font-medium tracking-wide uppercase transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50",
        active
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function FkFieldPicker({
  column,
  foreignKey,
  referencedTable,
  connectionUrl,
  value,
  disabled,
  onSelect,
}: {
  column: ColumnInfo;
  foreignKey: ForeignKey;
  referencedTable: TableInfo;
  connectionUrl: string;
  value: string;
  disabled: boolean;
  onSelect: (value: Cell) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = `Pick ${column.name} from ${tableKey(foreignKey.referencedTable)}`;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={<Button type="button" variant="ghost" size="xs" disabled={disabled} />}
        aria-label={label}
        title={label}
      >
        <SearchIcon data-icon="inline-start" />
        Pick
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="end"
          sideOffset={4}
          collisionPadding={8}
          className="isolate z-60"
        >
          <Popover.Popup className="w-[min(22rem,calc(100vw-1rem))] origin-(--transform-origin) rounded-lg bg-popover p-2 text-popover-foreground shadow-2xl ring-1 ring-foreground/15 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95">
            <FkPicker
              connectionUrl={connectionUrl}
              foreignKey={foreignKey}
              referencedTable={referencedTable}
              value={value}
              onSelect={(next) => {
                onSelect(next);
                setOpen(false);
              }}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
