"use client";

import { useMemo, useState, type FormEvent } from "react";
import { LoaderCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { findTable, foreignKeyForColumn } from "@/lib/foreign-keys";
import { tableKey, type Cell, type RowInsertResult, type TableInfo } from "@/lib/types";
import {
  FieldRow,
  collectFields,
  fieldId,
  initialField,
  isRequired,
  isWritable,
  valueField,
  type Field,
  type FieldMode,
  type Fields,
} from "./row-form";

const ID_PREFIX = "insert";

type Props = {
  open: boolean;
  table: TableInfo;
  tables: TableInfo[];
  connectionUrl: string;
  onOpenChange: (open: boolean) => void;
  onInsert: (values: Record<string, Cell>) => Promise<RowInsertResult>;
};

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
  const [fields, setFields] = useState<Fields>(() =>
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

  function setMode(column: string, mode: FieldMode) {
    const info = columns.find((item) => item.name === column);
    if (mode === "value" && info) {
      updateField(column, fields[column]?.draft ? { mode } : valueField(info));
      // The dashed placeholder unmounts and a real control takes its place, so
      // autoFocus can land on it.
      setFocusColumn(column);
      return;
    }
    updateField(column, { mode });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;

    // An insert omits DEFAULT columns entirely rather than assigning to them.
    const { values, errors } = collectFields(columns, fields);
    setFieldErrors(errors);
    const firstInvalid = columns.find((column) => errors[column.name]);
    if (firstInvalid) {
      setError("Some values could not be used. Check the highlighted fields.");
      // The offending control is already mounted, so autoFocus cannot reach it.
      document.getElementById(fieldId(ID_PREFIX, firstInvalid.name))?.focus();
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
            const relation = foreignKeyForColumn(table, column.name);
            return (
              <FieldRow
                key={column.name}
                column={column}
                field={fields[column.name] ?? initialField(column)}
                idPrefix={ID_PREFIX}
                error={fieldErrors[column.name]}
                autoFocus={focusColumn === column.name}
                disabled={saving}
                foreignKey={relation}
                referencedTable={
                  relation ? findTable(tables, relation.referencedTable) : undefined
                }
                connectionUrl={connectionUrl}
                onDraftChange={(draft) => updateField(column.name, { mode: "value", draft })}
                onModeChange={(mode) => setMode(column.name, mode)}
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
