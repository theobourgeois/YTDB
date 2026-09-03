/** Cancels explorer queries so a missing index cannot scan the whole database. */
export const STATEMENT_TIMEOUT_MS = 8_000;

/** Cheap exact COUNT(*) is fine below ~8MB of heap. */
export const EXACT_COUNT_MAX_BYTES = 8 * 1024 * 1024;

/** OFFSET past this still has to walk every skipped row. */
export const MAX_OFFSET = 10_000;

export function queryErrorMessage(error: unknown): string {
  if (isQueryTimeout(error)) {
    return "Query took too long and was cancelled. Add a filter instead of scanning the whole table.";
  }
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

function isQueryTimeout(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? error.code : undefined;
  if (code === "57014") return true;
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  return /timeout|cancell?ed|cancell?ing/i.test(message);
}
