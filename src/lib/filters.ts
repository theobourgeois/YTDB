import type { Filter, FilterOperator } from "./types";
import { randomId } from "./utils";

export type OperatorGroup = "comparison" | "pattern" | "null";

type OperatorDef = {
  label: string;
  symbol: string;
  hasValue: boolean;
  group: OperatorGroup;
};

export const OPERATORS: Record<FilterOperator, OperatorDef> = {
  eq: { label: "Equals", symbol: "=", hasValue: true, group: "comparison" },
  neq: { label: "Not equal", symbol: "<>", hasValue: true, group: "comparison" },
  gt: { label: "Greater than", symbol: ">", hasValue: true, group: "comparison" },
  gte: { label: "Greater or equal", symbol: ">=", hasValue: true, group: "comparison" },
  lt: { label: "Less than", symbol: "<", hasValue: true, group: "comparison" },
  lte: { label: "Less or equal", symbol: "<=", hasValue: true, group: "comparison" },
  like: { label: "Like", symbol: "~~", hasValue: true, group: "pattern" },
  ilike: { label: "iLike", symbol: "~~*", hasValue: true, group: "pattern" },
  is_null: { label: "Is null", symbol: "IS NULL", hasValue: false, group: "null" },
  is_not_null: { label: "Is not null", symbol: "IS NOT NULL", hasValue: false, group: "null" },
};

export const OPERATOR_GROUPS: { id: OperatorGroup; label: string }[] = [
  { id: "comparison", label: "Comparison" },
  { id: "pattern", label: "Pattern matching" },
  { id: "null", label: "Null" },
];

export const OPERATOR_LIST = (Object.keys(OPERATORS) as FilterOperator[]).map((value) => ({
  value,
  label: OPERATORS[value].label,
  symbol: OPERATORS[value].symbol,
  group: OPERATORS[value].group,
}));

export function operatorHasValue(operator: FilterOperator): boolean {
  return OPERATORS[operator].hasValue;
}

/** A filter is applied to the query only once it is fully specified. */
export function isFilterComplete(filter: Filter): boolean {
  if (!filter.column) return false;
  if (!operatorHasValue(filter.operator)) return true;
  return filter.value.length > 0;
}

export function newFilter(column = ""): Filter {
  return { id: randomId(), column, operator: "eq", value: "" };
}
