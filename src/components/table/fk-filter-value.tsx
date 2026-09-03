"use client";

import { useMemo, useState, type Ref } from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { useAsync } from "@/hooks/use-async";
import { useDebounced } from "@/hooks/use-debounced";
import { api } from "@/lib/api";
import { displayColumnName, relatedLabel } from "@/lib/foreign-keys";
import { tableKey, type ForeignKey, type TableInfo } from "@/lib/types";

/** A referenced row, or the typed text itself when it matches no row. */
type Option = { value: string; label: string; raw: boolean };

type Props = {
  connectionUrl: string;
  foreignKey: ForeignKey;
  referencedTable: TableInfo;
  keyColumn: string;
  value: string;
  inputRef?: Ref<HTMLInputElement>;
  onPick: (value: string, label: string | null) => void;
  onOpenChange: (open: boolean) => void;
};

export function FkFilterValue({
  connectionUrl,
  foreignKey,
  referencedTable,
  keyColumn,
  value,
  inputRef,
  onPick,
  onOpenChange,
}: Props) {
  const [query, setQuery] = useState("");
  const search = useDebounced(query, 200);
  const displayColumn = displayColumnName(referencedTable.columns, foreignKey.referencedColumns);

  const rows = useAsync(
    `${connectionUrl}:${tableKey(referencedTable)}:${search}`,
    (signal) =>
      api.lookup(connectionUrl, { table: foreignKey.referencedTable, search, limit: 30 }, signal),
  );

  const options = useMemo(() => {
    const list: Option[] = [];
    const data = rows.data;
    const keyIndex = data ? data.columns.indexOf(keyColumn) : -1;
    if (data && keyIndex >= 0) {
      for (const row of data.rows) {
        const key = row[keyIndex];
        if (key === null || key === undefined) continue;
        const text = String(key);
        list.push({ value: text, label: relatedLabel(data.columns, row, displayColumn) ?? text, raw: false });
      }
    }
    // Escape hatch: dangling keys and deleted rows must stay filterable.
    const typed = query.trim();
    if (typed && !list.some((option) => option.value === typed)) {
      list.push({ value: typed, label: typed, raw: true });
    }
    return list;
  }, [displayColumn, keyColumn, query, rows.data]);

  const selected = options.find((option) => option.value === value) ?? null;

  return (
    <Combobox<Option>
      items={options}
      filter={null}
      open
      value={selected}
      inputValue={query}
      onInputValueChange={(next) => setQuery(next)}
      itemToStringLabel={(option) => option.label}
      itemToStringValue={(option) => option.value}
      isItemEqualToValue={(option, current) => option.value === current.value}
      onOpenChange={onOpenChange}
      onValueChange={(option) => {
        if (!option) return;
        onPick(option.value, option.raw || option.label === option.value ? null : option.label);
      }}
    >
      <ComboboxInput
        inputRef={inputRef}
        placeholder={`Search ${referencedTable.name}`}
        showTrigger={false}
        className="h-6 min-h-6 w-52 border-0 bg-transparent font-mono shadow-none dark:bg-transparent"
      />
      <ComboboxContent className="min-w-72">
        {rows.error ? (
          <p className="px-2.5 py-2 text-xs text-destructive">{rows.error}</p>
        ) : rows.loading && !rows.data ? (
          <p className="px-2.5 py-2 text-xs text-muted-foreground">Searching…</p>
        ) : null}
        <ComboboxEmpty>No matching rows</ComboboxEmpty>
        <ComboboxList>
          {(option: Option) => (
            <ComboboxItem
              key={`${option.raw ? "raw" : "row"}:${option.value}`}
              value={option}
              className="font-mono text-xs"
            >
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.raw ? (
                <span className="shrink-0 text-muted-foreground">use raw value</span>
              ) : option.label !== option.value ? (
                <span className="max-w-[45%] shrink-0 truncate text-muted-foreground">
                  {option.value}
                </span>
              ) : null}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
