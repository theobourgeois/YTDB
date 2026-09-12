import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runMigration, readLedger, adoptMigrations, readMigrationTimeline, readMigrationTimelineDetail } from "../src/lib/db/migrate";
import { getPool } from "../src/lib/db/pool";
import { startTimelineEvent } from "../src/lib/db/migration-timeline";
import { buildHistory } from "../src/lib/migrations/history";
import type { MigrationRequest } from "../src/lib/migrations/types";

const url = process.env.YTDB_TEST_DATABASE_URL!;
assert.match(url, /^postgresql:\/\/postgres@127\.0\.0\.1:\d+\/postgres$/);
const pool = getPool(url);
const migrationPool = getPool(url, "migration");
after(async () => { await pool.end(); await migrationPool.end(); });
let counter = 0;
const schema = () => `timeline_test_${++counter}`;
const request = (ledgerSchema: string, overrides: Partial<MigrationRequest> = {}): MigrationRequest => ({
  runId: randomUUID(), ledgerSchema, setName: "accounts", version: "0001", name: "Update greeting",
  sql: "SELECT 'hello';", revertSql: "SELECT 'goodbye';", checksum: "original", direction: "apply", ...overrides,
});

test("reading the timeline never initializes or changes a database", async () => {
  const name = schema();
  const page = await readMigrationTimeline(url, name, {});
  assert.deepEqual(page, { initialized: false, schema: name, events: [], nextCursor: null });
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = $1", [name])).rows[0].n, 0);
});

