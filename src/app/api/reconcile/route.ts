import { reconcileMigration, resolveMigration } from "@/lib/db/reconcile";
import { isLedgerSchema } from "@/lib/migrations/types";
import { jsonHandler, requireString } from "../_lib";

type Body = {
  connectionUrl?: string;
  ledgerSchema?: string;
  eventId?: string;
  outcome?: unknown;
  checksum?: unknown;
};

/**
 * Without an outcome, reports what the database says about an unconfirmed run.
 * With one, settles the run on that word.
 */
export const POST = jsonHandler<Body>("reconcile", async (body) => {
  const url = requireString(body.connectionUrl, "connectionUrl");
  if (!isLedgerSchema(body.ledgerSchema)) throw new Error("Invalid ledger schema");
  const eventId = requireString(body.eventId, "eventId");
  if (body.outcome === undefined) return reconcileMigration(url, body.ledgerSchema, eventId);
  if (body.outcome !== "landed" && body.outcome !== "lost") throw new Error("outcome must be landed or lost");
  if (body.checksum !== undefined && typeof body.checksum !== "string") throw new Error("Invalid checksum");
  await resolveMigration(url, body.ledgerSchema, { eventId, outcome: body.outcome, checksum: body.checksum });
  return { resolved: true };
});
