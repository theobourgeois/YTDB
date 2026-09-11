import "server-only";
import { execFile } from "node:child_process";
import { readdir, readFile, realpath, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { mergeFiles, parseMigrationFiles, type ImportedFile } from "./parse";
import {
  MAX_NOTE_LENGTH,
  repoSetId,
  type MigrationSet,
  type NoteResult,
  type RepoCheckout,
  type RepoRead,
} from "./types";

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

/** Files at the top of a migration's folder read as its note, in order of preference. */
const NOTE_FILES = ["readme.md", "notes.md", "note.md", "readme.txt", "notes.txt", "note.txt"];

/** Where a new note is written, when the folder has none: the first name not already taken. */
const NEW_NOTE_FILES = ["README.md", "NOTES.md"];

/**
 * The note beside a migration's SQL. A file too long to be a note — a whole
 * project's README, say — is passed over rather than shown or overwritten.
 */
async function readNote(dir: string): Promise<{ note: string; notePath: string } | null> {
  const names = (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  for (const wanted of NOTE_FILES) {
    const name = names.find((candidate) => candidate.toLowerCase() === wanted);
    if (!name) continue;
    const notePath = join(dir, name);
    if ((await stat(notePath)).size > MAX_NOTE_LENGTH) continue;
    return { note: (await readFile(notePath, "utf8")).trim(), notePath };
  }
  return null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
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
  const found = await readNote(dir);
  return {
    id: repoSetId(name),
    name,
    // The newest file's time, so a list sorted by it shows recent work first.
    importedAt: Math.round(newest),
    steps: report.steps,
    skipped: report.skipped,
    note: found?.note || undefined,
    source: { root, path: dir, notePath: found?.notePath },
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

type Checkouts = {
  list: RepoCheckout[];
  /** Where the folder sits inside any one checkout, like `src/lib/supabase/migrations`. */
  subpath: string;
  /** Top folder of the checkout the saved folder itself is in. */
  current: string;
};

/**
 * Every checkout of the repository `folder` is in — the main one and each git
 * worktree — that has the same folder at the same place. Git already knows them
 * all, so a new worktree shows up here without being pointed at.
 */
async function findCheckouts(folder: string): Promise<Checkouts | null> {
  const [top, listing] = await Promise.all([
    git(folder, ["rev-parse", "--show-toplevel"]),
    git(folder, ["worktree", "list", "--porcelain"]),
  ]);
  if (!top || listing === null) return null;
  // Git answers with the real path, so the saved one is resolved the same way before comparing.
  const subpath = relative(top, await realpath(folder));

  const found: { path: string; branch: string; usable: boolean }[] = [];
  for (const block of listing.split(/\n\s*\n/)) {
    const lines = block.split("\n");
    const path = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
    if (!path) continue;
    const ref = lines.find((line) => line.startsWith("branch "))?.slice("branch ".length);
    const head = lines.find((line) => line.startsWith("HEAD "))?.slice("HEAD ".length) ?? "";
    found.push({
      path,
      branch: ref ? ref.replace(/^refs\/heads\//, "") : head.slice(0, 7),
      usable: !lines.some((line) => line === "bare" || line.startsWith("prunable")),
    });
  }

  const list: RepoCheckout[] = [];
  for (const [index, item] of found.entries()) {
    if (!item.usable || !(await isDirectory(join(item.path, subpath)))) continue;
    list.push({ path: item.path, branch: item.branch, main: index === 0 });
  }
  return { list, subpath, current: top };
}

/**
 * Reads a migrations folder, from the checkout named by `checkoutInput` when it
 * is another worktree of the same repository. A checkout that has since been
 * removed falls back to the folder as saved rather than failing.
 */
export async function readRepo(input: string, checkoutInput: string | null = null): Promise<RepoRead> {
  const saved = resolveRoot(input);
  const checkouts = (await isDirectory(saved)) ? await findCheckouts(saved) : null;
  const picked = checkoutInput
    ? checkouts?.list.find((candidate) => candidate.path === resolve(checkoutInput))
    : undefined;
  const root = picked && checkouts ? join(picked.path, checkouts.subpath) : saved;
  const read = await readFolder(root);
  return {
    ...read,
    git: await describeCheckout(root),
    checkouts: checkouts?.list ?? [],
    checkout: picked?.path ?? checkouts?.current ?? null,
  };
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
async function readFolder(root: string): Promise<Pick<RepoRead, "root" | "sets" | "skipped">> {
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
      const found = await readNote(root);
      sets.push({
        id: repoSetId(name),
        name,
        importedAt: Math.round(newest),
        steps: report.steps,
        skipped: [],
        note: found?.note || undefined,
        source: { root, path: root, notePath: found?.notePath },
      });
    }
  }

  return { root, sets, skipped };
}

/**
 * Writes a migration's note into its folder, so it is committed with the SQL and
 * whoever runs it next reads it. Only a folder the root actually reads as a
 * migration can be written to, and only its note file; an empty note removes it.
 */
export async function writeNote(rootInput: string, pathInput: string, text: string): Promise<NoteResult> {
  // The root a set reports is the folder it was read from, worktree and all.
  const { root, sets } = await readFolder(resolveRoot(rootInput));
  const dir = resolve(pathInput);
  const set = sets.find((candidate) => candidate.source?.path === dir);
  if (!set?.source) throw new Error(`${dir} is not a migration in ${root}`);

  const note = text.replace(/\r\n/g, "\n").trim();
  if (note.length > MAX_NOTE_LENGTH) {
    throw new Error(`That note is over ${MAX_NOTE_LENGTH.toLocaleString()} characters`);
  }

  const existing = set.source.notePath;
  if (!note) {
    if (existing) await unlink(existing);
    return { note: null, notePath: null };
  }

  let target = existing;
  if (!target) {
    for (const name of NEW_NOTE_FILES) {
      if (!(await exists(join(dir, name)))) {
        target = join(dir, name);
        break;
      }
    }
  }
  if (!target) throw new Error(`${dir} already has a README.md and NOTES.md too long to be a note`);

  // A new file is created exclusively, so a file that appeared since the read is never clobbered.
  await writeFile(target, `${note}\n`, { encoding: "utf8", flag: existing ? "w" : "wx" });
  return { note, notePath: target };
}
