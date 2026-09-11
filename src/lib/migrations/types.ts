import { quoteIdent } from "../identifiers";
import type { TransactionMode } from "./sql";

/**
 * Where each database records the migrations it has run. Bookkeeping does not
 * belong in `public` beside the application's own tables, so it lives in its own
 * schema, created on the first apply.
 */
export const DEFAULT_LEDGER_SCHEMA = "maintenance";
export const LEDGER_TABLE = "ytdb_migrations";

/**
 * Schema names are interpolated into DDL, so only plain identifiers are accepted —
 * quoted as well, but a name that needs quoting to be legal is refused outright.
 */
export function isLedgerSchema(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 63 &&
    /^[A-Za-z_][A-Za-z0-9_$]*$/.test(value)
  );
}

export function ledgerSchemaOrDefault(value: unknown): string {
  return isLedgerSchema(value) ? value : DEFAULT_LEDGER_SCHEMA;
}

/**
 * `"maintenance"."ytdb_migrations"` — safe to interpolate into a statement, and
 * the same form `to_regclass` takes as text.
 */
export function ledgerTable(schema: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(LEDGER_TABLE)}`;
}

export type MigrationDirection = "apply" | "revert";

export type MigrationStep = {
  /** Sort key taken from the filename: `0007`, `20240110120000`, or the whole basename. */
  version: string;
  /** The filename with its version prefix and extension removed. */
  name: string;
  applyPath: string;
  applySql: string;
  /** Fingerprint of `applySql`, used to notice a file edited after it ran somewhere. */
  checksum: string;
  revertPath?: string;
  revertSql?: string;
  /** How the apply file's own transaction control is handled. */
  transaction: TransactionMode;
};

export type MigrationSet = {
  id: string;
  name: string;
  importedAt: number;
  steps: MigrationStep[];
  /** Files that were read but could not be placed, with the reason. */
  skipped: string[];
  /**
   * Whatever the author wants the next person to know before running it — the
   * order to go in, what to deploy in between. For a folder, the README beside the SQL.
   */
  note?: string;
  /**
   * Where on disk this set was read from, when it came from a migrations folder
   * rather than an import. Such a set is re-read on every visit and never edited
   * here, bar its note, which is written back to the folder so it travels with the branch.
   */
  source?: { root: string; path: string; notePath?: string };
};

/** Longest note kept; a note is a few lines on how to run something, not documentation. */
export const MAX_NOTE_LENGTH = 20_000;

/** What the note in a migrations folder says after a write; null once it is removed. */
export type NoteResult = { note: string | null; notePath: string | null };

/** Prefix of the id a folder-backed set gets, so a page can tell it from an imported one. */
export const REPO_SET_ID_PREFIX = "repo:";

export function repoSetId(name: string): string {
  return `${REPO_SET_ID_PREFIX}${name}`;
}

export function isRepoSetId(id: string): boolean {
  return id.startsWith(REPO_SET_ID_PREFIX);
}

/**
 * One checkout of the repository the migrations folder is in — the main one or a
 * git worktree — that has the same folder at the same place inside it.
 */
export type RepoCheckout = {
  /** The checkout's top folder. */
  path: string;
  /** The branch it has checked out, or the short commit when it is detached. */
  branch: string;
  /** True for the repository's main checkout rather than a worktree. */
  main: boolean;
};

/** What the local bridge found in a migrations folder. */
export type RepoRead = {
  /** The folder actually read, `~` expanded — inside the picked checkout, when there is one. */
  root: string;
  sets: MigrationSet[];
  /** Files at the root that were read but could not be placed. */
  skipped: string[];
  /** The checkout the folder sits in, when it is inside a git repository. */
  git: { branch: string; commit: string; dirty: boolean } | null;
  /** Every checkout that has this folder, main first; empty outside git. */
  checkouts: RepoCheckout[];
  /** Top folder of the checkout that was read, one of `checkouts`. */
  checkout: string | null;
};

/** One ledger row to write without running anything, when adopting a folder wholesale. */
export type AdoptEntry = {
  setName: string;
  version: string;
  name: string;
  checksum: string;
  applySql: string;
  revertSql?: string;
};

export type AdoptRequest = {
  ledgerSchema: string;
  entries: AdoptEntry[];
};

export type AdoptResult = {
  /** Rows written. Rows already in the ledger are left as they were and not counted. */
  recorded: number;
  /** Rows that were already there. */
  existing: number;
};

/**
 * One row of a database's ledger table: a migration that database has run.
 *
 * A row is identified by its set and its version together: every folder numbers
 * its files from 0001, so the version alone says nothing about which migration ran.
 */
export type LedgerEntry = {
  version: string;
  name: string;
  checksum: string;
  /** The set this row belongs to. Empty for rows written before sets were part of the key. */
  setName: string;
  appliedAt: string;
  durationMs: number | null;
  appliedBy: string | null;
  /** The SQL that ran, kept so the migration can be rebuilt without the files. */
  applySql?: string;
  /** What would undo it, as it stood when it was applied. */
  revertSql?: string;
};

export type LedgerResult = {
  /** False when the ledger table does not exist: nothing has ever been run here. */
  initialized: boolean;
  /** The schema the ledger was actually found in, which may not be the configured one. */
  schema: string;
  /**
   * True when the rows carry their stored SQL. Absent from a bridge too old to
   * know about it — which is how a page newer than the local install is spotted.
   */
  withSql?: boolean;
  entries: LedgerEntry[];
};

export type MigrationRequest = {
  direction: MigrationDirection;
  version: string;
  name: string;
  checksum: string;
  setName: string;
  sql: string;
  /**
   * Stored alongside an apply so the migration can be undone from a machine that
   * never had the files.
   */
  revertSql?: string;
  /** Schema the ledger lives in; an existing ledger elsewhere wins over it. */
  ledgerSchema: string;
  /**
   * Writes the ledger row without running the SQL, for a database that already has
   * the change — the only way to adopt a schema that was migrated by hand.
   */
  recordOnly?: boolean;
};

export type MigrationResult = {
  version: string;
  direction: MigrationDirection;
  durationMs: number;
  statements: number;
  /** When the ledger recorded the apply; null for a revert, which removes the row. */
  appliedAt: string | null;
};

/**
 * What one database has done with one migration.
 *
 * `drifted` means the ledger has it but the file's checksum no longer matches —
 * the file was edited after it ran, so the two are no longer the same migration.
 */
export type StepStatus = "applied" | "drifted" | "pending" | "unknown";
