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
- Import or export your workspace configuration
- Choose from six built-in themes

![YTDB's new connection dialog](public/screenshots/ytdb-connection.png)

## Jump to any table

Press <kbd>⌘</kbd>+<kbd>P</kbd> on macOS or <kbd>Ctrl</kbd>+<kbd>P</kbd> elsewhere to search across tables and saved connections. Type a table name to filter, then press <kbd>Enter</kbd> to open it.

![YTDB's Command P table palette filtering to products](public/screenshots/ytdb-command-palette.png)

The screenshots use a disposable local database with fictional product and company names. No production data or credentials are included in this repository.

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
  `related`, `lookup`, `definition`, or a browser-only action (`connection.add`, `connection.update`,
  `connection.remove`, `config.export`, `config.import`).
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
    explorer/                    schemas, tables, and navigation
    table/                       grid, filters, editors, and pagination
  lib/
    activity/                    local action log
    db/                          server-only PostgreSQL access
    store/                       persisted browser state
  hooks/                         shared React hooks
scripts/                         local activity-log reader
bin/                             `npx @theobourgeois/ytdb` launcher
convex/                          optional Convex scaffold
```

## Tech stack

[Next.js 16](https://nextjs.org/) · [React 19](https://react.dev/) · [PostgreSQL](https://www.postgresql.org/) · [Tailwind CSS 4](https://tailwindcss.com/) · [Base UI](https://base-ui.com/) · [Zustand](https://zustand.docs.pmnd.rs/) · [Convex](https://www.convex.dev/)
