import { searchLookup } from "@/lib/db/related";
import { jsonHandler, requireString, requireTable } from "../_lib";

type Body = { connectionUrl?: string; query?: { table?: unknown; search?: unknown; limit?: unknown } };

export const POST = jsonHandler<Body>("lookup", async (body) => {
  const url = requireString(body.connectionUrl, "connectionUrl");
  if (!body.query) throw new Error("Missing query");
  const search = body.query.search;
  if (typeof search !== "string") throw new Error("Missing search");
  const limit = body.query.limit;
  if (limit !== undefined && (typeof limit !== "number" || !Number.isFinite(limit))) {
    throw new Error("Invalid limit");
  }
  return searchLookup(url, {
    table: requireTable(body.query.table),
    search,
    limit,
  });
});
