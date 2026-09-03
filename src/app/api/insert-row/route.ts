import { insertRow } from "@/lib/db/insert-row";
import type { RowInsert } from "@/lib/types";
import { jsonHandler, requireString } from "../_lib";

type Body = { connectionUrl?: string; insertion?: RowInsert };

export const POST = jsonHandler<Body>("rows.insert", async (body) => {
  const url = requireString(body.connectionUrl, "connectionUrl");
  if (!body.insertion) throw new Error("Missing insertion");
  return insertRow(url, body.insertion);
});
