import { initLedger, readLedger } from "@/lib/db/migrate";
import { ledgerSchemaOrDefault } from "@/lib/migrations/types";
import { jsonHandler, requireString } from "../_lib";

type Body = {
  connectionUrl?: string;
  ledgerSchema?: string;
  init?: boolean;
  /** Include each row's stored SQL, for rebuilding a migration without its files. */
  withSql?: boolean;
};

export const POST = jsonHandler<Body>("ledger", async (body) => {
  const url = requireString(body.connectionUrl, "connectionUrl");
  const schema = ledgerSchemaOrDefault(body.ledgerSchema);
  if (body.init === true) return initLedger(url, schema);
  return readLedger(url, schema, body.withSql === true);
});
