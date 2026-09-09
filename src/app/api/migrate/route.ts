import { runMigration } from "@/lib/db/migrate";
import { isLedgerSchema, type MigrationRequest } from "@/lib/migrations/types";
import { jsonHandler, requireString } from "../_lib";

type Body = { connectionUrl?: string; migration?: Partial<MigrationRequest> };

export const POST = jsonHandler<Body>("migrate", async (body) => {
  const url = requireString(body.connectionUrl, "connectionUrl");
  const input = body.migration;
  if (!input || typeof input !== "object") throw new Error("Missing migration");
  if (input.direction !== "apply" && input.direction !== "revert") {
    throw new Error("migration.direction must be apply or revert");
  }
  if (!isLedgerSchema(input.ledgerSchema)) {
    throw new Error("migration.ledgerSchema must be a plain schema name");
  }
  const recordOnly = input.recordOnly === true;
  return runMigration(url, {
    recordOnly,
    ledgerSchema: input.ledgerSchema,
    revertSql: typeof input.revertSql === "string" ? input.revertSql : undefined,
    direction: input.direction,
    version: requireString(input.version, "migration.version"),
    name: typeof input.name === "string" ? input.name : "",
    checksum: typeof input.checksum === "string" ? input.checksum : "",
    setName: typeof input.setName === "string" ? input.setName : "",
    // Marking writes no SQL, so an empty body is legitimate there and only there.
    sql: recordOnly
      ? typeof input.sql === "string"
        ? input.sql
        : ""
      : requireString(input.sql, "migration.sql"),
  });
});
