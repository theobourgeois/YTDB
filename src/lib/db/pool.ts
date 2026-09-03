import "server-only";
import { Pool } from "pg";
import { STATEMENT_TIMEOUT_MS } from "../query-limits";

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

/** One lazily created pool per connection string, kept for the life of the server. */
export function getPool(connectionString: string): Pool {
  let pool = pools.get(connectionString);
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 4,
      idleTimeoutMillis: 30_000,
      application_name: "db-studio",
      statement_timeout: STATEMENT_TIMEOUT_MS,
      query_timeout: STATEMENT_TIMEOUT_MS,
      ssl: needsSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
    });
    pool.on("error", () => pools.delete(connectionString));
    pools.set(connectionString, pool);
  }
  return pool;
}
