import { initLedger, readLedger } from "@/lib/db/migrate";
import { ledgerSchemaOrDefault } from "@/lib/migrations/types";
import { jsonHandler, requireString } from "../_lib";

type Body = { connectionUrl?: string; ledgerSchema?: string; init?: boolean };

export const POST = jsonHandler<Body>("ledger", async (body) => {
  const url = requireString(body.connectionUrl, "connectionUrl");
  const schema = ledgerSchemaOrDefault(body.ledgerSchema);
  return body.init === true ? initLedger(url, schema) : readLedger(url, schema);
});
