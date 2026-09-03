# DB Studio

A fast, local-first PostgreSQL browser for exploring and editing databases without leaving the keyboard.

![DB Studio browsing a fictional products table](public/screenshots/db-studio-explorer.png)

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

![DB Studio's new connection dialog](public/screenshots/db-studio-connection.png)

The screenshots use a disposable local database with fictional product and company names. No production data or credentials are included in this repository.

## Run locally

### Requirements

- Node.js 20.9 or newer
- npm
- A PostgreSQL database you can reach from your machine

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:4371](http://127.0.0.1:4371), select **New**, and enter a name and PostgreSQL connection URL:

```text
postgresql://user:password@host:5432/database
```

No environment variables are required for the current feature set. The Convex scaffold is optional and the UI still runs when `NEXT_PUBLIC_CONVEX_URL` is unset.

### Optional friendly hostname on macOS

The included setup script maps `http://local.dbstudio` to the development server. It updates `/etc/hosts` and installs a small launch daemon, so macOS will ask for an administrator password.

```bash
npm run setup:local
npm run dev
```

Open [http://local.dbstudio](http://local.dbstudio). To remove the hostname and launch daemon later:

```bash
npm run setup:local -- --undo
```

## Useful commands

```bash
npm run dev          # development server on 127.0.0.1:4371
npm run build        # production build
npm start            # serve the production build
npm run lint         # ESLint
npm run dev:convex   # optional Convex development process
```

## Security model

DB Studio is intended to run on your own machine, not as a public hosted service.

- Connection URLs are stored in your browser's `localStorage`.
- Each database request sends the selected URL to your local Next.js server, which connects to PostgreSQL.
- Exported DB Studio configuration files include connection URLs. Treat those files like passwords and never commit them.
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
scripts/                         optional local.dbstudio setup
convex/                          optional Convex scaffold
```

## Tech stack

[Next.js 16](https://nextjs.org/) · [React 19](https://react.dev/) · [PostgreSQL](https://www.postgresql.org/) · [Tailwind CSS 4](https://tailwindcss.com/) · [Base UI](https://base-ui.com/) · [Zustand](https://zustand.docs.pmnd.rs/) · [Convex](https://www.convex.dev/)
