import { listTables } from "@/lib/db/introspect";
import { jsonHandler, requireString } from "../_lib";

type Body = { connectionUrl?: string };

export const POST = jsonHandler<Body>(async (body) => {
  const url = requireString(body.connectionUrl, "connectionUrl");
  return listTables(url);
});
