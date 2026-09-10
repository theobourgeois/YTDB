import { randomId } from "../utils";
import { planTransaction } from "./sql";
import type { MigrationSet, MigrationStep } from "./types";

/** One statement above the query console's cap, so an oversized file is caught on import. */
export const MAX_MIGRATION_FILE_BYTES = 500_000;
/** A whole set is persisted to localStorage, which is small and shared with everything else. */
export const MAX_SET_BYTES = 4_000_000;
export const MAX_STEPS = 500;

/** Directory names that hold the forward migrations, and the ones that undo them. */
const APPLY_DIRS = new Set(["apply", "up", "forward"]);
const REVERT_DIRS = new Set(["revert", "down", "rollback", "undo"]);

/** Filename suffixes used by flat layouts that have no apply/revert directories. */
const APPLY_SUFFIXES = [".up", ".apply", ".forward"];
const REVERT_SUFFIXES = [".down", ".revert", ".rollback", ".undo"];

export type ImportedFile = {
  /** Path relative to the imported folder, with `/` separators. */
  path: string;
  text: string;
};

/** What a batch of files contributes: forward migrations, reverts, and what was ignored. */
export type ParsedFiles = {
  applies: Map<string, { path: string; sql: string; name: string }>;
  reverts: Map<string, { path: string; sql: string }>;
  skipped: string[];
  /** Reasons nothing usable came out, if nothing did. */
  errors: string[];
};

function segments(path: string): string[] {
  return path.split("/").filter((part) => part.length > 0);
}

function basename(path: string): string {
  return segments(path).at(-1) ?? path;
}

function stripExtension(name: string): string {
  return name.replace(/\.sql$/i, "");
}

/**
 * Splits a filename into the part that orders it and the part that names it:
 * `0007_add_orders` → `0007` + `add orders`, `V2__seed` → `2` + `seed`,
 * `2026-07-22_video_status` → `2026-07-22` + `video status`. A dash or dot
 * between digits stays in the version, so a date is one version and not three.
 */
function splitVersion(stem: string): { version: string; name: string } {
  const flyway = /^[Vv](\d+(?:[._]\d+)*)__(.*)$/.exec(stem);
  if (flyway) {
    return { version: flyway[1].replace(/_/g, "."), name: humanize(flyway[2]) };
  }
  const numeric = /^(\d+(?:[-.]\d+)*)(?:[-_.\s]+(.*))?$/.exec(stem);
  if (numeric) {
    return { version: numeric[1], name: humanize(numeric[2] ?? "") };
  }
  return { version: stem, name: humanize(stem) };
}

function humanize(value: string): string {
  return value.replace(/[-_]+/g, " ").trim();
}

/** Numeric-aware so `0009` sorts before `0010` and `2` before `10`. */
export function compareVersions(left: string, right: string): number {
  const chunk = /(\d+)|(\D+)/g;
  const leftParts = left.match(chunk) ?? [];
  const rightParts = right.match(chunk) ?? [];
  const shared = Math.min(leftParts.length, rightParts.length);
  for (let index = 0; index < shared; index += 1) {
    const a = leftParts[index];
    const b = rightParts[index];
    const bothNumeric = /^\d+$/.test(a) && /^\d+$/.test(b);
    const order = bothNumeric ? Number(a) - Number(b) : a.localeCompare(b);
    if (order !== 0) return order;
  }
  return leftParts.length - rightParts.length;
}

/**
 * A stable fingerprint of a file's contents. Not a security hash — it only has to
 * change when the SQL does, so an edited file can be told apart from the one that ran.
 */
export function checksum(sql: string): string {
  const normalized = sql.replace(/\r\n/g, "\n").trim();
  let low = 0x811c9dc5;
  let high = 0x01000193;
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    low = Math.imul(low ^ code, 0x01000193) >>> 0;
    high = Math.imul(high + code, 0x85ebca6b) >>> 0;
  }
  return `${low.toString(16).padStart(8, "0")}${high.toString(16).padStart(8, "0")}`;
}

/**
 * Decides whether a file applies or reverts, from the directory it sits in and
 * then from its own name. Files outside an apply/revert directory with no telling
 * suffix are treated as forward migrations, which is what a flat folder means.
 */
function classify(path: string): { direction: "apply" | "revert"; stem: string } {
  const parts = segments(path);
  const stem = stripExtension(parts.at(-1) ?? path);
  for (const part of parts.slice(0, -1)) {
    const folder = part.toLowerCase();
    if (REVERT_DIRS.has(folder)) return { direction: "revert", stem };
    if (APPLY_DIRS.has(folder)) return { direction: "apply", stem };
  }
  const lower = stem.toLowerCase();
  for (const suffix of REVERT_SUFFIXES) {
    if (lower.endsWith(suffix)) return { direction: "revert", stem: stem.slice(0, -suffix.length) };
  }
  for (const suffix of APPLY_SUFFIXES) {
    if (lower.endsWith(suffix)) return { direction: "apply", stem: stem.slice(0, -suffix.length) };
  }
  return { direction: "apply", stem };
}

/**
 * Reads a batch of .sql files into forward migrations and reverts.
 *
 * Nothing about the layout is required. Files under an `apply/` or `revert/`
 * directory are taken as such; so are `.up.sql` / `.down.sql` suffixes; and a
 * flat folder of migrations is read as forward migrations, which is what a folder
 * of plain .sql files means. Reverts are optional throughout.
 */
