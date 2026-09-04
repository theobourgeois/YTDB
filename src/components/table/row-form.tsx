"use client";

import { useState, type KeyboardEvent } from "react";
import { Popover } from "@base-ui/react/popover";
import { ClockIcon, KeyRoundIcon, SearchIcon, Undo2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  draftFromValue,
  editorKind,
  formattedTemporalValue,
  isChoiceKind,
  nowValue,
  parseDraft,
} from "@/lib/cell-values";
import {
  tableKey,
  type Cell,
  type ColumnInfo,
  type ForeignKey,
  type TableInfo,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { FkPicker } from "./fk-picker";
import { JsonField } from "./json-field";

/** How a column is filled in: a typed value, its database default, or NULL. */
export type FieldMode = "value" | "default" | "null";
export type Field = { mode: FieldMode; draft: string };
export type Fields = Record<string, Field>;

/** Generated and identity columns are always written by the database itself. */
export function isWritable(column: ColumnInfo): boolean {
  return !column.isGenerated && !column.isIdentity;
}

export function isRequired(column: ColumnInfo): boolean {
  return !column.nullable && !column.hasDefault;
}

/** A choice column has no empty state to show, so it starts on its first option. */
export function valueField(column: ColumnInfo): Field {
  const kind = editorKind(column);
  return {
    mode: "value",
    draft: isChoiceKind(kind) ? (choiceItems(kind, column)[0]?.value ?? "") : "",
  };
}

/** The starting state of a column on a blank insert form. */
export function initialField(column: ColumnInfo): Field {
  if (column.hasDefault) return { mode: "default", draft: "" };
  if (column.nullable) return { mode: "null", draft: "" };
  return valueField(column);
}

/**
 * The starting state of a column seeded from a row that already exists. A stored
 * NULL opens on the NULL chip rather than an empty input, so leaving the field
 * alone writes back what was there.
 */
export function fieldFromValue(column: ColumnInfo, value: Cell): Field {
  if (value === null) return { mode: "null", draft: "" };
  return { mode: "value", draft: draftFromValue(value, editorKind(column)) };
}

export function sameField(left: Field, right: Field): boolean {
  if (left.mode !== right.mode) return false;
  return left.mode !== "value" || left.draft === right.draft;
}

export function defaultLabel(column: ColumnInfo): string {
  if (column.isIdentity) return "generated identity value";
  return column.defaultExpression ?? "DEFAULT";
}

/** Ties each field's label, control, and validation focus together. */
export function fieldId(prefix: string, column: string): string {
  return `${prefix}-${column}`;
}

export type CollectedFields = {
  /** Columns given a literal value, ready to be sent as parameters. */
  values: Record<string, Cell>;
  /** Columns to reset to their database default. */
  defaults: string[];
  /** Per-column complaints; the caller stops when this is non-empty. */
  errors: Record<string, string>;
};

/**
 * Turns drafts into cell values, collecting every complaint rather than throwing
 * on the first, so the form can highlight all the bad fields at once.
 */
export function collectFields(columns: ColumnInfo[], fields: Fields): CollectedFields {
  const values: Record<string, Cell> = {};
  const defaults: string[] = [];
  const errors: Record<string, string> = {};

  for (const column of columns) {
    const field = fields[column.name];
    if (!field) continue;
    if (field.mode === "default") {
      defaults.push(column.name);
      continue;
    }
    if (field.mode === "null") {
      values[column.name] = null;
      continue;
    }
    const kind = editorKind(column);
    // Numbers and JSON have no empty form; only a nullable column can offer NULL instead.
    if (!field.draft.trim() && (kind === "number" || kind === "json")) {
      errors[column.name] = column.nullable
        ? "Enter a value or switch this column to NULL"
        : "Enter a value";
      continue;
    }
    try {
      values[column.name] = parseDraft(column, kind, field.draft);
    } catch (error) {
      errors[column.name] = error instanceof Error ? error.message : "Invalid value";
    }
  }

  return { values, defaults, errors };
}

export function FieldRow({
  column,
  field,
  idPrefix,
  error,
  autoFocus,
  disabled,
  dirty = false,
  foreignKey,
  referencedTable,
  connectionUrl,
  onDraftChange,
  onModeChange,
  onRevert,
  onSubmit,
}: {
  column: ColumnInfo;
  field: Field;
  idPrefix: string;
  error?: string;
  autoFocus: boolean;
  disabled: boolean;
  /** Marks the field as changed from the value the row started with. */
  dirty?: boolean;
  foreignKey?: ForeignKey;
  referencedTable?: TableInfo;
  connectionUrl: string;
  onDraftChange: (draft: string) => void;
  onModeChange: (mode: FieldMode) => void;
  /** Omitted on forms with nothing to revert to, which hides the control. */
  onRevert?: () => void;
  onSubmit?: () => void;
}) {
  const kind = editorKind(column);
  const temporal = TEMPORAL_TYPES.has(column.dataType);
  const required = isRequired(column);
  const id = fieldId(idPrefix, column.name);
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
    <div className={cn("group/field relative py-2.5", dirty && "-mx-4 px-4 bg-primary/[0.04]")}>
      {dirty && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-primary/50" />}
      <div className="flex items-center gap-1.5">
        {column.isPrimaryKey && (
          <KeyRoundIcon aria-label="Primary key" className="size-3 shrink-0 text-muted-foreground" />
        )}
        <label
          htmlFor={id}
          title={column.name}
          className={cn(
            "min-w-0 truncate font-mono text-xs",
            column.isPrimaryKey && "font-semibold",
          )}
        >
          {column.name}
        </label>
        <span
          title={
            column.defaultExpression
              ? `${column.type} · default ${column.defaultExpression}`
              : column.type
          }
          className="min-w-0 truncate text-[10px] text-muted-foreground/70"
        >
          {column.type}
        </span>
        {required && <span className="shrink-0 text-[10px] text-muted-foreground/70">required</span>}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {dirty && onRevert && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={disabled}
              title={`Revert ${column.name}`}
              aria-label={`Revert ${column.name}`}
              onClick={onRevert}
            >
              <Undo2Icon />
            </Button>
          )}
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
            id={id}
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
              id={id}
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
        ) : kind === "json" ? (
          <JsonField
            id={id}
            value={field.draft}
            disabled={disabled}
            invalid={Boolean(error)}
            autoFocus={autoFocus}
            onChange={onDraftChange}
            onSubmit={onSubmit}
          />
        ) : kind === "text" && column.dataType === "text" ? (
          <Textarea
            id={id}
            autoFocus={autoFocus}
            value={field.draft}
            disabled={disabled}
            aria-invalid={Boolean(error)}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={handleKeyDown}
            className="min-h-16 resize-y font-mono text-xs"
          />
        ) : (
          <Input
            id={id}
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
