import "server-only";
import { queryErrorMessage } from "@/lib/query-limits";
import type { TableRef } from "@/lib/types";

type Handler<T> = (body: T) => Promise<unknown>;

/** Parses a JSON body, runs the handler, and turns thrown errors into a JSON error response. */
export function jsonHandler<T>(handler: Handler<T>) {
  return async (request: Request): Promise<Response> => {
    if (process.env.VERCEL === "1") {
      return Response.json({ error: "Database API is local-only" }, { status: 404 });
    }
    let body: T;
    try {
      body = (await request.json()) as T;
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    try {
      return Response.json(await handler(body));
    } catch (error) {
      return Response.json({ error: queryErrorMessage(error) }, { status: 500 });
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
