import { deleteRows } from "@/lib/db/delete-rows";
import type { RowDelete } from "@/lib/types";
import { jsonHandler, requireString } from "../_lib";

type Body = { connectionUrl?: string; deletion?: RowDelete };

export const POST = jsonHandler<Body>("rows.delete", async (body) => {
  const url = requireString(body.connectionUrl, "connectionUrl");
  if (!body.deletion) throw new Error("Missing deletion");
  return deleteRows(url, body.deletion);
});
