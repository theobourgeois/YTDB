import type { Cell, ColumnInfo } from "./types";

/** How a column's value is entered: shared by the cell editor and the insert form. */
export type EditorKind = "boolean" | "date" | "enum" | "json" | "number" | "text" | "time";
export type ChoiceKind = "boolean" | "enum";

export const INTEGER_TYPES = new Set(["int2", "int4", "int8", "oid"]);
export const NUMBER_TYPES = new Set(["decimal", "float4", "float8", "numeric"]);
export const TEMPORAL_TYPES = new Set(["date", "time", "timestamp", "timestamptz", "timetz"]);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Stands in for NULL in the choice editors, where "" is not selectable. */
export const NULL_SENTINEL = "__null__";

export function editorKind(column: ColumnInfo): EditorKind {
  if (Array.isArray(column.enumValues) && column.enumValues.length > 0) return "enum";
  if (column.dataType === "bool") return "boolean";
  if (column.dataType === "date" || column.dataType === "timestamp") return "date";
  if (column.dataType === "time") return "time";
  if (column.dataType === "json" || column.dataType === "jsonb") return "json";
  if (INTEGER_TYPES.has(column.dataType) || NUMBER_TYPES.has(column.dataType)) return "number";
  return "text";
}

export function isChoiceKind(kind: EditorKind): kind is ChoiceKind {
  return kind === "boolean" || kind === "enum";
}

export function parseDraft(column: ColumnInfo, kind: EditorKind, draft: string): Cell {
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

/**
 * The editable text for an existing value. JSON is pretty-printed so a stored
 * one-liner is readable, and `date` swaps the space Postgres returns for the
 * `T` that datetime inputs require.
 */
export function draftFromValue(value: Cell, kind: EditorKind): string {
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

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

export function nowValue(dataType: string): string {
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

export function formattedTemporalValue(dataType: string, draft: string): string {
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

export function choiceItems(kind: ChoiceKind, column: ColumnInfo): { value: string; label: string }[] {
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

export function choiceDraft(value: Cell): string {
  if (value === null) return NULL_SENTINEL;
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export function parseChoice(kind: ChoiceKind, column: ColumnInfo, draft: string): Cell {
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
