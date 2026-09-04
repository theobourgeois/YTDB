import { updateRow } from "@/lib/db/update-row";
import type { RowUpdate } from "@/lib/types";
import { jsonHandler, requireString } from "../_lib";

type Body = { connectionUrl?: string; update?: RowUpdate };

export const POST = jsonHandler<Body>("rows.update", async (body) => {
  const url = requireString(body.connectionUrl, "connectionUrl");
  if (!body.update) throw new Error("Missing update");
  return updateRow(url, body.update);
});
