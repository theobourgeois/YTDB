import { runSqlQuery } from "@/lib/db/query";
import { jsonHandler, requireString } from "../_lib";

type Body = { connectionUrl?: string; sql?: string };

export const POST = jsonHandler<Body>("query", async (body) => {
  const url = requireString(body.connectionUrl, "connectionUrl");
  const sql = requireString(body.sql, "sql");
  return runSqlQuery(url, sql);
});
