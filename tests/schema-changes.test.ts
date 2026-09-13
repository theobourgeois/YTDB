import { test } from "node:test";
import assert from "node:assert/strict";
import { describeChanges, type Part, type SchemaChanges, type Subject } from "../src/lib/migrations/changes";

const one = (sql: string) => describeChanges([{ version: "1", sql }]);

function subject(changes: SchemaChanges, name: string): Subject {
  const found = changes.subjects.find((item) => item.name === name);
  assert.ok(found, `no subject ${name} in ${JSON.stringify(changes.subjects.map((item) => item.name))}`);
  return found;
}

function parts(item: Subject): string[] {
  return item.parts.map((part: Part) =>
    [part.op, part.kind, part.from ? `${part.from}->${part.name}` : part.name, part.detail].filter(Boolean).join(" "),
  );
}

test("a new table lists its columns with types and inline constraints", () => {
  const changes = one(`
    CREATE TABLE IF NOT EXISTS public.orders (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE SET NULL,
      total NUMERIC(10,2) DEFAULT 0 CHECK (total >= 0),
      note text DEFAULT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      "Weird Name" text[],
      CONSTRAINT orders_total_positive CHECK (total > 0),
      UNIQUE (user_id, created_at)
    );
  `);
  const orders = subject(changes, "orders");
  assert.equal(orders.kind, "table");
  assert.equal(orders.effect, "created");
  assert.deepEqual(parts(orders), [
    "add column id bigint · identity · primary key",
    "add column user_id uuid · not null · → users.id on delete set null",
    "add column total numeric(10, 2) · default 0 · check (total >= 0)",
    "add column note text · default null",
    "add column created_at timestamptz · not null · default now()",
    'add column Weird Name text[]',
    "add constraint orders_total_positive check (total > 0)",
    "add constraint orders_user_id_created_at_key unique (user_id, created_at)",
  ]);
});

test("temporary tables leave nothing behind", () => {
  assert.deepEqual(one("CREATE TEMP TABLE scratch (id int); CREATE TEMPORARY TABLE x AS SELECT 1;"), {
    subjects: [],
    other: [],
  });
});

test("alter table actions each become a change on that table", () => {
  const changes = one(`
    ALTER TABLE users
      ADD COLUMN avatar_url text,
      ADD COLUMN IF NOT EXISTS age int NOT NULL DEFAULT 0,
      ALTER COLUMN email SET NOT NULL,
      ALTER COLUMN name TYPE varchar(200) USING name::varchar(200),
      ALTER COLUMN bio DROP DEFAULT,
      DROP COLUMN legacy,
      ADD CONSTRAINT users_email_key UNIQUE (email),
      DROP CONSTRAINT IF EXISTS users_old_check;
    ALTER TABLE users RENAME COLUMN fullname TO full_name;
    ALTER TABLE users ENABLE ROW LEVEL SECURITY;
  `);
  const users = subject(changes, "users");
  assert.equal(users.effect, "altered");
  assert.deepEqual(parts(users), [
    "add column avatar_url text",
    "add column age int · not null · default 0",
    "change column email set not null",
    "change column name type varchar(200)",
    "change column bio drop default",
    "drop column legacy",
    "add constraint users_email_key unique (email)",
    "drop constraint users_old_check",
    "rename column fullname->full_name",
    "change setting row level security enabled",
  ]);
});

test("a table-level foreign key keeps its target and actions", () => {
  const changes = one(`ALTER TABLE ONLY orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE NOT VALID;`);
  assert.deepEqual(parts(subject(changes, "orders")), [
    "add constraint fk_user (user_id) → auth.users(id) on delete cascade · not valid",
  ]);
});

test("indexes, triggers and policies are listed on their table", () => {
  const changes = one(`
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS users_email_idx ON public.users USING btree (lower(email)) WHERE deleted_at IS NULL;
    CREATE INDEX ON users (created_at DESC);
    CREATE TRIGGER set_updated BEFORE INSERT OR UPDATE OF name, email ON users FOR EACH ROW EXECUTE FUNCTION touch();
    CREATE POLICY "own rows" ON users AS PERMISSIVE FOR SELECT TO authenticated USING (auth.uid() = id);
  `);
  assert.deepEqual(parts(subject(changes, "users")), [
    "add index users_email_idx unique (lower(email)) · where deleted_at is null",
    "add index users_created_at_idx (created_at desc)",
    "add trigger set_updated before insert or update of name, email · each row → touch()",
    "add policy own rows for select · to authenticated · using (auth.uid() = id)",
  ]);
});

