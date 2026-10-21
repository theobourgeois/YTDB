/** Which branches a release compares, and how planned pull requests are marked. */
export type ReleaseSettings = {
  /** What production runs, like `origin/main`. */
  base: string;
  /** What the next release ships, like `origin/dev`. */
  head: string;
  /** An open pull request with this label is planned for the release before it is merged. */
  label: string;
};

export const DEFAULT_RELEASE_SETTINGS: ReleaseSettings = {
  base: "origin/main",
  head: "origin/dev",
  label: "next-release",
};

export type ReleaseRequest = ReleaseSettings & {
  /** The migrations folder, or any folder of a repository without one; the repository it sits in is the one compared. */
  root: string;
  /** False for a repository with no migrations folder, so no SQL is looked for. Read as true when unset. */
  migrations?: boolean;
  /** Pull requests picked by hand, on top of the labelled ones. */
  pinned: number[];
};

/** Who did something, as GitHub or git knows them. */
export type ReleaseAuthor = { login: string | null; name: string };

/** A migration file the release adds or changes, keyed the way the ledger keys it. */
export type ReleaseMigration = {
  setName: string;
  version: string;
  name: string;
  /** Path inside the repository. */
  path: string;
  /** Fingerprint of the SQL as it stands on the head branch; null for a pull request not merged yet. */
  checksum: string | null;
  /** True when the file was edited rather than added, which usually means it already ran somewhere. */
  modified: boolean;
  hasRevert: boolean;
};

/** A pull request, merged into the head branch or planned for it. */
export type ReleasePullRequest = {
  number: number;
  title: string;
  url: string;
  author: ReleaseAuthor;
  branch: string;
  base: string;
  labels: string[];
  /** When it was merged; null while it is still open. */
  mergedAt: string | null;
  draft: boolean;
  /** How many commits it brought in, as git counts them; null while it is still open. */
  commits: number | null;
  migrations: ReleaseMigration[];
  /** When it last changed on GitHub. */
  updatedAt: string | null;
  /** Why an open pull request is going out with the release; unset when it is only open. */
  planned?: "label" | "pinned";
  /** Where an open pull request stands on GitHub; unset once merged. */
  standing?: PullRequestStanding;
};

/** What GitHub says about merging an open pull request. */
export type PullRequestStanding = {
  /** The commit the branch is at, so a merge or sync only acts on what was read. */
  headSha: string;
  /** GitHub works this out lazily, so a pull request nobody looked at lately reads UNKNOWN once. */
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  /** CLEAN, BEHIND, BLOCKED, DIRTY, UNSTABLE, HAS_HOOKS, DRAFT or UNKNOWN. */
  mergeState: string;
  /** Commits on the base branch the pull request does not have yet; null when GitHub did not say. */
  behind: number | null;
};

/** A commit pushed to the head branch without a pull request. */
export type ReleaseCommit = {
  sha: string;
  subject: string;
  url: string | null;
  author: ReleaseAuthor;
  date: string;
  migrations: ReleaseMigration[];
};

/** A pull request offered when picking one by hand. */
export type OpenPullRequest = {
  number: number;
  title: string;
  author: ReleaseAuthor;
  base: string;
  draft: boolean;
};

/** Everything the head branch has that the base does not, and what is planned on top. */
export type ReleaseRead = {
  repo: { owner: string; name: string; url: string } | null;
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
  /** Every commit on the head branch and not on the base, merges included. */
  commits: number;
  pullRequests: ReleasePullRequest[];
  direct: ReleaseCommit[];
  /**
   * Pull requests not merged yet: every open one into the head branch, and any
   * picked for the release from elsewhere. The picked ones come first.
   */
  open: ReleasePullRequest[];
  /** The other open pull requests, offered when picking one by hand. */
  openPullRequests: OpenPullRequest[];
  /** The README beside each set of migrations the release touches, as the head branch has it. */
  notes: Record<string, string>;
  /** When the branches were last fetched; null when fetching failed and local refs were used. */
  fetchedAt: string | null;
  /** Things that did not stop the read but leave it incomplete, like GitHub being unreachable. */
  warnings: string[];
};

/** Puts the planned label on an open pull request, or takes it off. */
export type ReleaseLabelRequest = {
  root: string;
  number: number;
  label: string;
  add: boolean;
};

/** Merges an open pull request, or brings its branch up to date with its base. */
export type ReleasePullRequestAction = {
  root: string;
  number: number;
  /** The head commit the page showed; GitHub refuses if the branch moved since. */
  sha: string;
};
