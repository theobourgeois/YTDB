import "server-only";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  ACTIVITY_LOG_VERSION,
  type ActivityAction,
  type ActivityEntry,
} from "./types";

/** Oversized payloads are stored as a preview so one bad request can't bloat the log. */
const MAX_PARAM_BYTES = 20_000;
const PREVIEW_CHARS = 1_000;

export const ACTIVITY_LOG_DIR =
  process.env.YTDB_LOG_DIR ?? path.join(process.cwd(), ".ytdb", "activity");

function loggingEnabled(): boolean {
  return !["0", "off", "false"].includes((process.env.YTDB_LOG ?? "").toLowerCase());
}

/** One file per day keeps a long-running studio from growing a single unreadable file. */
function logFileFor(date: Date): string {
  return path.join(ACTIVITY_LOG_DIR, `${date.toISOString().slice(0, 10)}.jsonl`);
}

let dirReady: Promise<void> | null = null;
let writeQueue: Promise<void> = Promise.resolve();
let warned = false;

function reportFailure(error: unknown): void {
  if (warned) return;
  warned = true;
  console.warn("[activity-log] disabled for this run:", error);
}

/** Appends without blocking the request; logging must never fail a query. */
export function recordActivity(entry: Omit<ActivityEntry, "v" | "id" | "ts">): void {
  if (!loggingEnabled()) return;
  const line = `${JSON.stringify({
    v: ACTIVITY_LOG_VERSION,
    id: randomUUID(),
    ts: new Date().toISOString(),
    ...entry,
  })}\n`;
  writeQueue = writeQueue
    .then(async () => {
      dirReady ??= mkdir(ACTIVITY_LOG_DIR, { recursive: true }).then(() => undefined);
      await dirReady;
      await appendFile(logFileFor(new Date()), line, "utf8");
    })
    .catch((error) => {
      dirReady = null;
      reportFailure(error);
    });
}

/** Keeps the host and database — which identify the connection — but drops the password. */
export function redactConnection(url: unknown): string | null {
  if (typeof url !== "string" || url.length === 0) return null;
  try {
    const parsed = new URL(url);
    const user = parsed.username ? `${decodeURIComponent(parsed.username)}@` : "";
    const port = parsed.port ? `:${parsed.port}` : "";
    return `${parsed.protocol}//${user}${parsed.hostname}${port}${parsed.pathname}`;
  } catch {
    return "invalid-url";
  }
}

/** Strips the credentials out of a request body and caps what is left. */
export function redactParams(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return cap(body);
  const entries = Object.entries(body as Record<string, unknown>);
  return cap(Object.fromEntries(entries.filter(([key]) => key !== "connectionUrl")));
}

function cap(value: unknown): unknown {
  let json: string;
  try {
    json = JSON.stringify(value) ?? "null";
  } catch {
    return { unserializable: true };
  }
  if (json.length <= MAX_PARAM_BYTES) return value;
  return { truncated: true, bytes: json.length, preview: json.slice(0, PREVIEW_CHARS) };
}

/** Counts, not payloads: enough to debug or mine the log without copying the database into it. */
export function summarizeResult(
  action: ActivityAction,
  result: unknown,
): Record<string, unknown> | undefined {
  const value = result as Record<string, unknown> | undefined;
  switch (action) {
    case "tables":
      return { tables: Array.isArray(result) ? result.length : 0 };
    case "rows":
    case "lookup":
      return {
        rows: rowCount(value?.rows),
        columns: rowCount(value?.columns),
        total: value?.total ?? null,
        estimated: value?.estimated ?? false,
        capped: value?.capped ?? false,
      };
    case "query": {
      const statements = Array.isArray(value?.statements)
        ? (value.statements as Record<string, unknown>[])
        : [];
      return {
        statements: statements.length,
        commands: statements.map((statement) => statement.command),
        rows: statements.reduce((total, statement) => total + rowCount(statement.rows), 0),
        durationMs: value?.durationMs ?? null,
      };
    }
    case "cell.update":
      return { updated: value?.row ? 1 : 0 };
    case "rows.insert":
      return { inserted: value?.row ? 1 : 0 };
    case "rows.update":
      return { updated: value?.updated ?? 0 };
    case "rows.delete":
      return { deleted: value?.deleted ?? 0 };
    case "related": {
      const lookups = Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
      return {
        lookups: lookups.length,
        matched: lookups.reduce((total, lookup) => total + rowCount(lookup.rows), 0),
      };
    }
    case "definition":
      return { sqlLength: typeof value?.sql === "string" ? value.sql.length : 0 };
    default:
      return undefined;
  }
}

function rowCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}
