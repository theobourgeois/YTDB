import type { UiAction } from "./types";
import { bridgeFetch } from "../bridge";

/**
 * Reports an action that never reaches the database (connections and config live in
 * localStorage) so the activity log covers the whole app, not just queries.
 */
export function logUiAction(
  action: UiAction,
  details?: { connectionUrl?: string; [key: string]: unknown },
): void {
  if (typeof window === "undefined") return;
  const { connectionUrl, ...params } = details ?? {};
  void bridgeFetch("/api/activity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, connectionUrl, params }),
    keepalive: true,
  }).catch(() => {
    // A missing log entry must never surface as a UI error.
  });
}
