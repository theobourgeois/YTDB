import { updateCell } from "@/lib/db/update-cell";
import type { CellUpdate } from "@/lib/types";
import { jsonHandler, requireString } from "../_lib";

type Body = { connectionUrl?: string; update?: CellUpdate };

export const POST = jsonHandler<Body>(async (body) => {
  const url = requireString(body.connectionUrl, "connectionUrl");
  if (!body.update) throw new Error("Missing update");
  return updateCell(url, body.update);
});
