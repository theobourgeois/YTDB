import { fetchRows } from "@/lib/db/rows";
import type { RowsQuery } from "@/lib/types";
import { jsonHandler, requireString } from "../_lib";

type Body = { connectionUrl?: string; query?: RowsQuery };

export const POST = jsonHandler<Body>("rows", async (body) => {
  const url = requireString(body.connectionUrl, "connectionUrl");
  if (!body.query?.table) throw new Error("Missing query");
  return fetchRows(url, body.query);
});
