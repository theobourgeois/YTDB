# YTDB

A fast, local-first PostgreSQL browser for exploring and editing databases without leaving the keyboard.

![YTDB browsing a fictional products table](public/screenshots/ytdb-explorer.png)

## What it does

- Browse tables and views across multiple PostgreSQL schemas
- Search, filter, sort, and paginate rows
- Edit cells inline and delete selected rows
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

Once the package is published, start YTDB without cloning the repository:

```bash
npx ytdb
```

The command starts an authenticated database bridge bound to `127.0.0.1` and opens
[ytdb.theobourgeois.com](https://ytdb.theobourgeois.com). Select **New**, then enter a name and PostgreSQL connection URL:

```text
postgresql://user:password@host:5432/database
```

The hosted UI talks directly to that loopback-only bridge. Its random session token is passed
in a URL fragment, which is never sent to the hosted server. Closing the command stops access.

To work on YTDB itself:

```bash
git clone https://github.com/theobourgeois/YTDB.git
cd YTDB
npm install
npm run dev
```

Open [http://127.0.0.1:4371](http://127.0.0.1:4371). No administrator-level hostname setup is required.

## Useful commands

```bash
npm run dev          # development server on 127.0.0.1:4371
npm run build        # production build
npm start            # serve the production build
npm run lint         # ESLint
npm pack --dry-run   # inspect the publishable npx package
npm run dev:convex   # optional Convex development process
```

## Security model

The UI is hosted, but PostgreSQL access is performed by the loopback-only process started by `npx ytdb`.

- Connection URLs are stored in browser `localStorage` for `ytdb.theobourgeois.com`.
- Each database request goes directly from the hosted UI to `127.0.0.1`; the public deployment refuses database API requests.
- The bridge accepts only the official UI origin and requests with its per-process random token.
- A restrictive Content Security Policy blocks unapproved scripts and network destinations.
- Exported YTDB configuration files include connection URLs. Treat those files like passwords and never commit them.
- The app supports writes and row deletion. Use a read-only or least-privilege PostgreSQL role when you do not need editing.
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
    db/                          server-only PostgreSQL access
    store/                       persisted browser state
  hooks/                         shared React hooks
bin/                             `npx ytdb` launcher
convex/                          optional Convex scaffold
```

## Tech stack

[Next.js 16](https://nextjs.org/) · [React 19](https://react.dev/) · [PostgreSQL](https://www.postgresql.org/) · [Tailwind CSS 4](https://tailwindcss.com/) · [Base UI](https://base-ui.com/) · [Zustand](https://zustand.docs.pmnd.rs/) · [Convex](https://www.convex.dev/)