export function parseMigrationFiles(files: ImportedFile[]): ParsedFiles {
  const parsed: ParsedFiles = {
    applies: new Map(),
    reverts: new Map(),
    skipped: [],
    errors: [],
  };

  const sqlFiles = files.filter((file) => {
    const base = basename(file.path);
    return !base.startsWith(".") && /\.sql$/i.test(base);
  });

  if (sqlFiles.length === 0) {
    parsed.errors.push("No .sql files in there.");
    return parsed;
  }

  const totalBytes = sqlFiles.reduce((total, file) => total + file.text.length, 0);
  if (totalBytes > MAX_SET_BYTES) {
    parsed.errors.push(
      `That is ${formatBytes(totalBytes)} of SQL, over the ${formatBytes(MAX_SET_BYTES)} limit.`,
    );
    return parsed;
  }

  const readable: { file: ImportedFile; direction: "apply" | "revert"; stem: string }[] = [];
  for (const file of sqlFiles) {
    if (file.text.length > MAX_MIGRATION_FILE_BYTES) {
      parsed.skipped.push(`${file.path} — over ${formatBytes(MAX_MIGRATION_FILE_BYTES)}`);
      continue;
    }
    if (file.text.includes("\0")) {
      parsed.skipped.push(`${file.path} — not text`);
      continue;
    }
    if (!file.text.trim()) {
      parsed.skipped.push(`${file.path} — empty`);
      continue;
    }
    readable.push({ file, ...classify(file.path) });
  }

  // A folder where two forward migrations share a numeric prefix — two files
  // dated the same day, say — is not numbered at all, so the whole filename
  // has to be the version for every file in it, or one of the two would be lost.
  const prefixes = new Set<string>();
  let collided = false;
  for (const { direction, stem } of readable) {
    if (direction !== "apply") continue;
    const { version } = splitVersion(stem);
    if (prefixes.has(version)) collided = true;
    prefixes.add(version);
  }

  for (const { file, direction, stem } of readable) {
    const { version, name } = collided
      ? { version: stem, name: humanize(stem) }
      : splitVersion(stem);
    const target = direction === "apply" ? parsed.applies : parsed.reverts;
    const existing = target.get(version);
    if (existing) {
      parsed.skipped.push(`${file.path} — ${existing.path} is already version ${version}`);
      continue;
    }
    if (direction === "apply") parsed.applies.set(version, { path: file.path, sql: file.text, name });
    else parsed.reverts.set(version, { path: file.path, sql: file.text });
  }

  if (parsed.applies.size === 0 && parsed.reverts.size === 0) {
    parsed.errors.push("None of those .sql files could be read as a migration.");
  }
  return parsed;
}

export type MergeReport = {
  steps: MigrationStep[];
  added: number;
  /** Migrations whose apply file was replaced by a newer copy. */
  updated: number;
  /** Migrations that gained or replaced a revert file. */
  reverts: number;
  skipped: string[];
};

/**
 * Folds a batch of files into the migrations a set already has. Existing versions
 * are updated in place and everything else is added, so files can arrive a folder
 * at a time, or one at a time, in any order.
 */
export function mergeFiles(existing: MigrationStep[], parsed: ParsedFiles): MergeReport {
  const byVersion = new Map(existing.map((step) => [step.version, { ...step }]));
  const skipped = [...parsed.skipped];
  let added = 0;
  let updated = 0;
  let reverts = 0;

  for (const [version, file] of parsed.applies) {
    const step = byVersion.get(version);
    if (step) {
      if (step.applySql !== file.sql) updated += 1;
      step.name = file.name || step.name;
      step.applyPath = file.path;
      step.applySql = file.sql;
      step.checksum = checksum(file.sql);
      step.transaction = planTransaction(file.sql).mode;
      continue;
    }
    if (byVersion.size >= MAX_STEPS) {
      skipped.push(`${file.path} — over ${MAX_STEPS} migrations`);
      continue;
    }
    byVersion.set(version, {
      version,
      name: file.name || version,
      applyPath: file.path,
      applySql: file.sql,
      checksum: checksum(file.sql),
      transaction: planTransaction(file.sql).mode,
    });
    added += 1;
  }

  for (const [version, file] of parsed.reverts) {
    const step = byVersion.get(version);
    if (!step) {
      skipped.push(`${file.path} — no migration ${version} to revert`);
      continue;
    }
    step.revertPath = file.path;
    step.revertSql = file.sql;
    reverts += 1;
  }

  const steps = [...byVersion.values()].sort((a, b) => compareVersions(a.version, b.version));
  return { steps, added, updated, reverts, skipped };
}

/** A set with nothing in it yet, ready to have files added. */
export function emptySet(name: string): MigrationSet {
  return { id: randomId(), name: cleanSetName(name), importedAt: Date.now(), steps: [], skipped: [] };
}

export { cleanSetName };

function cleanSetName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, 80) || "Migrations";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Rebuilds a migration from what the databases stored, for a browser that never
 * had the folder. Only versions whose SQL was kept can come back; the rest are
 * named so it is clear what is still missing.
 */
export function setFromLedger(
  name: string,
  entries: { version: string; name: string; applySql?: string; revertSql?: string }[],
): { set: MigrationSet; missing: string[] } {
  const missing: string[] = [];
  const steps: MigrationStep[] = [];

  for (const entry of [...entries].sort((a, b) => compareVersions(a.version, b.version))) {
    if (!entry.applySql) {
      missing.push(entry.version);
      continue;
    }
    steps.push({
      version: entry.version,
      name: entry.name || entry.version,
      applyPath: `${entry.version} (from the ledger)`,
      applySql: entry.applySql,
      checksum: checksum(entry.applySql),
      revertPath: entry.revertSql ? `${entry.version} revert (from the ledger)` : undefined,
      revertSql: entry.revertSql,
      transaction: planTransaction(entry.applySql).mode,
    });
  }

  return {
    set: { id: randomId(), name: cleanSetName(name), importedAt: Date.now(), steps, skipped: [] },
    missing,
  };
}