test("functions carry their signature, and overloads stay apart", () => {
  const changes = one(`
    CREATE OR REPLACE FUNCTION public.calc_total(p_order uuid, p_tax numeric DEFAULT 0) RETURNS numeric
      LANGUAGE plpgsql AS $$ BEGIN RETURN 1; END; $$;
    CREATE FUNCTION calc_total(p_order text) RETURNS numeric AS 'select 1' LANGUAGE sql;
    CREATE PROCEDURE app.cleanup() LANGUAGE sql AS $$ DELETE FROM t; $$;
  `);
  const totals = changes.subjects.filter((item) => item.name === "calc_total");
  assert.equal(totals.length, 2);
  assert.equal(totals[0].effect, "replaced");
  assert.equal(totals[0].detail, "(p_order uuid, p_tax numeric default 0) → numeric");
  assert.equal(totals[1].effect, "created");
  const cleanup = subject(changes, "cleanup");
  assert.equal(cleanup.kind, "procedure");
  assert.equal(cleanup.schema, "app");
  // The DELETE inside the body is the procedure's, not the migration's.
  assert.equal(changes.subjects.length, 3);
  assert.deepEqual(changes.other, []);
});

test("dropping a function matches it by argument types", () => {
  const changes = describeChanges([
    { version: "1", sql: "CREATE FUNCTION f(a integer) RETURNS int AS $$ select 1 $$ LANGUAGE sql;" },
    { version: "2", sql: "DROP FUNCTION f(int4);" },
  ]);
  assert.deepEqual(changes.subjects, []);
});

test("enums: values added, renamed, and created with the type", () => {
  const changes = one(`
    CREATE TYPE status AS ENUM ('draft', 'live');
    ALTER TYPE status ADD VALUE IF NOT EXISTS 'archived' AFTER 'live';
    ALTER TYPE mood RENAME VALUE 'sad' TO 'blue';
  `);
  assert.deepEqual(parts(subject(changes, "status")), [
    "add value draft",
    "add value live",
    "add value archived after 'live'",
  ]);
  const mood = subject(changes, "mood");
  assert.equal(mood.kind, "enum");
  assert.deepEqual(parts(mood), ["rename value sad->blue"]);
});

test("changes across migrations fold into their net effect", () => {
  const changes = describeChanges([
    { version: "0001", sql: "CREATE TABLE accounts (id int PRIMARY KEY, email text UNIQUE, nickname text);" },
    {
      version: "0002",
      sql: `ALTER TABLE accounts ADD COLUMN plan text;
            ALTER TABLE accounts ALTER COLUMN email SET NOT NULL;
            ALTER TABLE accounts RENAME COLUMN nickname TO handle;
            ALTER TABLE accounts DROP CONSTRAINT accounts_email_key;`,
    },
    { version: "0003", sql: "ALTER TABLE accounts DROP COLUMN plan; ALTER TABLE accounts ALTER COLUMN handle TYPE varchar(40);" },
    { version: "0004", sql: "ALTER TABLE accounts RENAME TO members; CREATE TABLE scratch (x int); DROP TABLE scratch;" },
  ]);
  assert.equal(changes.subjects.length, 1);
  const members = subject(changes, "members");
  assert.equal(members.effect, "created");
  assert.equal(members.from, undefined);
  assert.deepEqual(parts(members), [
    "add column id int · primary key",
    "add column email text · not null",
    "add column handle varchar(40)",
  ]);
  assert.deepEqual(members.versions, ["0001", "0002", "0003", "0004"]);
  const handle = members.parts.find((part) => part.name === "handle")!;
  assert.deepEqual(handle.versions, ["0001", "0002", "0003"]);
});

