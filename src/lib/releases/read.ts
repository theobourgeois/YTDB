import "server-only";
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { basename, relative } from "node:path";
import { promisify } from "node:util";
import { checksum, parseMigrationFiles } from "../migrations/parse";
import { NOTE_FILES, resolveRoot } from "../migrations/repo";
import { MAX_NOTE_LENGTH } from "../migrations/types";
import type {
  OpenPullRequest,
  ReleaseAuthor,
  ReleaseCommit,
  ReleaseLabelRequest,
  PullRequestStanding,
  ReleaseMigration,
  ReleasePullRequest,
  ReleasePullRequestAction,
  ReleaseRead,
  ReleaseRequest,
} from "./types";

const run = promisify(execFile);

/** Enough for a release that has waited a long time; past it the page says so. */
const MAX_COMMITS = 2_000;
/** Pull requests asked of GitHub per list, its own ceiling for one page. */
const MAX_PULL_REQUESTS = 100;
const MAX_MIGRATION_FILES = 300;
/** Open pull requests whose files are read, newest first; each is one GitHub call. */
const MAX_OPEN_READ = 40;

/** Never prompt for credentials: the bridge has no terminal to prompt in. */
const ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" };

async function git(cwd: string, args: string[], timeout = 10_000): Promise<string> {
  const { stdout } = await run("git", ["-C", cwd, ...args], {
    timeout,
    env: ENV,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

async function gh(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("gh", args, {
    cwd,
    timeout: 30_000,
    env: ENV,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

/** Refs are passed to git as arguments, so anything that could read as an option is refused. */
function checkRef(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${name} branch`);
  const ref = value.trim();
  if (ref.startsWith("-") || !/^[A-Za-z0-9._/@^~-]+$/.test(ref)) {
    throw new Error(`"${ref}" is not a branch or commit`);
  }
  return ref;
}

function checkLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 100);
}

/** `git@github.com:acme/app.git` or `https://github.com/acme/app` → acme/app. */
function parseGitHubRemote(url: string): ReleaseRead["repo"] {
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  if (!match) return null;
  return { owner: match[1], name: match[2], url: `https://github.com/${match[1]}/${match[2]}` };
}

/** `origin/dev` → `dev`, the name GitHub knows the branch by. */
function branchName(ref: string): string {
  return ref.replace(/^(?:refs\/remotes\/)?origin\//, "").replace(/^refs\/heads\//, "");
}

type Commit = {
  sha: string;
  parents: string[];
  name: string;
  date: string;
  subject: string;
};

const FIELD = "\x1f";
const RECORD = "\x1e";

function parseCommits(output: string): Commit[] {
  return output
    .split(RECORD)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, parents, name, date, subject] = record.split(FIELD);
      return { sha, parents: parents ? parents.split(" ") : [], name, date, subject };
    });
}

/** Where a path inside the migrations folder belongs: its set, and its path inside that set. */
function placeInSet(subpath: string, path: string, rootName: string): { setName: string; inner: string } | null {
  const rel = subpath ? path.slice(subpath.length + 1) : path;
  if (subpath && !path.startsWith(`${subpath}/`)) return null;
  const parts = rel.split("/");
  if (parts.length === 1) return { setName: rootName, inner: parts[0] };
  return { setName: parts[0], inner: parts.slice(1).join("/") };
}

type GitHubAuthor = { login?: string; name?: string; is_bot?: boolean };

function author(value: GitHubAuthor | null | undefined): ReleaseAuthor {
  const login = value?.login ? value.login.replace(/^app\//, "") : null;
  return { login, name: value?.name || login || "unknown" };
}

type GitHubPullRequest = {
  number: number;
  title: string;
  url: string;
  author: GitHubAuthor | null;
  headRefName: string;
  baseRefName: string;
  labels: { name: string }[];
  isDraft: boolean;
  updatedAt?: string;
  mergedAt?: string | null;
  mergeCommit?: { oid: string } | null;
  headRefOid?: string;
  baseRefOid?: string;
  mergeable?: PullRequestStanding["mergeable"];
  mergeStateStatus?: string;
};

const PULL_REQUEST_FIELDS = "number,title,url,author,headRefName,baseRefName,labels,isDraft,updatedAt";
const OPEN_FIELDS = `${PULL_REQUEST_FIELDS},headRefOid,baseRefOid,mergeable,mergeStateStatus`;
/** How long GitHub gets to work out whether a pull request merges before it is asked again. */
const MERGEABLE_RETRY_MS = 2_000;
/** How often, and for how long, a sync waits for GitHub to move the branch. */
const SYNC_POLL_MS = 1_500;
const SYNC_WAIT_MS = 30_000;

/**
 * Reads what the next release ships: every commit on the head branch that the
 * base does not have, grouped by the pull request that brought it in, and the
 * migration files among them. Nothing is stored — git and GitHub are asked each time.
 */
export async function readRelease(request: ReleaseRequest): Promise<ReleaseRead> {
  const folder = resolveRoot(request.root);
  const base = checkRef(request.base, "base");
  const head = checkRef(request.head, "head");
  const label = checkLabel(request.label);
  const pinned = new Set(
    (Array.isArray(request.pinned) ? request.pinned : []).filter(
      (value): value is number => Number.isInteger(value) && value > 0,
    ),
  );
  const warnings: string[] = [];

  let top: string;
  try {
    top = (await git(folder, ["rev-parse", "--show-toplevel"])).trim();
  } catch {
    throw new Error(`${folder} is not inside a git repository`);
  }
  // Git answers with the real path, so the saved one is resolved the same way before comparing.
  const subpath = relative(top, await realpath(folder)).split(/[\\/]/).filter(Boolean).join("/");
  const rootName = basename(folder);

  const remoteUrl = await git(top, ["remote", "get-url", "origin"]).catch(() => "");
  const repo = parseGitHubRemote(remoteUrl);
  const slug = repo ? `${repo.owner}/${repo.name}` : null;
  // The open pull requests do not depend on the fetch below, so GitHub is asked alongside it.
  const openListing = slug
    ? gh(top, ["pr", "list", "--repo", slug, "--state", "open", "--limit", String(MAX_PULL_REQUESTS), "--json", OPEN_FIELDS])
    : null;
  openListing?.catch(() => {});

  // Fresh refs, so the page shows what is on GitHub rather than what was last pulled.
  let fetchedAt: string | null = null;
  const fetchable = [base, head].filter((ref) => ref.startsWith("origin/")).map(branchName);
  if (fetchable.length > 0) {
    try {
      await git(
        top,
        ["fetch", "--quiet", "origin", ...fetchable.map((name) => `+refs/heads/${name}:refs/remotes/origin/${name}`)],
        30_000,
      );
      fetchedAt = new Date().toISOString();
    } catch {
      warnings.push("Could not fetch from origin, so this is as of the last fetch.");
    }
  }

  const resolveSha = async (ref: string) => {
    try {
      return (await git(top, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).trim();
    } catch {
      throw new Error(`${ref} does not exist in ${basename(top)}`);
    }
  };
  const [baseSha, headSha] = await Promise.all([resolveSha(base), resolveSha(head)]);
  const range = `${baseSha}..${headSha}`;

  const commits = parseCommits(
    await git(top, [
      "log",
      `--format=${RECORD}%H${FIELD}%P${FIELD}%an${FIELD}%aI${FIELD}%s`,
      "-n",
      String(MAX_COMMITS + 1),
      range,
    ]),
  );
  if (commits.length > MAX_COMMITS) {
    warnings.push(`Over ${MAX_COMMITS.toLocaleString()} commits apart, so only the newest are shown.`);
    commits.length = MAX_COMMITS;
  }
  const bySha = new Map(commits.map((commit) => [commit.sha, commit]));

  // A repository without a migrations folder still has pull requests and commits; it just has no SQL to run.
  const withMigrations = request.migrations !== false;
  const migrations = withMigrations ? await readMigrations(top, subpath, rootName, baseSha, headSha, warnings) : [];

  // Which commits touched which migration file, so each one can be put next to whoever brought it.
  const touchedBy = new Map<string, string[]>();
  if (migrations.length > 0) {
    const log = await git(top, ["log", `--format=${RECORD}%H`, "--name-only", range, "--", subpath || "."]);
    for (const record of log.split(RECORD)) {
      const [sha, ...paths] = record.split("\n").map((line) => line.trim()).filter(Boolean);
      if (!sha) continue;
      for (const path of paths) touchedBy.set(path, [...(touchedBy.get(path) ?? []), sha]);
    }
  }
  const migrationsOf = (shas: Set<string>) =>
    migrations.filter((migration) => (touchedBy.get(migration.path) ?? []).some((sha) => shas.has(sha)));

  let merged: GitHubPullRequest[] = [];
  let open: GitHubPullRequest[] = [];
  if (!slug || !openListing) {
    warnings.push("origin is not a GitHub repository, so commits are not grouped into pull requests.");
  } else {
    const since = await mergedSince(top, baseSha, headSha);
    const [mergedRead, openRead] = await Promise.allSettled([
      gh(top, [
        "pr", "list", "--repo", slug, "--base", branchName(head), "--state", "merged",
        "--search", `merged:>=${since}`, "--limit", String(MAX_PULL_REQUESTS),
        "--json", `${PULL_REQUEST_FIELDS},mergedAt,mergeCommit`,
      ]),
      openListing,
    ]);
    if (mergedRead.status === "fulfilled") merged = JSON.parse(mergedRead.value);
    if (openRead.status === "fulfilled") open = JSON.parse(openRead.value);
    const failure = [mergedRead, openRead].find((read) => read.status === "rejected");
    if (failure?.status === "rejected") {
      warnings.push(`Could not read pull requests with the GitHub CLI: ${ghError(failure.reason)}`);
    }
  }

  // A pull request's own commits are the ones its merge brought in that the branch did not
  // already have. A squash merge is one commit, which is the merge commit itself.
  const claimed = new Set<string>();
  const pullRequests: ReleasePullRequest[] = [];
  for (const item of merged) {
    const mergeSha = item.mergeCommit?.oid;
    const mergeCommit = mergeSha ? bySha.get(mergeSha) : undefined;
    if (!mergeCommit) continue;
    const own = new Set<string>([mergeCommit.sha]);
    if (mergeCommit.parents.length > 1) {
      const listed = await git(top, ["rev-list", `${mergeCommit.parents[0]}..${mergeCommit.parents[1]}`]);
      for (const sha of listed.split("\n").map((line) => line.trim()).filter(Boolean)) {
        if (bySha.has(sha)) own.add(sha);
      }
    }
    for (const sha of own) claimed.add(sha);
    pullRequests.push({
      ...pullRequestFields(item),
      mergedAt: item.mergedAt ?? null,
      commits: [...own].filter((sha) => (bySha.get(sha)?.parents.length ?? 0) <= 1).length,
      migrations: migrationsOf(own),
    });
  }
  pullRequests.sort((a, b) => (b.mergedAt ?? "").localeCompare(a.mergedAt ?? ""));

  // Merges of one branch into another are bookkeeping, not work, so only plain commits count.
  const direct: ReleaseCommit[] = commits
    .filter((commit) => commit.parents.length <= 1 && !claimed.has(commit.sha))
    .map((commit) => ({
      sha: commit.sha,
      subject: commit.subject,
      url: repo ? `${repo.url}/commit/${commit.sha}` : null,
      author: { login: null, name: commit.name },
      date: commit.date,
      migrations: migrationsOf(new Set([commit.sha])),
    }));

  // Everything still open against the head branch is a candidate; the picked ones go first.
  const plannedOf = (item: GitHubPullRequest): ReleasePullRequest["planned"] =>
    label && item.labels.some((candidate) => candidate.name === label)
      ? "label"
      : pinned.has(item.number)
        ? "pinned"
        : undefined;
  const candidates = open
    .filter((item) => item.baseRefName === branchName(head) || plannedOf(item))
    .sort(
      (a, b) =>
        Number(Boolean(plannedOf(b))) - Number(Boolean(plannedOf(a))) ||
        (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
    );
  if (candidates.length > MAX_OPEN_READ) {
    warnings.push(`${candidates.length} open pull requests, so only the newest ${MAX_OPEN_READ} are shown.`);
    candidates.length = MAX_OPEN_READ;
  }
  const local = slug ? await fetchPullRequests(top, candidates, [base, head].map(branchName)) : false;
  const openInRelease: ReleasePullRequest[] = await mapLimited(candidates, 6, async (item) => {
    const [migrations, standing] = await Promise.all([
      slug && withMigrations ? plannedMigrations(top, slug, item, subpath, rootName, headSha, local, warnings) : [],
      slug ? readStanding(top, slug, item, local) : undefined,
    ]);
    return {
      ...pullRequestFields(item),
      mergedAt: null,
      commits: null,
      migrations,
      planned: plannedOf(item),
      standing,
    };
  });
  const shown = new Set(openInRelease.map((item) => item.number));

  const touchedSets = new Set(
    [...migrations, ...openInRelease.flatMap((item) => item.migrations)].map((migration) => migration.setName),
  );
  const notes = await readNotes(top, subpath, rootName, headSha, touchedSets);

  const openPullRequests: OpenPullRequest[] = open.filter((item) => !shown.has(item.number)).map((item) => ({
    number: item.number,
    title: item.title,
    author: author(item.author),
    base: item.baseRefName,
    draft: item.isDraft,
  }));

  return {
    repo,
    base: { ref: base, sha: baseSha },
    head: { ref: head, sha: headSha },
    commits: commits.length,
    pullRequests,
    direct,
    open: openInRelease,
    openPullRequests,
    notes,
    fetchedAt,
    warnings,
  };
}

function pullRequestFields(item: GitHubPullRequest) {
  return {
    number: item.number,
    title: item.title,
    url: item.url,
    author: author(item.author),
    branch: item.headRefName,
    base: item.baseRefName,
    labels: item.labels.map((candidate) => candidate.name),
    draft: item.isDraft,
    updatedAt: item.updatedAt ?? null,
  };
}

/**
 * Whether an open pull request merges, and how far its branch is behind its
 * base. GitHub only works mergeability out when asked, so an unknown answer
 * is asked for once more after a moment.
 */
async function readStanding(
  top: string,
  slug: string,
  item: GitHubPullRequest,
  local: boolean,
): Promise<PullRequestStanding | undefined> {
  if (!item.headRefOid) return undefined;
  let mergeable = item.mergeable ?? "UNKNOWN";
  let mergeState = item.mergeStateStatus ?? "UNKNOWN";
  const fromGitHub = () =>
    gh(top, ["api", `repos/${slug}/compare/${item.baseRefName}...${item.headRefOid}?per_page=1`, "--jq", ".behind_by"]);
  const behindRead = (
    local && item.baseRefOid
      ? git(top, ["rev-list", "--count", `${item.headRefOid}..${item.baseRefOid}`]).catch(fromGitHub)
      : fromGitHub()
  ).then((output) => Number.parseInt(output.trim(), 10)).catch(() => Number.NaN);
  if (mergeable === "UNKNOWN" || mergeState === "UNKNOWN") {
    await new Promise((resolve) => setTimeout(resolve, MERGEABLE_RETRY_MS));
    try {
      const again = JSON.parse(
        await gh(top, ["pr", "view", String(item.number), "--repo", slug, "--json", "mergeable,mergeStateStatus"]),
      ) as GitHubPullRequest;
      mergeable = again.mergeable ?? mergeable;
      mergeState = again.mergeStateStatus ?? mergeState;
    } catch {
      // Left unknown; the next read asks again.
    }
  }
  const behind = await behindRead;
  return { headSha: item.headRefOid, mergeable, mergeState, behind: Number.isFinite(behind) ? behind : null };
}

/** Runs `work` over `items` with at most `limit` at once, keeping their order. */
async function mapLimited<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  });
  await Promise.all(lanes);
  return results;
}

/**
 * Puts the planned label on an open pull request, or takes it off, so whoever
 * else reads the release sees the same plan. The label is made the first time.
 */
export async function setReleaseLabel(request: ReleaseLabelRequest): Promise<{ number: number; added: boolean }> {
  const label = checkLabel(request.label);
  if (!label) throw new Error("No planned label is set");
  checkNumber(request.number);
  const { top, slug } = await gitHubRepo(request.root);
  try {
    if (request.add) {
      await gh(top, [
        "label", "create", label, "--repo", slug, "--color", "0E8A16",
        "--description", "Going out in the next release",
      ]).catch((caught) => {
        if (!/already exists/i.test(ghError(caught))) throw caught;
      });
    }
    // The REST route, since `gh pr edit` can trip over GitHub's retired classic projects.
    const labels = `repos/${slug}/issues/${request.number}/labels`;
    await gh(
      top,
      request.add
        ? ["api", "--method", "POST", labels, "-f", `labels[]=${label}`]
        : ["api", "--method", "DELETE", `${labels}/${encodeURIComponent(label)}`],
    );
  } catch (caught) {
    throw new Error(`Could not ${request.add ? "label" : "unlabel"} #${request.number}: ${ghError(caught)}`);
  }
  return { number: request.number, added: request.add };
}

/**
 * Merges an open pull request the way the repository allows, preferring a merge
 * commit. Only the commit the page showed is merged: GitHub refuses if the branch moved.
 */
export async function mergePullRequest(request: ReleasePullRequestAction): Promise<{ number: number; method: string }> {
  checkNumber(request.number);
  const sha = checkSha(request.sha);
  const { top, slug } = await gitHubRepo(request.root);
  let method = "merge";
  try {
    const allowed = (await gh(top, [
      "api", `repos/${slug}`, "--jq", "[.allow_merge_commit, .allow_squash_merge, .allow_rebase_merge] | @tsv",
    ])).trim().split("\t");
    method = ["merge", "squash", "rebase"].find((_, index) => allowed[index] === "true") ?? "merge";
  } catch {
    // GitHub says which method it wants if the merge below is refused.
  }
  try {
    await gh(top, [
      "api", "--method", "PUT", `repos/${slug}/pulls/${request.number}/merge`,
      "-f", `merge_method=${method}`, "-f", `sha=${sha}`,
    ]);
  } catch (caught) {
    throw new Error(`Could not merge #${request.number}: ${ghError(caught)}`);
  }
  return { number: request.number, method };
}

/**
 * Brings a pull request's branch up to date with its base, the way GitHub's
 * Update branch button does. GitHub refuses when the two conflict. GitHub
 * merges in the background, so this waits until the branch has moved and a
 * read straight after sees it synced.
 */
export async function syncPullRequest(request: ReleasePullRequestAction): Promise<{ number: number }> {
  checkNumber(request.number);
  const sha = checkSha(request.sha);
  const { top, slug } = await gitHubRepo(request.root);
  try {
    await gh(top, [
      "api", "--method", "PUT", `repos/${slug}/pulls/${request.number}/update-branch`, "-f", `expected_head_sha=${sha}`,
    ]);
  } catch (caught) {
    throw new Error(`Could not sync #${request.number}: ${ghError(caught)}`);
  }
  const deadline = Date.now() + SYNC_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, SYNC_POLL_MS));
    const head = (await gh(top, ["api", `repos/${slug}/pulls/${request.number}`, "--jq", ".head.sha"]).catch(() => "")).trim();
    if (head && head !== sha) break;
  }
  return { number: request.number };
}

function checkNumber(value: unknown): void {
  if (!Number.isInteger(value) || (value as number) <= 0) throw new Error("Missing pull request number");
}

function checkSha(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) throw new Error("Missing the commit to act on");
  return value;
}

/** The GitHub repository the migrations folder is in, from its origin remote. */
async function gitHubRepo(root: string): Promise<{ top: string; slug: string }> {
  const folder = resolveRoot(root);
  const top = (await git(folder, ["rev-parse", "--show-toplevel"]).catch(() => "")).trim();
  if (!top) throw new Error(`${folder} is not inside a git repository`);
  const repo = parseGitHubRemote(await git(top, ["remote", "get-url", "origin"]).catch(() => ""));
  if (!repo) throw new Error("origin is not a GitHub repository");
  return { top, slug: `${repo.owner}/${repo.name}` };
}

function ghError(reason: unknown): string {
  const error = reason as { code?: string; stderr?: string; message?: string };
  if (error?.code === "ENOENT") return "`gh` is not installed on this machine.";
  const text = (error?.stderr || error?.message || String(reason)).trim();
  return text.split("\n")[0].slice(0, 300);
}

/**
 * The day before the two branches parted, as GitHub search wants it. Any pull
 * request merged into the head branch since then could be part of the release.
 */
async function mergedSince(top: string, baseSha: string, headSha: string): Promise<string> {
  try {
    const mergeBase = (await git(top, ["merge-base", baseSha, headSha])).trim();
    const date = new Date((await git(top, ["log", "-1", "--format=%cI", mergeBase])).trim());
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  } catch {
    return "2000-01-01";
  }
}

/** Every file of a set as the head branch has it, so versions are read the way the folder reads them. */
async function setListing(top: string, subpath: string, rootName: string, headSha: string, setName: string) {
  const loose = setName === rootName;
  const dir = loose ? subpath : [subpath, setName].filter(Boolean).join("/");
  const output = await git(top, ["ls-tree", ...(loose ? [] : ["-r"]), "--name-only", headSha, "--", `${dir || "."}/`]).catch(
    () => "",
  );
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((path) => ({ path, place: placeInSet(subpath, path, rootName) }))
    .filter((item) => item.place?.setName === setName);
}

/**
 * Splits changed files into migrations. A set is read whole — the same way the
 * folder view reads it — so each file gets the version the ledger knows it by,
 * even in a folder whose numbering forces whole filenames to be the version.
 */
async function migrationsFromPaths(
  top: string,
  subpath: string,
  rootName: string,
  headSha: string,
  changed: Map<string, "A" | "M">,
  readSql: boolean,
): Promise<ReleaseMigration[]> {
  const sets = new Set<string>();
  for (const path of changed.keys()) {
    const place = placeInSet(subpath, path, rootName);
    if (place) sets.add(place.setName);
  }

  const found: ReleaseMigration[] = [];
  for (const setName of sets) {
    const listing = await setListing(top, subpath, rootName, headSha, setName);
    const known = new Set(listing.map((item) => item.path));
    // A planned pull request's new files are not on the head branch yet.
    for (const path of changed.keys()) {
      const place = placeInSet(subpath, path, rootName);
      if (place?.setName === setName && !known.has(path)) listing.push({ path, place });
    }
    const parsed = parseMigrationFiles(
      listing.filter((item) => item.place).map((item) => ({ path: item.place!.inner, text: "--" })),
    );
    const dir = setName === rootName ? subpath : [subpath, setName].filter(Boolean).join("/");
    for (const [version, apply] of parsed.applies) {
      const path = dir ? `${dir}/${apply.path}` : apply.path;
      const status = changed.get(path);
      if (!status) continue;
      let sum: string | null = null;
      if (readSql) {
        const sql = await git(top, ["show", `${headSha}:${path}`]).catch(() => null);
        sum = sql === null ? null : checksum(sql);
      }
      found.push({
        setName,
        version,
        name: apply.name,
        path,
        checksum: sum,
        modified: status === "M",
        hasRevert: parsed.reverts.has(version),
      });
      if (found.length >= MAX_MIGRATION_FILES) return found;
    }
  }
  return found.sort((a, b) => a.setName.localeCompare(b.setName) || a.version.localeCompare(b.version));
}

async function readMigrations(
  top: string,
  subpath: string,
  rootName: string,
  baseSha: string,
  headSha: string,
  warnings: string[],
): Promise<ReleaseMigration[]> {
  // Three dots: what the head branch changed since it left the base, not what the base did meanwhile.
  const diff = await git(top, ["diff", "--name-status", "--no-renames", `${baseSha}...${headSha}`, "--", subpath || "."]);
  const changed = new Map<string, "A" | "M">();
  let deleted = 0;
  for (const line of diff.split("\n")) {
    const [status, path] = line.split("\t");
    if (!path || !/\.sql$/i.test(path)) continue;
    if (status === "A" || status === "M") changed.set(path, status);
    else if (status === "D") deleted += 1;
  }
  if (deleted > 0) {
    warnings.push(`${deleted} migration file${deleted === 1 ? " was" : "s were"} deleted on the head branch.`);
  }
  return migrationsFromPaths(top, subpath, rootName, headSha, changed, true);
}

async function plannedMigrations(
  top: string,
  slug: string,
  item: GitHubPullRequest,
  subpath: string,
  rootName: string,
  headSha: string,
  local: boolean,
  warnings: string[],
): Promise<ReleaseMigration[]> {
  // The same files GitHub lists for the pull request, read from the fetched commits;
  // GitHub pages through a big pull request's files a hundred at a time.
  let output: string | null = null;
  if (local && item.baseRefOid && item.headRefOid) {
    output = await git(top, [
      "diff", "--name-status", "--no-renames", `${item.baseRefOid}...${item.headRefOid}`, "--", subpath || ".",
    ]).catch(() => null);
  }
  if (output === null) {
    try {
      output = await gh(top, [
        "api", `repos/${slug}/pulls/${item.number}/files`, "--paginate",
        "--jq", '.[] | [.status, .filename] | @tsv',
      ]);
    } catch (caught) {
      warnings.push(`Could not read the files of #${item.number}: ${ghError(caught)}`);
      return [];
    }
  }
  const changed = new Map<string, "A" | "M">();
  for (const line of output.split("\n")) {
    const [status, path] = line.split("\t");
    if (!path || !/\.sql$/i.test(path) || !placeInSet(subpath, path, rootName)) continue;
    if (status === "A" || status === "added") changed.set(path, "A");
    else if (status === "M" || status === "modified" || status === "changed") changed.set(path, "M");
  }
  return migrationsFromPaths(top, subpath, rootName, headSha, changed, false);
}

/**
 * Fetches the commits of each open pull request and the branches they target in
 * one go, without touching any local branch, so their files and how far behind
 * they are can be read with git instead of a GitHub call each. False when the
 * fetch fails; GitHub is asked instead.
 */
async function fetchPullRequests(top: string, items: GitHubPullRequest[], fetched: string[]): Promise<boolean> {
  if (items.length === 0) return false;
  const bases = [...new Set(items.map((item) => item.baseRefName))].filter(
    (name) => !fetched.includes(name) && /^[A-Za-z0-9._/-]+$/.test(name),
  );
  try {
    await git(
      top,
      [
        "fetch", "--quiet", "--no-write-fetch-head", "origin",
        ...items.map((item) => `refs/pull/${item.number}/head`),
        ...bases.map((name) => `refs/heads/${name}`),
      ],
      30_000,
    );
    return true;
  } catch {
    return false;
  }
}

/** The note beside each set, as the head branch has it — the same file the migration page shows. */
async function readNotes(
  top: string,
  subpath: string,
  rootName: string,
  headSha: string,
  sets: Set<string>,
): Promise<Record<string, string>> {
  const notes: Record<string, string> = {};
  for (const setName of sets) {
    const dir = setName === rootName ? subpath : [subpath, setName].filter(Boolean).join("/");
    const listing = await git(top, ["ls-tree", "--name-only", headSha, "--", `${dir || "."}/`]).catch(() => "");
    const names = listing.split("\n").map((line) => line.trim()).filter(Boolean);
    for (const wanted of NOTE_FILES) {
      const path = names.find((candidate) => basename(candidate).toLowerCase() === wanted);
      if (!path) continue;
      const text = await git(top, ["show", `${headSha}:${path}`]).catch(() => "");
      if (!text.trim() || text.length > MAX_NOTE_LENGTH) continue;
      notes[setName] = text.trim();
      break;
    }
  }
  return notes;
}
