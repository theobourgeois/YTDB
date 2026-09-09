import "server-only";
import { Pool } from "pg";
import { MIGRATION_STATEMENT_TIMEOUT_MS, STATEMENT_TIMEOUT_MS } from "../query-limits";

const pools = new Map<string, Pool>();

function needsSsl(connectionString: string): boolean {
  try {
    const { hostname, searchParams } = new URL(connectionString);
    if (searchParams.has("sslmode")) return searchParams.get("sslmode") !== "disable";
    return !["localhost", "127.0.0.1", "::1"].includes(hostname);
  } catch {
    return false;
  }
}

/**
 * What a pool is for. Explorer requests are held to an interactive timeout so a
 * missing index cannot stall the UI; migrations get their own pool because that
 * timeout would cancel a long DDL statement halfway through.
 */
export type PoolKind = "explorer" | "migration";

const TIMEOUTS: Record<PoolKind, number> = {
  explorer: STATEMENT_TIMEOUT_MS,
  migration: MIGRATION_STATEMENT_TIMEOUT_MS,
};

/** One lazily created pool per connection string and kind, kept for the life of the server. */
export function getPool(connectionString: string, kind: PoolKind = "explorer"): Pool {
  const key = `${kind}:${connectionString}`;
  let pool = pools.get(key);
  if (!pool) {
    const timeout = TIMEOUTS[kind];
    pool = new Pool({
      connectionString,
      max: kind === "migration" ? 2 : 4,
      idleTimeoutMillis: 30_000,
      application_name: "ytdb",
      statement_timeout: timeout,
      query_timeout: timeout,
      ssl: needsSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
    });
    pool.on("error", () => pools.delete(key));
    pools.set(key, pool);
  }
  return pool;
}
