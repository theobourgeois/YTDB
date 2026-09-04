"use client";

import { useMemo, useState, type FormEvent } from "react";
import { LoaderCircleIcon, PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { findTable, foreignKeyForColumn } from "@/lib/foreign-keys";
import {
  tableKey,
  type Cell,
  type RowUpdate,
  type RowUpdateResult,
  type TableInfo,
} from "@/lib/types";
import {
  FieldRow,
  collectFields,
  fieldFromValue,
  fieldId,
  isWritable,
  sameField,
  valueField,
  type Field,
  type FieldMode,
  type Fields,
} from "./row-form";

const ID_PREFIX = "edit";

export type RowEditTarget = {
  /** Identifies which row is open, so reopening a different one reseeds the form. */
  rowIndex: number;
  row: Cell[];
  /** The grid's column order, which the row array is indexed by. */
  columns: string[];
};

type Props = {
  target: RowEditTarget | null;
  table: TableInfo;
  tables: TableInfo[];
  connectionUrl: string;
  onOpenChange: (open: boolean) => void;
  onUpdate: (update: Omit<RowUpdate, "table">) => Promise<RowUpdateResult>;
};

export function RowEditPanel({ target, ...props }: Props) {
  const [saving, setSaving] = useState(false);

  return (
    <Sheet
      open={target !== null}
      onOpenChange={(open) => {
        // An update in flight owns the panel until it succeeds or reports an error.
        if (!open && saving) return;
        props.onOpenChange(open);
      }}
    >
      <SheetContent showCloseButton={!saving} className="sm:max-w-lg">
        {target && (
          <EditForm
            key={`${target.rowIndex}:${JSON.stringify(target.row)}`}
            target={target}
            {...props}
            onSavingChange={setSaving}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function EditForm({
  target,
  table,
  tables,
  connectionUrl,
  onOpenChange,
  onUpdate,
  onSavingChange,
}: Props & { target: RowEditTarget; onSavingChange: (saving: boolean) => void }) {
  const columns = useMemo(() => table.columns.filter(isWritable), [table.columns]);

  /** What the row held when the panel opened; every dirty check compares to this. */
  const initial = useMemo<Fields>(() => {
    const index = new Map(target.columns.map((name, position) => [name, position]));
    return Object.fromEntries(
      columns.map((column) => {
        const position = index.get(column.name);
        const value = position === undefined ? null : (target.row[position] ?? null);
        return [column.name, fieldFromValue(column, value)];
      }),
    );
  }, [columns, target]);

  const [fields, setFields] = useState<Fields>(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [focusColumn, setFocusColumn] = useState<string | null>(null);

  const dirtyColumns = useMemo(
    () =>
      columns.filter((column) => {
        const before = initial[column.name];
        const after = fields[column.name];
        return before && after && !sameField(before, after);
      }),
    [columns, initial, fields],
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

  function setMode(column: string, mode: FieldMode) {
    const info = columns.find((item) => item.name === column);
    if (mode === "value" && info) {
      // Switching back to a value re-offers what the row started with, when it had one.
      const seed = initial[column]?.mode === "value" ? initial[column] : valueField(info);
      updateField(column, fields[column]?.draft ? { mode } : seed);
      setFocusColumn(column);
      return;
    }
    updateField(column, { mode });
  }

  function revert(column: string) {
    const before = initial[column];
    if (!before) return;
    updateField(column, before);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || dirtyColumns.length === 0) return;

    // Only changed columns are sent, so an untouched now() default is not rewritten.
    const { values, defaults, errors } = collectFields(dirtyColumns, fields);
    setFieldErrors(errors);
    const firstInvalid = dirtyColumns.find((column) => errors[column.name]);
    if (firstInvalid) {
      setError("Some values could not be used. Check the highlighted fields.");
      // The offending control is already mounted, so autoFocus cannot reach it.
      document.getElementById(fieldId(ID_PREFIX, firstInvalid.name))?.focus();
      return;
    }

    const primaryKey = Object.fromEntries(
      table.columns.flatMap((column) => {
        if (!column.isPrimaryKey) return [];
        const position = target.columns.indexOf(column.name);
        if (position < 0) throw new Error("The row primary key is incomplete");
        // The key that identifies the row is the one it had, never the edited draft.
        return [[column.name, target.row[position] ?? null]];
      }),
    );

    setError(null);
    markSaving(true);
    try {
      await onUpdate({ primaryKey, values, defaults });
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Could not update this row");
    } finally {
      markSaving(false);
    }
  }

  const changeCount = dirtyColumns.length;

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <PencilIcon className="size-3.5 shrink-0 text-muted-foreground" />
          Edit row
        </SheetTitle>
        <SheetDescription className="text-xs">
          <span className="font-mono">{tableKey(table)}</span>
          {skipped > 0 && (
            <>
              {" · "}
              {skipped} generated {skipped === 1 ? "column" : "columns"} omitted
            </>
          )}
        </SheetDescription>
      </SheetHeader>

      <div className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto px-4">
        {columns.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Every column in this table is written by the database.
          </p>
        ) : (
          columns.map((column) => {
            const relation = foreignKeyForColumn(table, column.name);
            return (
              <FieldRow
                key={column.name}
                column={column}
                field={fields[column.name] ?? valueField(column)}
                idPrefix={ID_PREFIX}
                error={fieldErrors[column.name]}
                autoFocus={focusColumn === column.name}
                disabled={saving}
                dirty={dirtyColumns.includes(column)}
                foreignKey={relation}
                referencedTable={
                  relation ? findTable(tables, relation.referencedTable) : undefined
                }
                connectionUrl={connectionUrl}
                onDraftChange={(draft) => updateField(column.name, { mode: "value", draft })}
                onModeChange={(mode) => setMode(column.name, mode)}
                onRevert={() => revert(column.name)}
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

      <SheetFooter>
        <span className="mr-auto truncate text-xs text-muted-foreground">
          {changeCount === 0
            ? "No changes"
            : `${changeCount} ${changeCount === 1 ? "column" : "columns"} changed`}
        </span>
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={saving || changeCount === 0}>
          {saving && <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />}
          {saving ? "Saving…" : changeCount === 0 ? "Save" : `Save ${changeCount}`}
        </Button>
      </SheetFooter>
    </form>
  );
}
