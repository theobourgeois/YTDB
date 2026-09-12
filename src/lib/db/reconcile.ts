import "server-only";
import { ledgerTable } from "../migrations/types";
import { extractEvidence, judge } from "../migrations/detect";
import { planTransaction } from "../migrations/sql";
import type { ReconcileReport, ResolveRequest } from "../migrations/timeline";
import { readCatalog } from "./detect";
import { resolveLedgerSchema } from "./migrate";
import { closeTimelineEvent, readTimelineEvent } from "./migration-timeline";
import { getPool } from "./pool";

/**
 * Whether another session on this database is still running this SQL. The
 * activity view keeps the text of each session's current query, so a run whose
 * response was lost — but whose statement is still going — is found by it.
 * Only the head is compared: the view truncates long queries.
 */
const RUNNING_SQL = `
SELECT state, xact_start
FROM pg_stat_activity
WHERE pid <> pg_backend_pid()
  AND datname = current_database()
  AND state IN ('active', 'idle in transaction')
  AND left(query, 400) = left($1, 400)
ORDER BY xact_start NULLS LAST
LIMIT 1`;

type ActivityRow = { state: string; xact_start: Date | null };

/** What can be found out, right now, about a run with no confirmed outcome. */
export async function reconcileMigration(
  connectionString: string,
  configured: string,
  eventId: string,
): Promise<ReconcileReport> {
  const pool = getPool(connectionString);
  const { schema } = await resolveLedgerSchema(pool, configured);
  const record = await readTimelineEvent(pool, schema, eventId);
  if (!record) throw new Error("This timeline event could not be found. Refresh the timeline and try again.");
  const { sql, ...rest } = record;
  const { revertSql: _unused, ...event } = rest;
  void _unused;

  let running: ReconcileReport["running"] = null;
  let detection: ReconcileReport["detection"] = null;
  if (sql) {
    const ran = planTransaction(sql).sql;
    const [activity, catalog] = await Promise.all([
      pool.query<ActivityRow>(RUNNING_SQL, [ran]).catch(() => null),
      readCatalog(connectionString),
    ]);
    const session = activity?.rows[0];
    if (session) running = { state: session.state, since: session.xact_start?.toISOString() ?? null };
    detection = { setName: event.setName, version: event.version, ...judge(extractEvidence(sql), catalog) };
  }
  return { event, running, detection };
}

const RECORD_SQL = (schema: string) => `
INSERT INTO ${ledgerTable(schema)}
  (version, name, checksum, set_name, duration_ms, applied_by, apply_sql, revert_sql)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (set_name, version) DO UPDATE SET
  name = EXCLUDED.name,
  checksum = EXCLUDED.checksum,
  applied_at = now(),
  duration_ms = EXCLUDED.duration_ms,
  applied_by = EXCLUDED.applied_by,
  apply_sql = EXCLUDED.apply_sql,
  revert_sql = EXCLUDED.revert_sql`;

const FORGET_SQL = (schema: string) =>
  `DELETE FROM ${ledgerTable(schema)} WHERE set_name = $1 AND version = $2`;

/**
 * Settles an unconfirmed run on the word of whoever checked the database.
 *
 * "Landed" gives the ledger the row the run would have written, so the
 * migration reads as applied everywhere the ledger is read; "lost" leaves the
 * ledger alone, since the run's own row never committed. Either way the event
 * is closed, with the run's own error kept beside the conclusion.
 */
export async function resolveMigration(
  connectionString: string,
  configured: string,
  request: ResolveRequest,
): Promise<void> {
  const pool = getPool(connectionString, "migration");
  const { schema } = await resolveLedgerSchema(pool, configured);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const event = await readTimelineEvent(client, schema, request.eventId, true);
    if (!event) throw new Error("This timeline event could not be found. Refresh the timeline and try again.");
    if (event.kind !== "uncertain") {
      throw new Error(`This run was settled in the meantime and is now "${event.kind}". Refresh the timeline.`);
    }

    const reported = event.error ? ` The run had reported: ${event.error}` : "";
    if (request.outcome === "landed") {
      if (event.direction === "apply") {
        await client.query(RECORD_SQL(schema), [
          event.version, event.name, request.checksum ?? "", event.setName,
          event.durationMs ?? 0, event.appliedBy, event.sql, event.revertSql,
        ]);
      } else {
        await client.query(FORGET_SQL(schema), [event.setName, event.version]);
      }
      await closeTimelineEvent(client, schema, event.id, event.direction === "apply" ? "applied" : "reverted",
        `Confirmed by hand from the database afterwards.${reported}`);
    } else {
      await closeTimelineEvent(client, schema, event.id, "failed",
        `Checked by hand afterwards: nothing from this run is on the database.${reported}`);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
