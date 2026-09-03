import "server-only";
import { queryErrorMessage } from "@/lib/query-limits";
import type { TableRef } from "@/lib/types";
import {
  recordActivity,
  redactConnection,
  redactParams,
  summarizeResult,
} from "@/lib/activity/log";
import type { ApiAction } from "@/lib/activity/types";

type Handler<T> = (body: T) => Promise<unknown>;

/**
 * Parses a JSON body, runs the handler, and turns thrown errors into a JSON error response.
 * Every call is appended to the activity log — this is the one place all DB actions pass through.
 */
export function jsonHandler<T>(action: ApiAction, handler: Handler<T>) {
  return async (request: Request): Promise<Response> => {
    if (process.env.VERCEL === "1") {
      return Response.json({ error: "Database API is local-only" }, { status: 404 });
    }
    const startedAt = performance.now();
    let body: T;
    try {
      body = (await request.json()) as T;
    } catch {
      recordActivity({
        source: "api",
        action,
        connection: null,
        status: "error",
        durationMs: Math.round(performance.now() - startedAt),
        error: "Invalid JSON body",
      });
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const connection = redactConnection((body as { connectionUrl?: unknown })?.connectionUrl);
    const params = redactParams(body);
    try {
      const result = await handler(body);
      recordActivity({
        source: "api",
        action,
        connection,
        status: "ok",
        durationMs: Math.round(performance.now() - startedAt),
        params,
        result: summarizeResult(action, result),
      });
      return Response.json(result);
    } catch (error) {
      const message = queryErrorMessage(error);
      recordActivity({
        source: "api",
        action,
        connection,
        status: "error",
        durationMs: Math.round(performance.now() - startedAt),
        params,
        error: message,
      });
      return Response.json({ error: message }, { status: 500 });
    }
  };
}

export function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

export function requireTable(value: unknown, name = "table"): TableRef {
  if (!value || typeof value !== "object") throw new Error(`Missing ${name}`);
  const table = value as { schema?: unknown; name?: unknown };
  return {
    schema: requireString(table.schema, `${name}.schema`),
    name: requireString(table.name, `${name}.name`),
  };
}
