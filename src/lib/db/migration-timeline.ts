import "server-only";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { quoteIdent } from "../identifiers";
import { ledgerTable, type MigrationRequest } from "../migrations/types";
import type { TimelineDetail, TimelineEvent, TimelinePage, TimelineQuery } from "../migrations/timeline";

const EVENTS = "ytdb_migration_events";
const REVISIONS = "ytdb_migration_revisions";
const table = (schema: string, name: string) => `${quoteIdent(schema)}.${quoteIdent(name)}`;
// Hash exact text, including whitespace. Unlike the status checksum, this is an
// identity for an immutable pair of SQL files and must not normalize their bytes.
const revisionHash = (sql: string, revert: string) =>
  `encode(sha256(convert_to(json_build_array(${sql}, ${revert})::text, 'UTF8')), 'hex')`;

/** Called inside the ledger setup transaction, under its initialization lock. */
export async function ensureTimeline(client: PoolClient, schema: string): Promise<void> {
  const events = table(schema, EVENTS);
  const revisions = table(schema, REVISIONS);
  const exists = await client.query("SELECT to_regclass($1) AS name", [events]);
  if (exists.rows[0].name) return;
  await client.query(`CREATE TABLE ${revisions} (
    id text PRIMARY KEY,
    sql text,
    revert_sql text
  )`);
  await client.query(`CREATE TABLE ${events} (
    sequence bigserial PRIMARY KEY,
    id text NOT NULL UNIQUE,
    set_name text NOT NULL,
    version text NOT NULL,
    name text NOT NULL,
    direction text NOT NULL CHECK (direction IN ('apply', 'revert')),
    kind text NOT NULL CHECK (kind IN ('applied', 'reverted', 'marked', 'unmarked', 'failed', 'uncertain', 'legacy')),
    started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    finished_at timestamptz,
    duration_ms integer,
    applied_by text,
    revision_id text REFERENCES ${revisions}(id),
    atomic boolean NOT NULL,
    error text
  )`);
  await client.query(`CREATE INDEX ON ${events} (set_name, version, sequence DESC)`);
  await client.query(`CREATE INDEX ON ${events} (set_name, sequence DESC)`);
  // Preserve the only earlier evidence available before a rerun overwrites it.
  // A legacy row may have been marked manually, so never claim its SQL executed.
  await client.query(`INSERT INTO ${revisions} (id, sql, revert_sql)
    SELECT ${revisionHash("apply_sql", "revert_sql")}, apply_sql, revert_sql
    FROM ${ledgerTable(schema)} ON CONFLICT DO NOTHING`);
  await client.query(`INSERT INTO ${events}
    (id, set_name, version, name, direction, kind, started_at, finished_at,
     duration_ms, applied_by, revision_id, atomic)
    SELECT 'legacy:' || md5(json_build_array(set_name, version)::text),
      set_name, version, name, 'apply', 'legacy', applied_at, applied_at,
      duration_ms, applied_by, ${revisionHash("apply_sql", "revert_sql")}, false
    FROM ${ledgerTable(schema)} ORDER BY applied_at, set_name, version`);
}

/** A committed start survives a crash, rollback, or lost response. */
export async function startTimelineEvent(
  client: PoolClient,
  schema: string,
  request: MigrationRequest,
  atomic: boolean,
): Promise<string> {
  const id = request.runId ?? randomUUID();
  const revisions = table(schema, REVISIONS);
  // One statement makes the revision and attempt inseparable, even in autocommit.
  await client.query(`WITH revision AS (
    INSERT INTO ${revisions} (id, sql, revert_sql)
    VALUES (${revisionHash("$1::text", "$2::text")}, $1, $2)
    ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
    RETURNING id
  ) INSERT INTO ${table(schema, EVENTS)}
    (id, set_name, version, name, direction, kind, applied_by, revision_id, atomic)
    SELECT $3, $4, $5, $6, $7, 'uncertain', session_user, id, $8 FROM revision`,
  [request.sql || null, request.revertSql ?? null, id, request.setName,
    request.version, request.name, request.direction, atomic]);
  return id;
}

