import { adoptMigrations } from "@/lib/db/migrate";
import { isLedgerSchema, type AdoptEntry } from "@/lib/migrations/types";
import { jsonHandler, requireString } from "../_lib";

type Body = { connectionUrl?: string; adopt?: { ledgerSchema?: unknown; entries?: unknown } };

const MAX_ENTRIES = 5_000;

function toEntry(value: unknown, index: number): AdoptEntry {
  if (!value || typeof value !== "object") throw new Error(`adopt.entries[${index}] is not an object`);
  const input = value as Partial<AdoptEntry>;
  return {
    setName: requireString(input.setName, `adopt.entries[${index}].setName`),
    version: requireString(input.version, `adopt.entries[${index}].version`),
    name: typeof input.name === "string" ? input.name : "",
    checksum: typeof input.checksum === "string" ? input.checksum : "",
    applySql: typeof input.applySql === "string" ? input.applySql : "",
    revertSql: typeof input.revertSql === "string" ? input.revertSql : undefined,
  };
}

/** Writes many ledger rows without running anything, for adopting a folder wholesale. */
export const POST = jsonHandler<Body>("adopt", async (body) => {
  const url = requireString(body.connectionUrl, "connectionUrl");
  const input = body.adopt;
  if (!input || typeof input !== "object") throw new Error("Missing adopt");
  if (!isLedgerSchema(input.ledgerSchema)) {
    throw new Error("adopt.ledgerSchema must be a plain schema name");
  }
  if (!Array.isArray(input.entries) || input.entries.length === 0) {
    throw new Error("adopt.entries must be a non-empty array");
  }
  if (input.entries.length > MAX_ENTRIES) {
    throw new Error(`adopt.entries is over ${MAX_ENTRIES} rows`);
  }
  return adoptMigrations(url, {
    ledgerSchema: input.ledgerSchema,
    entries: input.entries.map(toEntry),
  });
});
