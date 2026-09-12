import { readMigrationTimeline, readMigrationTimelineDetail } from "@/lib/db/migrate";
import { TIMELINE_KINDS, type TimelineQuery } from "@/lib/migrations/timeline";
import { isLedgerSchema } from "@/lib/migrations/types";
import { jsonHandler, requireString } from "../_lib";

type Body = { connectionUrl?: string; ledgerSchema?: string; query?: TimelineQuery; eventId?: string };

export const POST = jsonHandler<Body>("timeline", async (body) => {
  const url = requireString(body.connectionUrl, "connectionUrl");
  if (!isLedgerSchema(body.ledgerSchema)) throw new Error("Invalid ledger schema");
  if (body.eventId !== undefined) {
    return readMigrationTimelineDetail(url, body.ledgerSchema, requireString(body.eventId, "eventId"));
  }
  const input = body.query ?? {};
  if (input.before !== undefined && (typeof input.before !== "string" || !/^[1-9]\d{0,18}$/.test(input.before))) {
    throw new Error("Invalid timeline cursor");
  }
  if (input.setName !== undefined && typeof input.setName !== "string") throw new Error("Invalid migration set");
  if (input.query !== undefined && (typeof input.query !== "string" || input.query.length > 200)) throw new Error("Search must be at most 200 characters");
  if (input.kind !== undefined && !TIMELINE_KINDS.includes(input.kind)) throw new Error("Invalid timeline filter");
  return readMigrationTimeline(url, body.ledgerSchema, {
    before: input.before, setName: input.setName, query: input.query?.trim(), kind: input.kind,
  });
});