export async function finishTimelineEvent(
  client: Pick<PoolClient, "query">,
  schema: string,
  id: string,
  kind: TimelineEvent["kind"],
  durationMs: number,
  error: string | null = null,
): Promise<void> {
  await client.query(`UPDATE ${table(schema, EVENTS)}
    SET kind = $2, duration_ms = $3, error = $4, finished_at = clock_timestamp()
    WHERE id = $1 AND kind = 'uncertain'`, [id, kind, durationMs, error]);
}

export function successKind(request: MigrationRequest): TimelineEvent["kind"] {
  return request.recordOnly
    ? request.direction === "apply" ? "marked" : "unmarked"
    : request.direction === "apply" ? "applied" : "reverted";
}

type EventRow = {
  id: string; sequence: string; set_name: string; version: string; name: string;
  direction: TimelineEvent["direction"]; kind: TimelineEvent["kind"];
  started_at: Date; finished_at: Date | null; duration_ms: number | null;
  applied_by: string | null; revision_id: string | null; atomic: boolean; error: string | null;
};

/** Read-only, bounded, and deliberately excludes SQL bodies. */
export async function readTimelinePage(pool: Pool, schema: string, query: TimelineQuery): Promise<TimelinePage> {
  const events = table(schema, EVENTS);
  const exists = await pool.query("SELECT to_regclass($1) AS name", [events]);
  if (!exists.rows[0].name) return { initialized: false, schema, events: [], nextCursor: null };
  const values: unknown[] = [];
  const where: string[] = [];
  const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
  if (query.before) where.push(`sequence < ${bind(query.before)}::bigint`);
  if (query.setName !== undefined) where.push(`set_name = ${bind(query.setName)}`);
  if (query.kind) where.push(`kind = ${bind(query.kind)}`);
  if (query.query) {
    const search = bind(query.query.toLowerCase());
    where.push(`strpos(lower(concat_ws(' ', set_name, version, name, applied_by)), ${search}) > 0`);
  }
  const result = await pool.query<EventRow>(`SELECT * FROM ${events}
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY sequence DESC LIMIT 51`, values);
  const rows = result.rows.slice(0, 50);
  return {
    initialized: true, schema,
    nextCursor: result.rows.length > 50 ? rows[rows.length - 1].sequence : null,
    events: rows.map((row) => ({
      id: row.id, sequence: row.sequence, setName: row.set_name, version: row.version,
      name: row.name, direction: row.direction, kind: row.kind,
      startedAt: row.started_at.toISOString(), finishedAt: row.finished_at?.toISOString() ?? null,
      durationMs: row.duration_ms, appliedBy: row.applied_by, revisionId: row.revision_id,
      atomic: row.atomic, error: row.error,
    })),
  };
}

/** Compare with the previous successful run in the same direction, even across pages. */
export async function readTimelineDetail(pool: Pool, schema: string, id: string): Promise<TimelineDetail> {
  const events = table(schema, EVENTS);
  const revisions = table(schema, REVISIONS);
  const result = await pool.query(`SELECT r.sql, r.revert_sql, previous.sql AS previous_sql,
      previous.started_at AS previous_at
    FROM ${events} e LEFT JOIN ${revisions} r ON r.id = e.revision_id
    LEFT JOIN LATERAL (
      SELECT pr.sql, p.started_at FROM ${events} p
      LEFT JOIN ${revisions} pr ON pr.id = p.revision_id
      WHERE p.set_name = e.set_name AND p.version = e.version AND p.direction = e.direction
        AND p.sequence < e.sequence AND p.kind IN ('applied', 'reverted')
      ORDER BY p.sequence DESC LIMIT 1
    ) previous ON true WHERE e.id = $1`, [id]);
  const row = result.rows[0];
  if (!row) throw new Error("This timeline event could not be found. Refresh the timeline and try again.");
  return { sql: row.sql, revertSql: row.revert_sql, previousSql: row.previous_sql,
    previousAt: row.previous_at?.toISOString() ?? null };
}
