import { fetchRelated } from "@/lib/db/related";
import type { Cell, RelatedLookup } from "@/lib/types";
import { jsonHandler, requireString, requireTable } from "../_lib";

type Body = { connectionUrl?: string; lookups?: unknown };

function isCell(value: unknown): value is Cell {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function parseLookups(value: unknown): RelatedLookup[] {
  if (!Array.isArray(value)) throw new Error("Missing lookups");
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Invalid lookup");
    const lookup = item as { table?: unknown; keyColumns?: unknown; keys?: unknown };
    const keyColumns = lookup.keyColumns;
    if (!Array.isArray(keyColumns) || keyColumns.length === 0) {
      throw new Error("Missing lookup key columns");
    }
    if (keyColumns.some((column) => typeof column !== "string" || column.length === 0)) {
      throw new Error("Invalid lookup key column");
    }
    if (!Array.isArray(lookup.keys)) throw new Error("Missing lookup keys");
    return {
      table: requireTable(lookup.table, "lookup.table"),
      keyColumns: keyColumns as string[],
      keys: lookup.keys.map((key) => {
        if (!Array.isArray(key)) throw new Error("Invalid lookup key");
        if (key.some((cell) => !isCell(cell))) throw new Error("Unsupported lookup key value");
        return key as Cell[];
      }),
    };
  });
}

export const POST = jsonHandler<Body>(async (body) => {
  const url = requireString(body.connectionUrl, "connectionUrl");
  return fetchRelated(url, parseLookups(body.lookups));
});
