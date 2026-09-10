import { detectApplied, type DetectInput } from "@/lib/db/detect";
import { jsonHandler, requireString } from "../_lib";

type Body = { connectionUrl?: string; migrations?: unknown };

const MAX_MIGRATIONS = 5_000;

function toInput(value: unknown, index: number): DetectInput {
  if (!value || typeof value !== "object") throw new Error(`migrations[${index}] is not an object`);
  const input = value as Partial<DetectInput>;
  return {
    setName: requireString(input.setName, `migrations[${index}].setName`),
    version: requireString(input.version, `migrations[${index}].version`),
    sql: typeof input.sql === "string" ? input.sql : "",
  };
}

/** Reads the catalog and says, for each migration, whether its changes are already there. */
export const POST = jsonHandler<Body>("detect", async (body) => {
  const url = requireString(body.connectionUrl, "connectionUrl");
  if (!Array.isArray(body.migrations) || body.migrations.length === 0) {
    throw new Error("migrations must be a non-empty array");
  }
  if (body.migrations.length > MAX_MIGRATIONS) {
    throw new Error(`migrations is over ${MAX_MIGRATIONS}`);
  }
  return { results: await detectApplied(url, body.migrations.map(toInput)) };
});
