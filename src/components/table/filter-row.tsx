"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@/components/ui/select";
import {
  isFilterComplete,
  OPERATOR_GROUPS,
  OPERATOR_LIST,
  OPERATORS,
  operatorHasValue,
} from "@/lib/filters";
import { cn } from "@/lib/utils";
import type { ColumnInfo, Filter, FilterOperator } from "@/lib/types";

type Step = "column" | "operator" | "value";

type Props = {
  filter: Filter;
  columns: ColumnInfo[];
  autoStart?: boolean;
  onChange: (filter: Filter) => void;
  onRemove: () => void;
  onSettled?: () => void;
};

export function FilterRow({
  filter,
  columns,
  autoStart = false,
  onChange,
  onRemove,
  onSettled,
}: Props) {
  const [step, setStep] = useState<Step | null>(() => {
    if (!autoStart) return null;
    return filter.column ? "operator" : "column";
  });
  const advancing = useRef(false);
  const columnInputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef<HTMLInputElement>(null);
  const columnNames = columns.map((column) => column.name);
  const selectedColumn = columns.find((column) => column.name === filter.column);
  const enumValues = Array.isArray(selectedColumn?.enumValues)
    ? selectedColumn.enumValues
    : [];
  const complete = isFilterComplete(filter);

  useEffect(() => {
    if (step === "column") columnInputRef.current?.focus();
    if (step === "value" && enumValues.length === 0) valueRef.current?.focus();
  }, [step, enumValues.length]);

  function advance(next: Step | null) {
    advancing.current = true;
    setStep(next);
  }

  function handleOpenChange(current: Step, nextOpen: boolean) {
    if (nextOpen) {
      setStep(current);
      return;
    }
    if (advancing.current) {
      advancing.current = false;
      return;
    }
    if (step === current) setStep(null);
  }

  function handleEscape(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    if (!autoStart && complete) return;
    event.preventDefault();
    event.stopPropagation();
    onRemove();
  }

  function settle() {
    setStep(null);
    onSettled?.();
  }

  return (
    <div
      data-filter-chip=""
      className={cn(
        "flex h-6 items-center overflow-hidden rounded-md border bg-muted/50 text-xs",
        !complete && "border-dashed",
      )}
      onKeyDownCapture={handleEscape}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {step === "column" ? (
        <Combobox
          items={columnNames}
          value={filter.column || null}
          open
          onOpenChange={(open) => handleOpenChange("column", open)}
          onValueChange={(column) => {
            onChange({ ...filter, column: column ?? "", value: "" });
            if (column) advance("operator");
          }}
        >
          <ComboboxInput
            inputRef={columnInputRef}
            placeholder="Column"
            showTrigger={false}
            className="h-6 min-h-6 w-40 border-0 bg-transparent shadow-none dark:bg-transparent"
          />
          <ComboboxContent>
            <ComboboxEmpty>No columns</ComboboxEmpty>
            <ComboboxList>
              {(column: string) => (
                <ComboboxItem key={column} value={column}>
                  {column}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      ) : (
        <button
          type="button"
          className="h-full px-1.5 font-mono hover:bg-foreground/5"
          onClick={() => setStep("column")}
        >
          {filter.column || "column"}
        </button>
      )}

      <Select
        items={OPERATOR_LIST}
        value={filter.operator}
        open={step === "operator"}
        onOpenChange={(open) => handleOpenChange("operator", open)}
        onValueChange={(operator) => {
          if (!operator) return;
          const next = operator as FilterOperator;
          onChange({ ...filter, operator: next });
          if (operatorHasValue(next)) {
            advance("value");
            onSettled?.();
          } else {
            settle();
          }
        }}
      >
        <SelectTrigger className="h-6 w-auto gap-0 rounded-none border-0 bg-transparent px-1.5 py-0 font-mono text-xs shadow-none hover:bg-foreground/5 dark:bg-transparent dark:hover:bg-foreground/5 data-[size=default]:h-6 [&_svg]:hidden">
          {OPERATORS[filter.operator].symbol}
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false} className="min-w-56">
          {OPERATOR_GROUPS.map((group) => (
            <SelectGroup key={group.id}>
              <SelectLabel className="px-2 pt-2 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                {group.label}
              </SelectLabel>
              {OPERATOR_LIST.filter((op) => op.group === group.id).map((op) => (
                <SelectItem key={op.value} value={op.value} className="pr-2 [&>span:last-of-type]:hidden">
                  <span className="flex-1">{op.label}</span>
                  <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center self-center rounded-md bg-muted px-1.5 font-mono text-[10px] leading-none text-muted-foreground">
                    {op.symbol}
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>

      {operatorHasValue(filter.operator) &&
        (enumValues.length ? (
          step === "value" ? (
            <Combobox
              items={enumValues}
              value={filter.value || null}
              open
              onOpenChange={(open) => handleOpenChange("value", open)}
              onValueChange={(value) => {
                onChange({ ...filter, value: value ?? "" });
                settle();
              }}
            >
              <ComboboxInput
                placeholder="Value"
                showTrigger={false}
                showClear={Boolean(filter.value)}
                className="h-6 min-h-6 w-40 border-0 bg-transparent font-mono shadow-none dark:bg-transparent"
              />
              <ComboboxContent>
                <ComboboxEmpty>No enum values</ComboboxEmpty>
                <ComboboxList>
                  {(value: string) => (
                    <ComboboxItem key={value} value={value}>
                      {value}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          ) : (
            <button
              type="button"
              className={cn(
                "h-full max-w-48 truncate px-1.5 font-mono hover:bg-foreground/5",
                !filter.value && "text-muted-foreground",
              )}
              onClick={() => setStep("value")}
            >
              {filter.value || "value"}
            </button>
          )
        ) : step === "value" ? (
          <input
            ref={valueRef}
            value={filter.value}
            onChange={(event) => onChange({ ...filter, value: event.target.value })}
            onBlur={() => settle()}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              settle();
            }}
            placeholder="value"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            className="h-6 min-w-16 bg-transparent px-1.5 font-mono outline-none placeholder:text-muted-foreground"
            style={{ width: `${Math.max(6, filter.value.length + 1)}ch` }}
          />
        ) : (
          <button
            type="button"
            className={cn(
              "h-full max-w-48 truncate px-1.5 font-mono hover:bg-foreground/5",
              !filter.value && "text-muted-foreground",
            )}
            onClick={() => setStep("value")}
          >
            {filter.value || "value"}
          </button>
        ))}

      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onRemove}
        aria-label="Remove filter"
        className="h-6 w-6 rounded-none border-l opacity-60 hover:opacity-100"
      >
        <XIcon />
      </Button>
    </div>
  );
}
