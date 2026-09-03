import { getTableDefinition } from "@/lib/db/definition";
import { jsonHandler, requireString, requireTable } from "../_lib";

type Body = { connectionUrl?: string; table?: unknown };

export const POST = jsonHandler<Body>(async (body) => {
  const url = requireString(body.connectionUrl, "connectionUrl");
  return getTableDefinition(url, requireTable(body.table));
});
