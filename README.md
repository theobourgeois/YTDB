# YTDB

A fast, local-first PostgreSQL browser for exploring and editing databases without leaving the keyboard.

![YTDB browsing a fictional products table](public/screenshots/ytdb-explorer.png)

## What it does

- Browse tables and views across multiple PostgreSQL schemas
- Run read-only SQL queries with capped results and searchable local history
- Search, filter, sort, and paginate rows
- Edit cells inline, insert new rows, and delete selected rows
- Follow foreign keys, inspect related records, and peek at complete rows
- Pin, hide, reorder, and resize columns
- Export the current result set as CSV or JSON
- View table and view definitions
- Switch between multiple saved connections and share layouts between them
- Compare two connections' schemas and generate the migration SQL that closes the gap
- Import a folder of migrations and apply or revert them one at a time or all at once, with each
  environment's history recorded in the database itself
- Import or export your workspace configuration
- Choose from six built-in themes

![YTDB's new connection dialog](public/screenshots/ytdb-connection.png)

## Jump to any table

Press <kbd>⌘</kbd>+<kbd>P</kbd> on macOS or <kbd>Ctrl</kbd>+<kbd>P</kbd> elsewhere to search across tables and saved connections. Type a table name to filter, then press <kbd>Enter</kbd> to open it.

![YTDB's Command P table palette filtering to products](public/screenshots/ytdb-command-palette.png)

The screenshots use a disposable local database with fictional product and company names. No production data or credentials are included in this repository.

## Compare two databases

Open **Compare schema** in a connection's sidebar (<kbd>⌘</kbd>+<kbd>⇧</kbd>+<kbd>D</kbd>) to diff it
against another saved connection — dev against prod, say. Connections that already share a layout are
offered first, since those are the same database in another environment.

The **Changes** pane lists every table, column, index, constraint, trigger, view, enum, function,
extension, and schema that differs, and the **Migration SQL** pane writes the DDL that would bring the
other database in line. Nothing is ever executed from here: copy the script into whatever migration
tool the project already uses. DROP statements are withheld until you ask for them.

## Run a folder of migrations

Open **Migrations** in a connection's sidebar (<kbd>⌘</kbd>+<kbd>⇧</kbd>+<kbd>M</kbd>) and drop in
whatever you have. A flat folder of migrations is enough:

```text
migrations/
  0001_create_customers.sql
  0002_create_orders.sql
```

If you keep reverts, put them in a sibling folder and they pair up by the version each name starts
with, whatever the rest of the name says:

```text
shop-migrations/
  apply/    0001_create_customers.sql  0002_create_orders.sql
  revert/   0001_create_customers.sql  0002_create_orders.sql
```

`up/` and `down/` work as folder names too, as do `0002_create_orders.up.sql` / `.down.sql` suffixes
in a flat folder. **Reverts are optional** — a migration without one applies like any other, and only
Revert is unavailable for it.

Files do not have to arrive together. **Import** folds whatever you drop into the set that is open:
new versions are added, versions already there have their SQL refreshed, and a revert file finds the
migration it belongs to. So you can start a set from one folder, add a stray file later, and attach a
revert to a single migration from its `⋯` menu whenever you write one. **New empty set** in the set
menu starts one from nothing.

Nothing is appended into one script. Each migration runs on its own, in a transaction, together with
the row that records it — so a migration that fails halfway leaves the database and the ledger exactly
as they were.

One database at a time is the target, named in the header and in every button: **Running against dev**,
**Apply 6 to dev**. Its column in the list is the tinted one. Switching target is one click on another
environment's column, which opens that connection. **Apply** on a row runs everything still pending up
to and including it, so a target can never end up with a gap in the middle; the `⋯` menu has
*apply only this one* for the rare out-of-order case, and *revert back through here* going the other way.

### Which environments have which migrations

Each database keeps its own ledger in `maintenance.ytdb_migrations`, written as part of the same
transaction as the migration. Dev is not asked what prod has run — prod is. Connections
[sharing a layout](#compare-two-databases) are the same database in another environment, so their
ledgers are read side by side: every migration shows where it has landed and where it has not, and
the environment strip totals up how far behind each one is. A file edited after it was applied is
flagged as drifted rather than quietly counted as done, and rows in a database that have no file in
the folder are listed separately.

The ledger is only ever created by the first apply — schema included, so the connection needs
permission to create it. Reading the status of a production connection never writes to it.

**Ledger table** in the header menu moves it to another schema. The setting covers every connection,
since dev and prod comparing ledgers in different places would mean nothing. A database that already
keeps its ledger somewhere else goes on using it rather than being stranded by the change, and the
status line says where. Schema names must be plain identifiers.

### Adopting a database that was migrated by hand

A database whose schema is already up to date has no ledger, so every migration reads as pending and
applying them would fail on tables that already exist. **Mark as already applied** — on one row from
its `⋯` menu, or on everything pending from the header menu — writes the ledger rows without running
any SQL, which is how you baseline an existing dev or prod. **Mark as not applied** takes a row back
out of the ledger, again without touching the schema. Both say plainly in the confirmation that
nothing will run.

**History** is both records at once, newest first. Each database's ledger says what it has applied,
when, and under which role — including runs made from someone else's machine, since that record lives
in the database rather than in a browser. This browser's own log adds what a ledger cannot keep:
reverts, failures with their error, and rows written without running anything. A run in both is one
event, not two. Every run is also appended to the [activity log](#activity-log).

A file that already wraps itself in a single `BEGIN` … `COMMIT` — how most migration folders are
written — needs no changes. YTDB takes that transaction over so its own ledger write joins it, and
says nothing about it. A `BEGIN` inside a PL/pgSQL function body is left alone, as it should be.

Migrations that PostgreSQL refuses to run inside a transaction — `CREATE INDEX CONCURRENTLY`, say —
opt out with a directive on the first line:

```sql
-- ytdb:no-transaction
CREATE INDEX CONCURRENTLY orders_placed_at_idx ON orders (placed_at);
```

Those run unwrapped and are recorded straight after, so a failure partway through leaves work behind.
A file that commits more than once is treated the same way, since YTDB cannot join a transaction it
does not control. Both are labelled in the list and named in the confirmation before anything runs.

## Run YTDB

### Requirements

- Node.js 20.9 or newer
- npm
- A PostgreSQL database you can reach from your machine

Start YTDB without cloning the repository:

```bash
npx @theobourgeois/ytdb
```

Run that command outside a YTDB source checkout. Inside this repository, npm treats the local
package as already installed; use `npx --yes --package=@theobourgeois/ytdb@latest -- ytdb`
when you specifically want to test the published package from here.

The command starts an authenticated database bridge bound to `127.0.0.1` and opens
[ytdb.theobourgeois.com](https://ytdb.theobourgeois.com). Select **New**, then enter a
name and PostgreSQL connection URL:

```text
postgresql://user:password@host:5432/database
```

The hosted UI talks directly to that loopback-only bridge. The fragment in the URL contains
a random, per-process session token; URL fragments are not sent to the hosted server. Closing
the command stops database access and restarting it creates a new token.

To run the entire UI locally or work on YTDB itself:

```bash
git clone https://github.com/theobourgeois/YTDB.git
cd YTDB
npm install
npm run dev
```

Open [http://127.0.0.1:4371](http://127.0.0.1:4371). No environment variables or
administrator-level hostname setup are required. The Convex scaffold is optional and the UI
still runs when `NEXT_PUBLIC_CONVEX_URL` is unset.

## Activity log

Every action taken in YTDB is appended to a local JSONL log, so you can retrace what
happened while debugging, or mine the history later. Logs are written to
`.ytdb/activity/YYYY-MM-DD.jsonl` (one file per day, ignored by Git).

```bash
npm run log                        # last 50 actions
npm run log -- --follow            # stream actions as they happen
npm run log -- --errors            # only failures
npm run log -- --action query      # only SQL console runs
npm run log -- --slow 500          # only actions taking 500ms or more
npm run log -- --limit all --json  # the raw entries, for analysis
npm run log -- --help              # all options
```

Each line is one self-describing JSON object:

```json
{
  "v": 1,
  "id": "914c2716-d586-4f1b-bae3-d3785969e252",
  "ts": "2026-09-03T12:44:41.302Z",
  "source": "api",
  "action": "rows",
  "connection": "postgres://appuser@127.0.0.1:5432/shopdb",
  "status": "ok",
  "durationMs": 5,
  "params": { "query": { "table": { "schema": "public", "name": "widgets" } } },
  "result": { "rows": 3, "columns": 3, "total": 3 }
}
```

- `action` is one of `tables`, `rows`, `query`, `cell.update`, `rows.insert`, `rows.delete`,
  `related`, `lookup`, `definition`, `schema`, `ledger`, `migrate`, or a browser-only action
  (`connection.add`, `connection.update`, `connection.remove`, `config.export`, `config.import`,
  `migrations.import`, `migrations.remove`).
- `connection` keeps the user, host, and database so entries are attributable, but the
  password is always stripped before anything is written.
- `params` records the request that was made; `result` records counts, never row data, so
  the log never becomes a copy of your database.
- Payloads over 20 KB are stored as a truncated preview.

Set `YTDB_LOG=off` to disable logging, or `YTDB_LOG_DIR` to write elsewhere.
Logging is fire-and-forget: a failed write is reported once on the server console and never
fails the action it was recording.

## Useful commands

```bash
npm run dev          # development server on 127.0.0.1:4371
npm run build        # production build
npm start            # serve the production build
npm run lint         # ESLint
npm run log          # local activity log
npm pack --dry-run   # inspect the publishable npx package
npm run dev:convex   # optional Convex development process
```

## Security model

The UI is hosted, but all PostgreSQL access is performed by the loopback-only process started
by `npx @theobourgeois/ytdb`.

- Connection URLs are stored in your browser's `localStorage` for the
  `ytdb.theobourgeois.com` origin.
- SQL query drafts and history are also stored locally and are never sent to Convex.
- Each database request goes from the hosted UI to `127.0.0.1`, where the local bridge connects
  to PostgreSQL. The Vercel deployment refuses all database API requests.
- The bridge accepts only the official UI origin and requests bearing its random session token.
- The hosted page has no analytics or third-party scripts, and its Content Security Policy
  blocks scripts and network requests from unapproved origins.
- The query console runs one statement at a time inside a read-only transaction and returns at most 500 rows.
- The migration runner is not read-only: it runs whatever SQL the imported files contain, with the
  privileges of the connection you run it from, and creates the `maintenance` schema and its
  `ytdb_migrations` table on first use.
  Imported migration files are held in your browser and never leave your machine.
- Exported YTDB configuration files include connection URLs. Treat those files like passwords and never commit them.
- The app supports writes, row insertion, and row deletion. Use a read-only or least-privilege PostgreSQL role when you do not need editing.
- The activity log records the SQL you run and the parameters you send. It stays on your
  machine in `.ytdb/`, which Git ignores; treat it as sensitive and delete the directory
  to clear the history.
- `.env*` files remain ignored by Git, with only the blank `.env.example` template allowed into the repository.

## Project structure

```text
src/
  app/
    api/                         PostgreSQL route handlers
    [connectionId]/              database explorer routes
  components/
    connections/                 connection and config management
    diff/                        schema comparison between two connections
    explorer/                    schemas, tables, and navigation
    migrations/                  importing, running, and reverting migration folders
    table/                       grid, filters, editors, and pagination
  lib/
    activity/                    local action log
    db/                          server-only PostgreSQL access
    migrations/                  folder parsing, ledger comparison, run plans
    store/                       persisted browser state
    schema-diff.ts               structural comparison of two snapshots
    schema-migration.ts          DDL that brings one database in line with another
  hooks/                         shared React hooks
scripts/                         local activity-log reader
bin/                             `npx @theobourgeois/ytdb` launcher
convex/                          optional Convex scaffold
```

## Tech stack

[Next.js 16](https://nextjs.org/) · [React 19](https://react.dev/) · [PostgreSQL](https://www.postgresql.org/) · [Tailwind CSS 4](https://tailwindcss.com/) · [Base UI](https://base-ui.com/) · [Zustand](https://zustand.docs.pmnd.rs/) · [Convex](https://www.convex.dev/)