test("changes to an existing table fold too", () => {
  const changes = describeChanges([
    { version: "1", sql: "ALTER TABLE t ADD COLUMN a int; ALTER TABLE t ALTER COLUMN b SET NOT NULL;" },
    { version: "2", sql: "ALTER TABLE t DROP COLUMN a; ALTER TABLE t ALTER COLUMN b TYPE bigint; ALTER TABLE t RENAME COLUMN b TO c;" },
  ]);
  assert.deepEqual(parts(subject(changes, "t")), ["rename column b->c set not null · type bigint"]);
});

test("a rename and a move of an existing table are remembered", () => {
  const changes = one("ALTER TABLE old_name RENAME TO new_name; ALTER TABLE new_name SET SCHEMA archive;");
  const moved = subject(changes, "new_name");
  assert.equal(moved.schema, "archive");
  assert.deepEqual(moved.from, { schema: "public", name: "old_name" });
});

test("dropping several things at once", () => {
  const changes = one(`
    DROP TABLE IF EXISTS a, b CASCADE;
    DROP VIEW v;
    DROP INDEX CONCURRENTLY IF EXISTS some_idx;
    DROP TRIGGER t1 ON b2;
    DROP EXTENSION IF EXISTS "uuid-ossp";
  `);
  assert.deepEqual(
    changes.subjects.map((item) => `${item.effect} ${item.kind} ${item.name}`),
    [
      "dropped table a",
      "dropped table b",
      "dropped view v",
      "dropped index some_idx",
      "altered table b2",
      "dropped extension uuid-ossp",
    ],
  );
  assert.deepEqual(parts(subject(changes, "b2")), ["drop trigger t1"]);
});

test("an index created and dropped in the same migration cancels out", () => {
  const changes = describeChanges([
    { version: "1", sql: "CREATE INDEX idx_a ON t (a);" },
    { version: "2", sql: "DROP INDEX idx_a;" },
  ]);
  assert.deepEqual(changes.subjects, []);
});

test("search_path decides where unqualified names go", () => {
  const changes = one("SET search_path TO app, public; CREATE TABLE widgets (id int);");
  assert.equal(subject(changes, "widgets").schema, "app");
});

test("DO blocks are read through their control flow", () => {
  const changes = one(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'role') THEN
        CREATE TYPE role AS ENUM ('admin', 'member');
      END IF;
      EXECUTE 'ALTER TABLE users ADD COLUMN role role';
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  assert.deepEqual(parts(subject(changes, "role")), ["add value admin", "add value member"]);
  assert.deepEqual(parts(subject(changes, "users")), ["add column role role"]);
  assert.deepEqual(changes.other, []);
});

test("a DO block with nothing recognisable is listed, not lost", () => {
  const changes = one("DO $$ BEGIN PERFORM do_something(); END $$;");
  assert.equal(changes.other.length, 1);
  assert.match(changes.other[0].text, /^do /);
});

test("data changes are counted per table", () => {
  const changes = one(`
    INSERT INTO plans (name) VALUES ('free');
    INSERT INTO plans (name) VALUES ('pro');
    WITH stale AS (SELECT id FROM users WHERE x) UPDATE users SET active = false WHERE id IN (SELECT id FROM stale);
    DELETE FROM ONLY sessions;
    TRUNCATE TABLE a, b RESTART IDENTITY;
  `);
  assert.deepEqual(parts(subject(changes, "plans")), ["change rows insert ×2"]);
  assert.deepEqual(parts(subject(changes, "users")), ["change rows update"]);
  assert.deepEqual(parts(subject(changes, "sessions")), ["change rows delete"]);
  assert.deepEqual(parts(subject(changes, "b")), ["change rows truncate"]);
});

test("comments and grants attach to what they are about", () => {
  const changes = one(`
    COMMENT ON COLUMN public.users.email IS 'Login, unique';
    COMMENT ON TABLE users IS NULL;
    GRANT SELECT, INSERT ON TABLE users, orders TO app_user;
    REVOKE ALL ON SCHEMA private FROM public;
    GRANT app_admin TO theo;
  `);
  assert.deepEqual(parts(subject(changes, "users")), [
    "add comment email Login, unique",
    "drop comment removed",
    "add grant app_user select, insert",
  ]);
  assert.deepEqual(parts(subject(changes, "private")), ["drop grant public all"]);
  assert.deepEqual(changes.other.map((item) => item.text), ["grant app_admin to theo"]);
});

