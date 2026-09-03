/** Bumped when the on-disk entry shape changes so old logs stay readable. */
export const ACTIVITY_LOG_VERSION = 1;

/** Actions that reach the database through an API route. */
export const API_ACTIONS = [
  "tables",
  "rows",
  "query",
  "cell.update",
  "rows.insert",
  "rows.delete",
  "related",
  "lookup",
  "definition",
] as const;

/** Actions that only ever happen in the browser, reported by the client. */
export const UI_ACTIONS = [
  "connection.add",
  "connection.update",
  "connection.remove",
  "config.export",
  "config.import",
] as const;

export type ApiAction = (typeof API_ACTIONS)[number];
export type UiAction = (typeof UI_ACTIONS)[number];
export type ActivityAction = ApiAction | UiAction;

export type ActivityEntry = {
  v: typeof ACTIVITY_LOG_VERSION;
  id: string;
  ts: string;
  source: "api" | "ui";
  action: ActivityAction;
  /** Connection string with the password stripped, or null when unknown. */
  connection: string | null;
  status: "ok" | "error";
  durationMs: number;
  params?: unknown;
  result?: Record<string, unknown>;
  error?: string;
};

export function isUiAction(value: unknown): value is UiAction {
  return typeof value === "string" && (UI_ACTIONS as readonly string[]).includes(value);
}
