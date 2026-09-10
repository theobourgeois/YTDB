import "server-only";
import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { mergeFiles, parseMigrationFiles, type ImportedFile } from "./parse";
import { repoSetId, type MigrationSet, type RepoRead } from "./types";

const run = promisify(execFile);

/** Same ceilings as a dropped folder: a stray path cannot make the bridge walk a disk. */
const MAX_FILES_PER_SET = 2_000;
const MAX_DEPTH = 6;
const MAX_SETS = 500;

/** Folders that are never migrations, however many .sql files they hold. */
const IGNORED_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build"]);

/** `~/code/app` → `/Users/me/code/app`; anything relative is refused, since the bridge's cwd is not the user's. */
export function resolveRoot(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Missing folder");
  const expanded =
    trimmed === "~" ? homedir() : trimmed.startsWith("~/") ? join(homedir(), trimmed.slice(2)) : trimmed;
  if (!isAbsolute(expanded)) throw new Error(`"${trimmed}" is not an absolute path`);
  return resolve(expanded);
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Every .sql file under `dir`, as paths relative to it, in a stable order. */
async function collectSql(dir: string, depth: number, into: string[]): Promise<void> {
  if (depth > MAX_DEPTH || into.length >= MAX_FILES_PER_SET) return;
  const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectSql(path, depth + 1, into);
    } else if (entry.isFile() && /\.sql$/i.test(entry.name)) {
      into.push(path);
      if (into.length >= MAX_FILES_PER_SET) return;
    }
  }
}

async function readSet(
  root: string,
  dir: string,
  name: string,
): Promise<MigrationSet | null> {
  const paths: string[] = [];
  await collectSql(dir, 0, paths);
  if (paths.length === 0) return null;

  let newest = 0;
  const files: ImportedFile[] = [];
  for (const path of paths) {
    const [text, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    files.push({ path: relative(dir, path).split(/[\\/]/).join("/"), text });
    newest = Math.max(newest, info.mtimeMs);
  }

  const parsed = parseMigrationFiles(files);
  if (parsed.errors.length > 0 && parsed.applies.size === 0) return null;
  const report = mergeFiles([], parsed);
  return {
    id: repoSetId(name),
    name,
    // The newest file's time, so a list sorted by it shows recent work first.
    importedAt: Math.round(newest),
    steps: report.steps,
    skipped: report.skipped,
    source: { root, path: dir },
  };
}

async function git(root: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run("git", ["-C", root, ...args], { timeout: 5_000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** Which checkout the folder is in, so the page can say which branch it is looking at. */
async function describeCheckout(root: string): Promise<RepoRead["git"]> {
  const branch = await git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === null) return null;
  const [commit, status] = await Promise.all([
    git(root, ["rev-parse", "--short", "HEAD"]),
    git(root, ["status", "--porcelain", "--", "."]),
  ]);
  return { branch, commit: commit ?? "", dirty: Boolean(status) };
}

/**
 * Reads a migrations folder straight off the disk.
 *
 * Each folder directly under the root that holds .sql files is one set, named
 * after the folder — `key-claims/apply/0001_….sql` is version 0001 of key-claims.
 * Any .sql files sitting in the root itself form a set named after the root, which
 * is what a flat folder of migrations means. Nothing is remembered between calls:
 * whatever branch is checked out is what comes back.
 */
export async function readRepo(input: string): Promise<RepoRead> {
  const root = resolveRoot(input);
  if (!(await isDirectory(root))) throw new Error(`${root} is not a folder`);

  const entries = (await readdir(root, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const sets: MigrationSet[] = [];
  const loose: string[] = [];
  const skipped: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
    if (entry.isDirectory()) {
      if (sets.length >= MAX_SETS) {
        skipped.push(`${entry.name} — over ${MAX_SETS} folders`);
        continue;
      }
      const set = await readSet(root, join(root, entry.name), entry.name);
      if (set) sets.push(set);
    } else if (entry.isFile() && /\.sql$/i.test(entry.name)) {
      loose.push(entry.name);
    }
  }

  if (loose.length > 0) {
    const files: ImportedFile[] = [];
    let newest = 0;
    for (const name of loose) {
      const path = join(root, name);
      const [text, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
      files.push({ path: name, text });
      newest = Math.max(newest, info.mtimeMs);
    }
    const parsed = parseMigrationFiles(files);
    const report = mergeFiles([], parsed);
    skipped.push(...report.skipped);
    if (report.steps.length > 0) {
      const name = basename(root);
      sets.push({
        id: repoSetId(name),
        name,
        importedAt: Math.round(newest),
        steps: report.steps,
        skipped: [],
        source: { root, path: root },
      });
    }
  }

  return { root, sets, skipped, git: await describeCheckout(root) };
}
