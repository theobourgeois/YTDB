import { compareVersions } from "./parse";
import type { Connection } from "../types";
import type { LedgerEntry, LedgerResult, MigrationSet, MigrationStep, StepStatus } from "./types";

export type SetSummary = {
  total: number;
  applied: number;
  drifted: number;
  pending: number;
  /** Ledger rows with no file in this set — run from somewhere else, or from an older folder. */
  foreign: number;
};

export type RunPlan = {
  steps: MigrationStep[];
  /** The step the plan stopped at, when it could not include everything asked for. */
  blockedBy: MigrationStep | null;
};

const EMPTY_PLAN: RunPlan = { steps: [], blockedBy: null };

/**
 * The part of a ledger that is about one set. Every folder numbers its files
 * from 0001, so a row only means something next to the set it was written for.
 * Everything below that takes a ledger expects one already scoped this way.
 */
export function scopeLedger(
  ledger: LedgerResult | null | undefined,
  setName: string,
): LedgerResult | null {
  if (!ledger) return null;
  return { ...ledger, entries: ledger.entries.filter((entry) => entry.setName === setName) };
}

function index(ledger: LedgerResult | null | undefined): Map<string, LedgerEntry> {
  const entries = new Map<string, LedgerEntry>();
  for (const entry of ledger?.entries ?? []) entries.set(entry.version, entry);
  return entries;
}

export function ledgerEntry(
  step: MigrationStep,
  ledger: LedgerResult | null | undefined,
): LedgerEntry | null {
  if (!ledger) return null;
  return ledger.entries.find((entry) => entry.version === step.version) ?? null;
}

/** Unknown while the ledger is still unread; a database with no ledger table has run nothing. */
export function stepStatus(
  step: MigrationStep,
  ledger: LedgerResult | null | undefined,
): StepStatus {
  if (!ledger) return "unknown";
  const entry = ledgerEntry(step, ledger);
  if (!entry) return "pending";
  // An empty stored checksum comes from a row this tool did not write, so trust the row.
  if (entry.checksum && entry.checksum !== step.checksum) return "drifted";
  return "applied";
}

/** Takes the whole ledger and scopes it to the set itself. */
export function summarize(
  set: MigrationSet | null,
  ledger: LedgerResult | null | undefined,
): SetSummary {
  const summary: SetSummary = { total: set?.steps.length ?? 0, applied: 0, drifted: 0, pending: 0, foreign: 0 };
  if (!set) return summary;
  const scoped = scopeLedger(ledger, set.name);
  for (const step of set.steps) {
    const status = stepStatus(step, scoped);
    if (status === "applied") summary.applied += 1;
    else if (status === "drifted") summary.drifted += 1;
    else if (status === "pending") summary.pending += 1;
  }
  summary.foreign = foreignEntries(set, scoped).length;
  return summary;
}

/** Rows of this set's ledger that the folder has no file for. Worth surfacing: the folder is out of date. */
export function foreignEntries(
  set: MigrationSet | null,
  ledger: LedgerResult | null | undefined,
): LedgerEntry[] {
  if (!ledger) return [];
  const known = new Set((set?.steps ?? []).map((step) => step.version));
  return ledger.entries
    .filter((entry) => !known.has(entry.version))
    .sort((a, b) => compareVersions(a.version, b.version));
}

/**
 * Everything not yet applied, oldest first, optionally stopping after `throughVersion`.
 * Drifted steps are left out: re-running an edited file is a repair, not a plan.
 */
export function applyPlan(
  set: MigrationSet | null,
  ledger: LedgerResult | null | undefined,
  throughVersion?: string,
): RunPlan {
  if (!set || !ledger) return EMPTY_PLAN;
  const steps: MigrationStep[] = [];
  for (const step of set.steps) {
    if (stepStatus(step, ledger) === "pending") steps.push(step);
    if (throughVersion !== undefined && step.version === throughVersion) break;
  }
  return { steps, blockedBy: null };
}

/**
 * Everything applied, newest first, stopping before `downToVersion` — which stays
 * applied — and stopping early at the first step with no revert file, since the
 * ones below it cannot be reached without skipping that one.
 */
export function revertPlan(
  set: MigrationSet | null,
  ledger: LedgerResult | null | undefined,
  downToVersion?: string,
): RunPlan {
  if (!set || !ledger) return EMPTY_PLAN;
  const applied = index(ledger);
  const steps: MigrationStep[] = [];
  for (const step of [...set.steps].reverse()) {
    if (downToVersion !== undefined && compareVersions(step.version, downToVersion) < 0) break;
    if (!applied.has(step.version)) continue;
    if (!step.revertSql) return { steps, blockedBy: step };
    steps.push(step);
  }
  return { steps, blockedBy: null };
}

/** The step a single-row Revert button undoes: the newest applied one. */
export function newestApplied(
  set: MigrationSet | null,
  ledger: LedgerResult | null | undefined,
): MigrationStep | null {
  if (!set || !ledger) return null;
  const applied = index(ledger);
  for (const step of [...set.steps].reverse()) {
    if (applied.has(step.version)) return step;
  }
  return null;
}

export type LedgerSource = { connection: Connection; ledger: LedgerResult | null };

/**
 * A migration these databases have run that is not imported here.
 *
 * The imported folders live in this browser, but the ledgers live in the
 * databases — so a migration applied from another machine, another browser, or
 * before a reinstall is invisible to the list while being plainly recorded in
 * the database. This is how it gets said out loud instead.
 */
export type DiscoveredMigration = {
  name: string;
  versions: string[];
  /** How many of its versions each environment has. */
  applied: { connectionId: string; connectionName: string; count: number }[];
  total: number;
};

export function discoverMigrations(
  sources: LedgerSource[],
  importedNames: string[],
): DiscoveredMigration[] {
  const known = new Set(importedNames.map((name) => name.toLowerCase()));
  const groups = new Map<string, Map<string, Set<string>>>();

  for (const source of sources) {
    for (const entry of source.ledger?.entries ?? []) {
      const name = entry.setName.trim();
      if (!name || known.has(name.toLowerCase())) continue;
      const byConnection = groups.get(name) ?? new Map<string, Set<string>>();
      const versions = byConnection.get(source.connection.id) ?? new Set<string>();
      versions.add(entry.version);
      byConnection.set(source.connection.id, versions);
      groups.set(name, byConnection);
    }
  }

  return [...groups.entries()]
    .map(([name, byConnection]) => {
      const all = new Set<string>();
      for (const versions of byConnection.values()) {
        for (const version of versions) all.add(version);
      }
      return {
        name,
        versions: [...all].sort(compareVersions),
        total: all.size,
        applied: sources.map((source) => ({
          connectionId: source.connection.id,
          connectionName: source.connection.name,
          count: byConnection.get(source.connection.id)?.size ?? 0,
        })),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