test("statements it cannot read are kept as written", () => {
  const changes = one("SELECT cron.schedule('nightly', '0 3 * * *', 'VACUUM');\nCREATE AGGREGATE my_sum (int) (sfunc = int4pl, stype = int);");
  assert.equal(changes.other.length, 2);
  assert.match(changes.other[0].text, /^select cron\.schedule\('nightly'/);
});

test("comments, strings, and transaction control are not mistaken for changes", () => {
  const changes = one(`
    BEGIN;
    -- CREATE TABLE commented_out (id int);
    /* DROP TABLE users; /* nested */ still a comment; */
    SET LOCAL statement_timeout = '5s';
    ALTER TABLE t ADD COLUMN note text DEFAULT 'a; DROP TABLE t; --';
    COMMIT;
  `);
  assert.deepEqual(changes.subjects.map((item) => item.name), ["t"]);
  assert.deepEqual(parts(subject(changes, "t")), ["add column note text · default 'a; DROP TABLE t; --'"]);
  assert.deepEqual(changes.other, []);
});

test("pg_dump output reads cleanly", () => {
  const changes = one(`
    SELECT pg_catalog.set_config('search_path', '', false);
    \\connect app
    CREATE SEQUENCE public.users_id_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
    ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;
    SELECT pg_catalog.setval('public.users_id_seq', 42, true);
    ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);
  `);
  assert.deepEqual(changes.other, []);
  const sequence = subject(changes, "users_id_seq");
  assert.equal(sequence.effect, "created");
  assert.deepEqual(parts(sequence), ["change setting owned by public.users.id", "change setting value 42"]);
  assert.deepEqual(parts(subject(changes, "users")), ["change column id default nextval('public.users_id_seq'::regclass)"]);
});

test("views name the tables they read", () => {
  const changes = one(`
    CREATE OR REPLACE VIEW active_users AS
      WITH recent AS (SELECT user_id FROM sessions)
      SELECT u.*, extract(epoch FROM u.created_at) FROM users u JOIN recent r ON r.user_id = u.id;
    CREATE MATERIALIZED VIEW stats AS SELECT count(*) FROM analytics.events;
  `);
  const view = subject(changes, "active_users");
  assert.equal(view.effect, "replaced");
  assert.equal(view.detail, "from users");
  const stats = subject(changes, "stats");
  assert.equal(stats.kind, "materialized-view");
  assert.equal(stats.detail, "from analytics.events");
});

test("self-wrapped files, constraint drops of inline constraints, and domains", () => {
  const changes = describeChanges([
    { version: "1", sql: "BEGIN; CREATE TABLE a (id int PRIMARY KEY, code text UNIQUE); COMMIT;" },
    { version: "2", sql: "ALTER TABLE a DROP CONSTRAINT a_code_key; CREATE DOMAIN email AS citext CHECK (VALUE ~ '@');" },
  ]);
  assert.deepEqual(parts(subject(changes, "a")), ["add column id int · primary key", "add column code text"]);
  assert.equal(subject(changes, "email").detail, "citext · check (value ~ '@')");
});

test("unnamed constraints get the names PostgreSQL gives them", () => {
  // Checked against PostgreSQL 16: table-level checks are named for the table and numbered.
  const changes = one(`
    CREATE TABLE orders (id int, a int, b int, total numeric CHECK (total >= 0),
      PRIMARY KEY (id), FOREIGN KEY (a) REFERENCES users(id), CHECK (b > a), CHECK (1 = 1));
    CREATE INDEX ON orders ((a + b));
    CREATE INDEX ON orders (a, b);
    ALTER TABLE orders DROP CONSTRAINT orders_check1;
  `);
  assert.deepEqual(parts(subject(changes, "orders")).filter((line) => !line.includes(" column ")), [
    "add constraint orders_pkey primary key (id)",
    "add constraint orders_a_fkey (a) → users(id)",
    "add constraint orders_check check (b > a)",
    "add index orders_expr_idx ((a + b))",
    "add index orders_a_b_idx (a, b)",
  ]);
});
