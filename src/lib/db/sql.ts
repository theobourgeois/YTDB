import "server-only";
import { quoteIdent, quoteTable } from "../identifiers";
import type { Filter, FilterOperator } from "../types";

export { quoteIdent, quoteTable };

export function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

const SEARCHABLE_TYPES = new Set(["text", "varchar", "bpchar", "citext", "name", "uuid"]);

/** Types that can be searched with ILIKE without casting json/bytea/numerics. */
export function isSearchableType(dataType: string, typeCategory: string): boolean {
  return typeCategory === "S" || SEARCHABLE_TYPES.has(dataType);
}

const COMPARISONS: Record<Extract<FilterOperator, "eq" | "neq" | "gt" | "gte" | "lt" | "lte">, string> = {
  eq: "=",
  neq: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
};

type WhereClause = {
  sql: string;
  params: string[];
};

/** Builds a parameterised WHERE clause. Column names must already be validated. */
export function buildWhere(filters: Filter[]): WhereClause {
  const params: string[] = [];
  const parts = filters.map((filter) => {
    const column = quoteIdent(filter.column);
    switch (filter.operator) {
      case "is_null":
        return `${column} IS NULL`;
      case "is_not_null":
        return `${column} IS NOT NULL`;
      case "like":
      case "ilike":
        params.push(filter.value);
        return `${column}::text ${filter.operator.toUpperCase()} $${params.length}`;
      case "eq":
      case "neq":
      case "gt":
      case "gte":
      case "lt":
      case "lte":
        params.push(filter.value);
        return `${column} ${COMPARISONS[filter.operator]} $${params.length}`;
      default: {
        const _exhaustive: never = filter.operator;
        return _exhaustive;
      }
    }
  });
  return {
    sql: parts.length ? `WHERE ${parts.join(" AND ")}` : "",
    params,
  };
}
