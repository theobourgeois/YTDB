import { getSchemaSnapshot } from "@/lib/db/schema-snapshot";
import { jsonHandler, requireString } from "../_lib";

type Body = { connectionUrl?: string };

export const POST = jsonHandler<Body>("schema", async (body) => {
  const url = requireString(body.connectionUrl, "connectionUrl");
  return getSchemaSnapshot(url);
});
