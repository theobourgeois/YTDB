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
};

/** One row of a database's ledger table: a migration that database has run. */
export type LedgerEntry = {
  version: string;
  name: string;
  checksum: string;
  setName: string | null;
  appliedAt: string;
  durationMs: number | null;
  appliedBy: string | null;
};

export type LedgerResult = {
  /** False when the ledger table does not exist: nothing has ever been run here. */
  initialized: boolean;
  /** The schema the ledger was actually found in, which may not be the configured one. */
  schema: string;
  entries: LedgerEntry[];
};

export type MigrationRequest = {
  direction: MigrationDirection;
  version: string;
  name: string;
  checksum: string;
  setName: string;
  sql: string;
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
