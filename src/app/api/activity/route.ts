import { recordActivity, redactConnection, redactParams } from "@/lib/activity/log";
import { isUiAction } from "@/lib/activity/types";

type Body = { action?: unknown; connectionUrl?: unknown; params?: unknown };

/**
 * Records browser-only actions. Deliberately not built on `jsonHandler`, which logs
 * every request it wraps and would log this endpoint on top of the entry it writes.
 */
export async function POST(request: Request): Promise<Response> {
  if (process.env.VERCEL === "1") {
    return Response.json({ error: "Database API is local-only" }, { status: 404 });
  }
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!isUiAction(body.action)) {
    return Response.json({ error: "Unknown action" }, { status: 400 });
  }
  recordActivity({
    source: "ui",
    action: body.action,
    connection: redactConnection(body.connectionUrl),
    status: "ok",
    durationMs: 0,
    params: redactParams(body.params),
  });
  return Response.json({ ok: true });
}