test("reruns preserve exact revisions; reverts preserve history after deleting ledger state", async () => {
  const name = schema();
  const original = request(name);
  await runMigration(url, original);
  const updated = request(name, { sql: "SELECT 'welcome';\n", checksum: "updated" });
  await runMigration(url, updated);
  await runMigration(url, { ...updated, runId: randomUUID() });
  const applied = await readMigrationTimeline(url, name, {});
  assert.deepEqual(applied.events.map((e) => e.kind), ["applied", "applied", "applied"]);
  assert.equal(applied.events[0].revisionId, applied.events[1].revisionId);
  assert.notEqual(applied.events[1].revisionId, applied.events[2].revisionId);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${name}.ytdb_migration_revisions`)).rows[0].n, 2);
  assert.equal("sql" in applied.events[0], false);
  const detail = await readMigrationTimelineDetail(url, name, updated.runId!);
  assert.equal(detail.sql, updated.sql);
  assert.equal(detail.previousSql, original.sql);
  assert.equal(detail.revertSql, original.revertSql);
  await runMigration(url, request(name, { direction: "revert", sql: original.revertSql!, revertSql: undefined }));
  assert.equal((await readLedger(url, name)).entries.length, 0);
  assert.equal((await readMigrationTimeline(url, name, {})).events.length, 4);
  assert.equal((await readMigrationTimeline(url, name, {})).events[0].kind, "reverted");
});

test("an atomic failure rolls back data and ledger, while retaining failed SQL and error", async () => {
  const name = schema();
  const failed = request(name, { sql: `CREATE TABLE public.should_not_exist (id int); SELECT 1 / 0;` });
  await assert.rejects(runMigration(url, failed), /division by zero/);
  assert.equal((await pool.query("SELECT to_regclass('public.should_not_exist') AS name")).rows[0].name, null);
  assert.equal((await readLedger(url, name)).entries.length, 0);
  const page = await readMigrationTimeline(url, name, {});
  assert.equal(page.events[0].kind, "failed");
  assert.match(page.events[0].error!, /division by zero/);
  assert.equal((await readMigrationTimelineDetail(url, name, failed.runId!)).sql, failed.sql);
});

test("manual marks and adoption are distinct from execution, with adoption recorded only once", async () => {
  const name = schema();
  await runMigration(url, request(name, { recordOnly: true, sql: "INVALID SQL MUST NOT RUN" }));
  await runMigration(url, request(name, { recordOnly: true, direction: "revert", sql: "" }));
  const adopt = { ledgerSchema: name, entries: [{ setName: "accounts", version: "0002", name: "Imported", checksum: "x", applySql: "NOT EXECUTED" }] };
  assert.equal((await adoptMigrations(url, adopt)).recorded, 1);
  assert.equal((await adoptMigrations(url, adopt)).existing, 1);
  assert.deepEqual((await readMigrationTimeline(url, name, {})).events.map((e) => e.kind), ["marked", "unmarked", "marked"]);
});

test("upgrading the ledger preserves its old SQL before overwrite, once", async () => {
  const name = schema();
  await pool.query(`CREATE SCHEMA ${name}; CREATE TABLE ${name}.ytdb_migrations (
    version text PRIMARY KEY, name text, checksum text, set_name text,
    applied_at timestamptz DEFAULT now(), duration_ms integer, applied_by text, apply_sql text, revert_sql text
  ); INSERT INTO ${name}.ytdb_migrations(version,name,checksum,set_name,apply_sql) VALUES ('0001','Old','old','accounts','SELECT 123');`);
  await runMigration(url, request(name));
  await runMigration(url, request(name));
  const events = (await readMigrationTimeline(url, name, {})).events;
  assert.deepEqual(events.map((e) => e.kind), ["applied", "applied", "legacy"]);
  assert.equal((await readMigrationTimelineDetail(url, name, events[2].id)).sql, "SELECT 123");
});

test("old ledgers without SQL columns upgrade without inventing an SQL snapshot", async () => {
  const name = schema();
  await pool.query(`CREATE SCHEMA ${name}; CREATE TABLE ${name}.ytdb_migrations (
    version text PRIMARY KEY, name text, checksum text, set_name text,
    applied_at timestamptz DEFAULT now(), duration_ms integer, applied_by text
  ); INSERT INTO ${name}.ytdb_migrations(version,name,checksum,set_name) VALUES ('0001','Old','old','accounts');`);
  await runMigration(url, request(name));
  const events = (await readMigrationTimeline(url, name, {})).events;
  assert.equal(events[1].kind, "legacy");
  assert.equal((await readMigrationTimelineDetail(url, name, events[1].id)).sql, null);
});

test("simultaneous first use from teammates initializes one shared timeline", async () => {
  const name = schema();
  await Promise.all([runMigration(url, request(name)), runMigration(url, request(name, { version: "0002" }))]);
  assert.equal((await readMigrationTimeline(url, name, {})).events.length, 2);
});

test("duplicate attempt IDs cannot execute SQL a second time", async () => {
  const name = schema();
  const run = request(name);
  await runMigration(url, run);
  await assert.rejects(runMigration(url, run), /duplicate key/);
  assert.equal((await readMigrationTimeline(url, name, {})).events.length, 1);
});

test("non-atomic partial failures and disconnected sessions remain unconfirmed", async () => {
  const name = schema();
  await assert.rejects(runMigration(url, request(name, {
    sql: `BEGIN; CREATE TABLE public.partially_applied (id int); COMMIT; SELECT 1 / 0;`,
  })), /division by zero/);
  assert.equal((await readMigrationTimeline(url, name, {})).events[0].kind, "uncertain");
  assert.equal((await pool.query("SELECT to_regclass('public.partially_applied') AS name")).rows[0].name, "partially_applied");
  await assert.rejects(runMigration(url, request(name, { sql: "SELECT pg_terminate_backend(pg_backend_pid());" })));
  assert.equal((await readMigrationTimeline(url, name, {})).events[0].kind, "uncertain");
});

test("committed starts are visible before a migration reports its outcome", async () => {
  const name = schema();
  await runMigration(url, request(name));
  const client = await migrationPool.connect();
  try { await startTimelineEvent(client, name, request(name), true); } finally { client.release(); }
  const event = (await readMigrationTimeline(url, name, {})).events[0];
  assert.equal(event.kind, "uncertain");
  assert.equal(event.finishedAt, null);
});

test("pagination and filters scope correctly without SQL bodies or duplicate events", async () => {
  const name = schema();
  const entries = Array.from({ length: 65 }, (_, index) => ({ setName: index < 60 ? "accounts" : "other", version: String(index), name: `Change ${index}`, checksum: "x", applySql: "SELECT 1" }));
  await adoptMigrations(url, { ledgerSchema: name, entries });
  const page = await readMigrationTimeline(url, name, { setName: "accounts" });
  assert.equal(page.events.length, 50);
  const older = await readMigrationTimeline(url, name, { setName: "accounts", before: page.nextCursor! });
  assert.equal(older.events.length, 10);
  assert.equal(older.nextCursor, null);
  assert.equal(new Set([...page.events, ...older.events].map((e) => e.id)).size, 60);
  assert.equal((await readMigrationTimeline(url, name, { setName: "other", kind: "marked" })).events.length, 5);
  assert.equal((await readMigrationTimeline(url, name, { kind: "failed" })).events.length, 0);
  assert.equal((await readMigrationTimeline(url, name, { query: "Change 64" })).events.length, 1);
  assert.equal((await readMigrationTimeline(url, name, { query: "' OR true --" })).events.length, 0);
});

test("a browser's previous apply cannot hide a teammate's later ledger entry", () => {
  const connection = { id: "dev", name: "Dev", url: "unused" };
  const events = buildHistory([{ connection, ledger: { initialized: true, schema: "maintenance", entries: [{ version: "1", name: "change", checksum: "new", setName: "app", appliedAt: "2026-09-11T12:00:00Z", durationMs: 10, appliedBy: "coworker" }] } }], [{
    id: "local", setId: "app", setName: "app", connectionId: "dev", connectionName: "Dev", version: "1", name: "change", direction: "apply", status: "ok", durationMs: 10, ranAt: Date.parse("2026-09-11T11:00:00Z"),
  }]);
  assert.equal(events.length, 2);
  assert.equal(events[0].appliedBy, "coworker");
});
