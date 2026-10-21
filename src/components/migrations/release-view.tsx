"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import {
  ArrowRightIcon,
  ArrowSquareOutIcon,
  CheckIcon,
  ChevronDownIcon,
  DatabaseIcon,
  FolderOpenIcon,
  GitCommitIcon,
  GitMergeIcon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  SpinnerIcon,
  WarningIcon,
  XIcon,
} from "@/components/icons";
import { ConnectionColorMark } from "@/components/connections/connection-color";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAsync } from "@/hooks/use-async";
import { api } from "@/lib/api";
import {
  repoSetId,
  type LedgerEntry,
  type LedgerResult,
  type MigrationSet,
  type StepStatus,
} from "@/lib/migrations/types";
import type {
  OpenPullRequest,
  ReleaseCommit,
  ReleaseMigration,
  ReleasePullRequest,
  ReleaseRead,
  ReleaseSettings,
} from "@/lib/releases/types";
import { DEFAULT_RELEASE_SETTINGS } from "@/lib/releases/types";
import {
  releaseKey,
  useMigrations,
  useReleasePins,
  useReleaseRepos,
  useReleaseSettings,
} from "@/lib/store/migrations";
import type { Connection } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ENVIRONMENT_COLUMN, StatusMark } from "./migration-row";

export type ReleaseLedger = { ledger: LedgerResult | null; error: string | null };

type Props = {
  scope: string;
  /** The migrations folder; the repository it is in is the first one shown. */
  root: string | null;
  /** That repository's name, from its checkout, until a read says what GitHub calls it. */
  repoName: string | null;
  environments: Connection[];
  ledgers: Record<string, ReleaseLedger> | undefined;
  /** The sets in the folder as checked out; a migration missing from them is opened on GitHub instead. */
  folderSets: MigrationSet[] | undefined;
  /** Where one migration's page is, by set id. */
  migrationHref: (setId: string) => string;
  onPickFolder: () => void;
};

/** What only the repository with the migrations folder has. */
type MigrationContext = Pick<Props, "environments" | "ledgers" | "folderSets" | "migrationHref">;

type Action = { number: number; kind: "merge" | "sync" };

/** The last read of each release, shown straight away on the way back while a fresh one loads. */
const lastReads = new Map<string, ReleaseRead>();
/** What GitHub calls each repository, by its release key, once it has been read. */
const repoNames = new Map<string, string>();
/** An action in flight, kept until the read it started from is replaced. */
type Busy = Action & { read: ReleaseRead | null | undefined };

/** Where clicking a migration goes: its page here, or the file on GitHub when the folder does not have it. */
type MigrationLink = { href: string; external: boolean } | null;
/** Picks the link for a migration, given the branch on GitHub that has the file. */
type LinkMigration = (migration: ReleaseMigration, ref: string) => MigrationLink;

/**
 * What the next release ships, one repository at a time: the one the migrations
 * folder is in, then any others added here, like a backend without migrations.
 */
export function ReleaseView({ scope, root, repoName, onPickFolder, ...migrations }: Props) {
  const repos = useReleaseRepos(scope);
  const savedTab = useMigrations((state) => state.releaseTabs[scope]);
  const setTab = useMigrations((state) => state.setReleaseTab);
  const addRepo = useMigrations((state) => state.addReleaseRepo);
  const removeRepo = useMigrations((state) => state.removeReleaseRepo);
  const [adding, setAdding] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const tab = savedTab && repos.includes(savedTab) ? savedTab : null;
  const key = releaseKey(scope, tab);
  const reportCount = useCallback(
    (count: number) => setCounts((current) => (current[key] === count ? current : { ...current, [key]: count })),
    [key],
  );

  const tabs = [
    { path: null, name: repoNames.get(releaseKey(scope, null)) ?? repoName ?? "Migrations repo" },
    ...repos.map((path) => ({ path, name: repoNames.get(releaseKey(scope, path)) ?? folderName(path) })),
  ];
  const tabBar = (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
      {tabs.map((item) => {
        const active = item.path === tab;
        const count = counts[releaseKey(scope, item.path)];
        return (
          <button
            key={item.path ?? ""}
            type="button"
            onClick={() => setTab(scope, item.path)}
            title={item.path ?? root ?? undefined}
            className={cn(
              "-mb-px flex h-9 shrink-0 cursor-pointer items-center gap-2 border-b-2 px-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60",
              active
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.name}
            {count !== undefined && count > 0 && (
              <span className="rounded-full bg-emerald-600/15 px-1.5 text-xs tabular-nums text-emerald-700 dark:text-emerald-400">
                {count}
              </span>
            )}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => setAdding(true)}
        title="Add another repository's release, read from its folder on this computer"
        className="-mb-px flex h-9 shrink-0 cursor-pointer items-center gap-1.5 border-b-2 border-transparent px-2.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <PlusIcon className="size-3" />
        Add repo
      </button>
    </div>
  );

  return (
    <>
      <RepoRelease
        key={key}
        storeKey={key}
        root={tab ?? root}
        migrations={tab ? null : migrations}
        tabs={tabBar}
        onCount={reportCount}
        onPickFolder={onPickFolder}
        onRemove={tab ? () => removeRepo(scope, tab) : undefined}
      />
      {adding && (
        <AddRepoDialog
          onOpenChange={setAdding}
          onAdd={(path) => addRepo(scope, path)}
        />
      )}
    </>
  );
}

/**
 * One repository's release: the open pull requests picked for it, what is
 * already on the head branch and not in production, and, for the repository
 * with the migrations folder, every migration among them with where each
 * environment stands on it. Picks are a GitHub label, so everyone reading the
 * release sees the same plan.
 */
function RepoRelease({
  storeKey,
  root,
  migrations,
  tabs,
  onCount,
  onPickFolder,
  onRemove,
}: {
  storeKey: string;
  root: string | null;
  migrations: MigrationContext | null;
  tabs: ReactNode;
  onCount: (count: number) => void;
  onPickFolder: () => void;
  onRemove?: () => void;
}) {
  const settings = useReleaseSettings(storeKey);
  const pins = useReleasePins(storeKey);
  const setReleaseSettings = useMigrations((state) => state.setReleaseSettings);
  const togglePin = useMigrations((state) => state.toggleReleasePin);
  const [editing, setEditing] = useState(false);
  // Picks made since the last read, shown until the next read lands.
  const [picks, setPicks] = useState<{ read: ReleaseRead | null; map: Record<number, boolean> }>({ read: null, map: {} });
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setBusy] = useState<Busy | null>(null);
  const [merging, setMerging] = useState<ReleasePullRequest | null>(null);

  const readKey = `release:${root ?? ""}:${Boolean(migrations)}:${settings.base}:${settings.head}:${settings.label}:${pins.join(",")}`;
  const release = useAsync<ReleaseRead | null>(readKey, async (signal) => {
    if (!root) return null;
    const read = await api.release({ root, migrations: Boolean(migrations), ...settings, pinned: pins }, signal);
    lastReads.set(readKey, read);
    if (read.repo) repoNames.set(storeKey, read.repo.name);
    return read;
  });
  const data = release.data ?? lastReads.get(readKey) ?? null;
  const busy = pending && pending.read === release.data && !release.error ? pending : null;
  const picked = useCallback(
    (item: ReleasePullRequest) => {
      if (picks.read === data && item.number in picks.map) return picks.map[item.number];
      return item.planned === "label" || pins.includes(item.number);
    },
    [picks, data, pins],
  );

  const going = useMemo(() => data?.open.filter(picked) ?? [], [data, picked]);
  // A pull request into another branch only shows while it is picked.
  const waiting = useMemo(
    () => data?.open.filter((item) => !picked(item) && item.base === branchLabel(settings.head)) ?? [],
    [data, picked, settings.head],
  );
  const rows = useMemo(() => (data ? migrationRows(data, going) : []), [data, going]);
  const goingCount = data ? going.length : undefined;
  useEffect(() => {
    if (goingCount !== undefined) onCount(goingCount);
  }, [goingCount, onCount]);
  const folderSets = migrations?.folderSets;
  const migrationHref = migrations?.migrationHref;
  const onDisk = useMemo(
    () => new Set((folderSets ?? []).flatMap((set) => set.steps.map((step) => `${set.name}\u0000${step.version}`))),
    [folderSets],
  );
  const repoUrl = data?.repo?.url ?? null;
  const migrationLink = useCallback<LinkMigration>(
    (migration, ref) => {
      if (migrationHref && onDisk.has(`${migration.setName}\u0000${migration.version}`)) {
        return {
          href: `${migrationHref(repoSetId(migration.setName))}#migration-${encodeURIComponent(migration.version)}`,
          external: false,
        };
      }
      return repoUrl ? { href: `${repoUrl}/blob/${ref}/${migration.path}`, external: true } : null;
    },
    [onDisk, migrationHref, repoUrl],
  );

  if (!root) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mx-auto w-full max-w-5xl px-6 pt-6">
          <ReleaseHeader tabs={tabs} />
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="text-sm">This tab reads the repository your migrations folder is in.</p>
          <Button size="sm" variant="outline" onClick={onPickFolder}>
            <FolderOpenIcon data-icon="inline-start" />
            Read from a folder
          </Button>
        </div>
      </div>
    );
  }

  const head = branchLabel(settings.head);
  const base = branchLabel(settings.base);
  const inHead = data ? data.pullRequests.length + data.direct.length : 0;
  // Without a release branch, pull requests merge straight into production and there is nothing waiting in between.
  const direct = settings.head.trim() === settings.base.trim();

  async function pick(item: ReleasePullRequest, on: boolean) {
    if (!data || !root) return;
    setActionError(null);
    // A hand pick only lives on this machine; with a label the pick is shared on GitHub.
    if (!settings.label || item.planned === "pinned") {
      togglePin(storeKey, item.number);
      return;
    }
    setPicks({ read: data, map: { ...(picks.read === data ? picks.map : {}), [item.number]: on } });
    try {
      await api.releaseLabel({ root, number: item.number, label: settings.label, add: on });
      release.reload();
    } catch (caught) {
      setPicks({ read: null, map: {} });
      setActionError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function act(item: ReleasePullRequest, kind: Action["kind"]) {
    if (!root || !item.standing) return;
    setActionError(null);
    setBusy({ number: item.number, kind, read: release.data });
    try {
      const request = { root, number: item.number, sha: item.standing.headSha };
      if (kind === "merge") {
        await api.releaseMerge(request);
      } else {
        await api.releaseSync(request);
      }
      release.reload();
    } catch (caught) {
      setBusy(null);
      setActionError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  const openRow = (item: ReleasePullRequest, isPicked: boolean) => (
    <OpenPullRequestRow
      key={item.number}
      item={item}
      head={head}
      label={settings.label}
      picked={isPicked}
      busy={busy?.number === item.number ? busy.kind : null}
      migrationLink={migrationLink}
      onPick={(on) => pick(item, on)}
      onSync={() => act(item, "sync")}
      onMerge={() => setMerging(item)}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 pt-6 pb-12">
          <ReleaseHeader tabs={tabs}>
            <button
              type="button"
              onClick={() => setEditing(true)}
              title="Change which branches are compared"
              className="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              {!direct && (
                <>
                  <span className="font-mono">{head}</span>
                  <ArrowRightIcon className="size-3" />
                </>
              )}
              <span className="font-mono">{base}</span>
              <PencilIcon className="ml-1 size-3" />
            </button>
            <span className="ml-2">{release.loading ? "Fetching…" : data?.fetchedAt ? `Fetched ${clock(data.fetchedAt)}` : null}</span>
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={release.loading}
              aria-label="Refresh the release"
              title="Fetch both branches and re-read GitHub"
              onClick={release.reload}
            >
              <RefreshIcon className={cn(release.loading && "animate-spin")} />
            </Button>
          </ReleaseHeader>

          {(release.error || actionError || (data?.warnings.length ?? 0) > 0) && (
            <div className="-mt-4 flex flex-col gap-2">
              {[release.error, actionError].filter(Boolean).map((error) => (
                <Notice key={error} tone="error">
                  {error}
                  {error === release.error && (
                    <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setEditing(true)}>
                      Change branches
                    </Button>
                  )}
                </Notice>
              ))}
              {data?.warnings.map((warning) => (
                <Notice key={warning} tone="warning">
                  {warning}
                </Notice>
              ))}
            </div>
          )}

          {!data && release.loading ? (
            <p className="text-sm text-muted-foreground">Reading pull requests and {head}…</p>
          ) : data ? (
            <>
              <Section
                title="Going out"
                count={going.length}
                hint={`Open pull requests picked for this release, not merged into ${head} yet`}
                empty="Nothing picked yet. Click the circle beside an open pull request below to add it."
                trailing={
                  <AddPullRequest
                    head={head}
                    options={data.openPullRequests.filter((item) => !pins.includes(item.number))}
                    onAdd={(number) => togglePin(storeKey, number)}
                  />
                }
              >
                {going.map((item) => openRow(item, true))}
              </Section>

              <Section
                title={`Open into ${head}`}
                count={waiting.length}
                hint="Not planned for this release"
                empty={`No other open pull requests into ${head}.`}
              >
                {waiting.map((item) => openRow(item, false))}
              </Section>

              {!direct && (
                <Section
                  title={`Already in ${head}`}
                  count={inHead}
                  hint={`Merged, waiting to go out to ${base}`}
                  empty={`${head} has nothing ${base} does not. Everything merged has shipped.`}
                >
                  {data.pullRequests.map((item) => (
                    <MergedRow key={item.number} item={item} head={head} migrationLink={migrationLink} />
                  ))}
                  {data.direct.map((commit) => (
                    <CommitRow key={commit.sha} commit={commit} head={head} migrationLink={migrationLink} />
                  ))}
                </Section>
              )}

              {migrations && (
                <Section
                  title="Migrations to run"
                  count={rows.length}
                  hint="Every migration file this release adds or changes, and where each one has run"
                  empty="No migration files change in this release."
                >
                  <MigrationTable
                    rows={rows}
                    notes={data.notes}
                    head={head}
                    environments={migrations.environments}
                    ledgers={migrations.ledgers}
                    setHref={(setName) => migrations.migrationHref(repoSetId(setName))}
                    migrationLink={migrationLink}
                  />
                </Section>
              )}
            </>
          ) : null}
        </div>
      </ScrollArea>

      {editing && (
        <ReleaseSettingsDialog
          settings={settings}
          onOpenChange={setEditing}
          onSave={(next) => setReleaseSettings(storeKey, next)}
          onRemove={onRemove}
        />
      )}
      {merging && (
        <MergeDialog
          item={merging}
          onOpenChange={(open) => !open && setMerging(null)}
          onMerge={() => {
            const item = merging;
            setMerging(null);
            void act(item, "merge");
          }}
        />
      )}
    </div>
  );
}

function ReleaseHeader({ tabs, children }: { tabs: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold tracking-tight">Next release</h2>
      <div className="flex items-end gap-4 border-b">
        <div className="min-w-0 flex-1">{tabs}</div>
        <div className="flex shrink-0 items-center gap-1 pb-1 text-xs text-muted-foreground">{children}</div>
      </div>
    </header>
  );
}

function Notice({ tone, children }: { tone: "error" | "warning"; children: ReactNode }) {
  return (
    <p
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs",
        tone === "error"
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : "border-amber-600/30 bg-amber-500/5 text-amber-700 dark:text-amber-400",
      )}
    >
      <WarningIcon className="size-3.5 shrink-0" />
      {children}
    </p>
  );
}

function Section({
  title,
  count,
  hint,
  empty,
  trailing,
  children,
}: {
  title: string;
  count: number;
  hint?: string;
  empty: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h3 title={hint} className="flex min-w-0 flex-1 items-baseline gap-2 text-sm font-semibold">
          {title}
          <span className="text-xs font-normal text-muted-foreground tabular-nums">{count}</span>
        </h3>
        {trailing}
      </div>
      {count === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-4 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="divide-y overflow-hidden rounded-lg border bg-muted/25">{children}</div>
      )}
    </section>
  );
}

/** Words joined by a middle dot, skipping the empty ones. */
function Meta({ parts, className }: { parts: ReactNode[]; className?: string }) {
  const shown = parts.filter((part) => part !== null && part !== false && part !== "");
  return (
    <p className={cn("mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden text-xs text-muted-foreground", className)}>
      {shown.map((part, index) => (
        // The second part, a branch or a name, gives way first when the row is narrow.
        <span
          key={index}
          className={cn("flex items-center gap-1.5 whitespace-nowrap", index === 1 ? "min-w-0 shrink [&>*:last-child]:truncate" : "shrink-0")}
        >
          {index > 0 && <span aria-hidden>·</span>}
          {part}
        </span>
      ))}
    </p>
  );
}

/** What an open pull request needs before it can merge, in one word or two. */
type Standing = {
  tone: "ready" | "warning" | "conflict" | "quiet";
  text: string;
  detail: string;
  canMerge: boolean;
  canSync: boolean;
};

const MERGEABLE_STATES = new Set(["CLEAN", "HAS_HOOKS", "UNSTABLE"]);

function standingOf(item: ReleasePullRequest): Standing | null {
  const standing = item.standing;
  if (!standing) return null;
  const behind = standing.behind ?? 0;
  const conflicts = standing.mergeable === "CONFLICTING" || standing.mergeState === "DIRTY";
  const unknown = standing.mergeable === "UNKNOWN" || standing.mergeState === "UNKNOWN";
  const canSync = !conflicts && !unknown && (behind > 0 || standing.mergeState === "BEHIND");
  const canMerge = !item.draft && standing.mergeable === "MERGEABLE" && MERGEABLE_STATES.has(standing.mergeState);
  const at = { canMerge, canSync };
  if (conflicts) {
    return {
      ...at,
      tone: "conflict",
      text: `Conflicts with ${item.base}`,
      detail: `Does not merge cleanly into ${item.base}. Open it on GitHub to resolve the conflicts.`,
    };
  }
  if (unknown) {
    return { ...at, tone: "quiet", text: "Checking", detail: "GitHub is still working out whether it merges. Refresh in a moment." };
  }
  if (behind > 0 || standing.mergeState === "BEHIND") {
    return {
      ...at,
      tone: "warning",
      text: behind > 0 ? `${behind} behind ${item.base}` : `Behind ${item.base}`,
      detail: `${item.base} has ${behind > 0 ? plural(behind, "commit") : "commits"} this branch does not. It syncs without conflicts.`,
    };
  }
  if (item.draft) return { ...at, tone: "quiet", text: "Draft", detail: "Mark it ready for review on GitHub to merge it." };
  if (standing.mergeState === "BLOCKED") {
    return { ...at, tone: "warning", text: "Blocked", detail: "A required review or check has not passed yet." };
  }
  if (standing.mergeState === "UNSTABLE") {
    return { ...at, tone: "warning", text: "Checks failing", detail: "It merges cleanly, but some checks are failing." };
  }
  return { ...at, tone: "ready", text: "Ready to merge", detail: `Up to date with ${item.base} and merges cleanly.` };
}

const STANDING_DOT: Record<Standing["tone"], string> = {
  ready: "bg-emerald-500",
  warning: "bg-amber-500",
  conflict: "bg-red-500",
  quiet: "bg-muted-foreground/50",
};

function StandingLabel({ standing, url }: { standing: Standing; url: string }) {
  const body = (
    <>
      <span className={cn("size-1.5 shrink-0 rounded-full", STANDING_DOT[standing.tone])} />
      {standing.text}
    </>
  );
  const className = cn(
    "flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap",
    standing.tone === "conflict" ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
  );
  if (standing.tone === "conflict") {
    return (
      <a href={`${url}/conflicts`} target="_blank" rel="noreferrer" title={standing.detail} className={cn(className, "hover:underline")}>
        {body}
        <ArrowSquareOutIcon className="size-3" />
      </a>
    );
  }
  return (
    <span title={standing.detail} className={className}>
      {body}
    </span>
  );
}

function PickToggle({
  picked,
  label,
  pinned,
  onPick,
}: {
  picked: boolean;
  label: string;
  pinned: boolean;
  onPick: (on: boolean) => void;
}) {
  const title = picked
    ? pinned
      ? "Picked on this machine only. Click to take it out of the release."
      : `Labelled "${label}" on GitHub. Click to take it out of the release.`
    : label
      ? `Add to the next release. Labels it "${label}" on GitHub.`
      : "Add to the next release on this machine";
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={picked}
      aria-label={title}
      title={title}
      onClick={() => onPick(!picked)}
      className={cn(
        "flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60",
        picked
          ? "group/pick border-emerald-600 bg-emerald-600 text-white hover:border-muted-foreground hover:bg-transparent hover:text-foreground"
          : "border-muted-foreground/40 text-transparent hover:border-foreground hover:text-foreground",
      )}
    >
      {picked ? (
        <>
          <CheckIcon className="size-3 group-hover/pick:hidden" />
          <XIcon className="hidden size-3 group-hover/pick:block" />
        </>
      ) : (
        <PlusIcon className="size-3" />
      )}
    </button>
  );
}

function OpenPullRequestRow({
  item,
  head,
  label,
  picked,
  busy,
  migrationLink,
  onPick,
  onSync,
  onMerge,
}: {
  item: ReleasePullRequest;
  /** The head branch; a pull request into it does not repeat the name. */
  head: string;
  label: string;
  picked: boolean;
  busy: Action["kind"] | null;
  migrationLink: LinkMigration;
  onPick: (on: boolean) => void;
  onSync: () => void;
  onMerge: () => void;
}) {
  const standing = standingOf(item);
  const pinned = picked && item.planned === "pinned";
  return (
    <div className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/50">
      <PickToggle picked={picked} label={label} pinned={pinned} onPick={onPick} />
      <div className="min-w-0 flex-1">
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="block truncate text-sm font-medium outline-none hover:underline focus-visible:underline"
        >
          {item.title}
        </a>
        <Meta
          parts={[
            <span key="number" className="font-mono">#{item.number}</span>,
            <span key="branch" className="block truncate font-mono" title={item.branch}>
              {item.branch}
              {item.base !== head ? ` → ${item.base}` : ""}
            </span>,
            item.author.name,
            item.updatedAt ? `updated ${ago(item.updatedAt)}` : null,
            pinned && (
              <span key="pinned" className="flex items-center gap-1" title="Picked on this machine only, not labelled on GitHub">
                <PinIcon className="size-3" />
                just you
              </span>
            ),
          ]}
        />
      </div>
      <MigrationsMenu migrations={item.migrations} link={(migration) => migrationLink(migration, item.branch)} />
      {standing && <StandingLabel standing={standing} url={item.url} />}
      <div className="flex shrink-0 items-center gap-1.5">
        {standing?.canSync && (
          <Button
            size="xs"
            variant="outline"
            disabled={busy !== null}
            onClick={onSync}
            title={`Merge ${item.base} into ${item.branch} on GitHub, like the Update branch button`}
          >
            {busy === "sync" ? <SpinnerIcon className="animate-spin" /> : <RefreshIcon />}
            {busy === "sync" ? "Syncing" : "Sync"}
          </Button>
        )}
        <Button
          size="xs"
          variant="outline"
          disabled={!standing?.canMerge || busy !== null}
          onClick={onMerge}
          title={standing?.canMerge ? `Merge into ${item.base} on GitHub` : (standing?.detail ?? "Not mergeable yet")}
          className={cn(!picked && !busy && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
        >
          {busy === "merge" ? <SpinnerIcon className="animate-spin" /> : <GitMergeIcon />}
          {busy === "merge" ? "Merging" : "Merge"}
        </Button>
      </div>
    </div>
  );
}

function MergedRow({
  item,
  head,
  migrationLink,
}: {
  item: ReleasePullRequest;
  head: string;
  migrationLink: LinkMigration;
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/50">
      <GitMergeIcon className="size-5 shrink-0 text-violet-500" />
      <div className="min-w-0 flex-1">
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="block truncate text-sm font-medium outline-none hover:underline focus-visible:underline"
        >
          {item.title}
        </a>
        <Meta
          parts={[
            <span key="number" className="font-mono">#{item.number}</span>,
            item.author.name,
            item.mergedAt ? `merged ${ago(item.mergedAt)}` : null,
          ]}
        />
      </div>
      <MigrationsMenu migrations={item.migrations} link={(migration) => migrationLink(migration, head)} />
    </div>
  );
}

function CommitRow({
  commit,
  head,
  migrationLink,
}: {
  commit: ReleaseCommit;
  head: string;
  migrationLink: LinkMigration;
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/50">
      <GitCommitIcon className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <a
          href={commit.url ?? undefined}
          target="_blank"
          rel="noreferrer"
          className="block truncate text-sm font-medium outline-none hover:underline focus-visible:underline"
        >
          {commit.subject}
        </a>
        <Meta
          parts={[
            <span key="sha" className="font-mono">{commit.sha.slice(0, 7)}</span>,
            "pushed without a pull request",
            commit.author.name,
            ago(commit.date),
          ]}
        />
      </div>
      <MigrationsMenu migrations={commit.migrations} link={(migration) => migrationLink(migration, head)} />
    </div>
  );
}

/** How many migrations something brings, opening into a link to each one. */
function MigrationsMenu({
  migrations,
  link,
}: {
  migrations: ReleaseMigration[];
  link: (migration: ReleaseMigration) => MigrationLink;
}) {
  const router = useRouter();
  if (migrations.length === 0) return null;
  const bySet = new Map<string, ReleaseMigration[]>();
  for (const migration of migrations) bySet.set(migration.setName, [...(bySet.get(migration.setName) ?? []), migration]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md bg-sky-500/10 px-2 text-xs text-sky-700 outline-none hover:bg-sky-500/20 focus-visible:ring-2 focus-visible:ring-ring/60 data-popup-open:bg-sky-500/20 dark:text-sky-300">
        <DatabaseIcon className="size-3" />
        {plural(migrations.length, "migration")}
        <ChevronDownIcon className="size-3 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {[...bySet.entries()].map(([setName, items]) => (
          <DropdownMenuGroup key={setName}>
            <DropdownMenuLabel>{setName}</DropdownMenuLabel>
            {items.map((migration) => {
              const target = link(migration);
              return (
                <DropdownMenuItem
                  key={migration.version}
                  disabled={!target}
                  title={target?.external ? "Not in the folder you have checked out, so it opens on GitHub" : undefined}
                  onClick={() => {
                    if (!target) return;
                    if (target.external) window.open(target.href, "_blank", "noopener,noreferrer");
                    else router.push(target.href);
                  }}
                >
                  <span className="font-mono text-xs text-muted-foreground">{migration.version}</span>
                  <span className="truncate">{migration.name || migration.path.split("/").at(-1)}</span>
                  {target?.external ? (
                    <ArrowSquareOutIcon className="ml-auto size-3 text-muted-foreground" />
                  ) : (
                    <ArrowRightIcon className="ml-auto size-3 text-muted-foreground" />
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MigrationTable({
  rows,
  notes,
  head,
  environments,
  ledgers,
  setHref,
  migrationLink,
}: {
  head: string;
  rows: MigrationRow[];
  notes: Record<string, string>;
  environments: Connection[];
  ledgers: Record<string, ReleaseLedger> | undefined;
  setHref: (setName: string) => string;
  migrationLink: LinkMigration;
}) {
  return (
    <>
      <div className="flex h-9 items-center bg-muted/40 pl-4 text-xs text-muted-foreground">
        <span className="flex-1">Migration</span>
        {environments.map((connection) => (
          <span key={connection.id} className={cn("flex shrink-0 items-center justify-center gap-1.5", ENVIRONMENT_COLUMN)}>
            <ConnectionColorMark connection={connection} className="size-1.5" />
            <span className="truncate">{connection.name}</span>
          </span>
        ))}
      </div>
      {groupBySet(rows).map(([setName, items]) => (
        <div key={setName} className="py-1.5">
          <div className="flex items-center gap-3 px-4 pt-1.5 pb-1">
            <Link href={setHref(setName)} title={notes[setName]} className="truncate text-sm font-medium hover:underline">
              {setName}
            </Link>
          </div>
          {items.map((row) => (
            <MigrationRowLink
              key={row.version}
              target={migrationLink(row, row.planned ? (row.sources[0]?.ref ?? head) : head)}
            >
              <span className="flex min-w-0 flex-1 items-center gap-3 py-1.5 pr-3 pl-4">
                <span className="w-10 shrink-0 font-mono text-xs text-muted-foreground">{row.version}</span>
                <span className="min-w-0 truncate text-sm">{row.name || row.path.split("/").at(-1)}</span>
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  {row.modified && (
                    <span className="text-amber-700 dark:text-amber-400" title="This file existed before and was edited in this release">
                      edited
                    </span>
                  )}
                  {row.planned && <span title="Only on a pull request that is not merged yet">not merged</span>}
                  {!row.hasRevert && <span className="text-muted-foreground/70">no revert</span>}
                </span>
                <span className="ml-auto shrink-0 pl-2 font-mono text-xs text-muted-foreground" title={row.sources.map((source) => source.title).join("\n")}>
                  {row.sources.map((source) => source.label).join(" ")}
                </span>
              </span>
              {environments.map((connection) => {
                const read = ledgers?.[connection.id];
                const status = statusOn(read?.ledger ?? null, row);
                const entry = ledgerEntryFor(read?.ledger ?? null, row);
                return (
                  <span
                    key={connection.id}
                    title={
                      read?.error
                        ? `${connection.name}: ${read.error}`
                        : `${row.version} is ${STATUS_WORDS[status]} on ${connection.name}${
                            entry ? `, ${new Date(entry.appliedAt).toLocaleString()}` : ""
                          }`
                    }
                    className={cn("flex h-8 shrink-0 items-center justify-center", ENVIRONMENT_COLUMN)}
                  >
                    <StatusMark status={status} />
                  </span>
                );
              })}
            </MigrationRowLink>
          ))}
        </div>
      ))}
    </>
  );
}

function MigrationRowLink({ target, children }: { target: MigrationLink; children: ReactNode }) {
  const className = "flex items-center outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50";
  if (!target) return <div className={className}>{children}</div>;
  if (target.external) {
    return (
      <a
        href={target.href}
        target="_blank"
        rel="noreferrer"
        title="Not in the folder you have checked out, so it opens on GitHub"
        className={className}
      >
        {children}
      </a>
    );
  }
  return (
    <Link href={target.href} className={className}>
      {children}
    </Link>
  );
}

function MergeDialog({
  item,
  onOpenChange,
  onMerge,
}: {
  item: ReleasePullRequest;
  onOpenChange: (open: boolean) => void;
  onMerge: () => void;
}) {
  const standing = standingOf(item);
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Merge #{item.number} into {item.base}?
          </DialogTitle>
          <DialogDescription>{item.title}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          {item.migrations.length > 0 && (
            <p>
              It brings {plural(item.migrations.length, "migration")}. Check they have run on {item.base}&apos;s database
              under Migrations to run.
            </p>
          )}
          {standing?.tone === "warning" && <p className="text-amber-700 dark:text-amber-400">{standing.detail}</p>}
          <p>This merges it on GitHub right away.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onMerge}>
            <GitMergeIcon data-icon="inline-start" />
            Merge pull request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One row of the migrations table: a file, and what brought it into the release. */
type MigrationRow = ReleaseMigration & {
  /** `#513`, a short commit, or several of them. */
  sources: { label: string; url: string | null; title: string; ref?: string }[];
  /** True when it only exists on a pull request that is not merged yet. */
  planned: boolean;
};

function migrationRows(data: ReleaseRead, going: ReleasePullRequest[]): MigrationRow[] {
  const byKey = new Map<string, MigrationRow>();
  const add = (migration: ReleaseMigration, source: MigrationRow["sources"][number], planned: boolean) => {
    const key = `${migration.setName}\u0000${migration.version}`;
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.sources.some((item) => item.label === source.label)) existing.sources.push(source);
      existing.planned &&= planned;
      return;
    }
    byKey.set(key, { ...migration, sources: [source], planned });
  };
  for (const item of data.pullRequests) {
    for (const migration of item.migrations) {
      add(migration, { label: `#${item.number}`, url: item.url, title: item.title }, false);
    }
  }
  for (const commit of data.direct) {
    for (const migration of commit.migrations) {
      add(migration, { label: commit.sha.slice(0, 7), url: commit.url, title: commit.subject }, false);
    }
  }
  for (const item of going) {
    for (const migration of item.migrations) {
      add(migration, { label: `#${item.number}`, url: item.url, title: item.title, ref: item.branch }, true);
    }
  }
  return [...byKey.values()].sort(
    (a, b) => a.setName.localeCompare(b.setName) || a.version.localeCompare(b.version),
  );
}

function groupBySet(rows: MigrationRow[]): [string, MigrationRow[]][] {
  const groups = new Map<string, MigrationRow[]>();
  for (const row of rows) groups.set(row.setName, [...(groups.get(row.setName) ?? []), row]);
  return [...groups.entries()];
}

function ledgerEntryFor(ledger: LedgerResult | null, row: ReleaseMigration): LedgerEntry | null {
  return ledger?.entries.find((entry) => entry.setName === row.setName && entry.version === row.version) ?? null;
}

/** The same reading the migration page gives: an edited file that already ran is drifted. */
function statusOn(ledger: LedgerResult | null, row: ReleaseMigration): StepStatus {
  if (!ledger) return "unknown";
  const entry = ledgerEntryFor(ledger, row);
  if (!entry) return "pending";
  if (entry.checksum && row.checksum && entry.checksum !== row.checksum) return "drifted";
  return "applied";
}

const STATUS_WORDS: Record<StepStatus, string> = {
  applied: "applied",
  drifted: "applied, but the file changed since",
  pending: "not applied",
  unknown: "not read yet",
};

/** Picks an open pull request to plan for the release without labelling it on GitHub. */
/** Picks an open pull request into another branch than the head, which the release would not show otherwise. */
function AddPullRequest({
  head,
  options,
  onAdd,
}: {
  head: string;
  options: OpenPullRequest[];
  onAdd: (number: number) => void;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (item) =>
        String(item.number).includes(needle) ||
        item.title.toLowerCase().includes(needle) ||
        item.author.name.toLowerCase().includes(needle),
    );
  }, [options, query]);
  if (options.length === 0) return null;
  return (
    <Combobox<OpenPullRequest>
      items={shown}
      filter={null}
      value={null}
      inputValue={query}
      onInputValueChange={(next) => setQuery(next)}
      onOpenChange={(open) => open && setQuery("")}
      itemToStringLabel={(item) => `#${item.number} ${item.title}`}
      isItemEqualToValue={(item, current) => item.number === current.number}
      onValueChange={(item) => item && onAdd(item.number)}
    >
      <ComboboxPrimitive.Trigger
        title={`Open pull requests into other branches than ${head}`}
        className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
        <PlusIcon className="size-3" />
        Add from another branch
      </ComboboxPrimitive.Trigger>
      <ComboboxContent className="w-[28rem]">
        <div className="m-1 mb-0 flex h-8 items-center gap-1.5 rounded-lg px-2 text-muted-foreground focus-within:bg-muted/60">
          <SearchIcon className="size-3.5 shrink-0" />
          <ComboboxPrimitive.Input
            placeholder="Search open pull requests"
            spellCheck={false}
            autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent text-[0.8rem] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ComboboxEmpty>No matching pull requests</ComboboxEmpty>
        <ComboboxList>
          {(item: OpenPullRequest) => (
            <ComboboxItem key={item.number} value={item}>
              <PinIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="font-mono text-[11px] text-muted-foreground">#{item.number}</span>
              <span className="min-w-0 flex-1 truncate text-xs">{item.title}</span>
              <span className="max-w-32 shrink-0 truncate font-mono text-[11px] text-muted-foreground" title={item.base}>
                → {item.base}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

function ReleaseSettingsDialog({
  settings,
  onOpenChange,
  onSave,
  onRemove,
}: {
  settings: ReleaseSettings;
  onOpenChange: (open: boolean) => void;
  onSave: (settings: ReleaseSettings) => void;
  /** Takes an added repository off the release page; unset for the migrations folder's own. */
  onRemove?: () => void;
}) {
  const [value, setValue] = useState(settings);
  const [direct, setDirect] = useState(settings.head.trim() === settings.base.trim());
  function save() {
    const head = direct ? value.base : value.head.trim() === value.base.trim() ? DEFAULT_RELEASE_SETTINGS.head : value.head;
    onSave({ ...value, head });
    onOpenChange(false);
  }
  const field = (key: keyof ReleaseSettings, label: string, placeholder: string, hint: string) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`release-${key}`}>{label}</Label>
      <Input
        id={`release-${key}`}
        value={value[key]}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => setValue({ ...value, [key]: event.target.value })}
        onKeyDown={(event) => event.key === "Enter" && save()}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Release</DialogTitle>
          <DialogDescription>
            {direct
              ? "The release is the open pull requests into production, merged one at a time."
              : "The release is everything on the next-release branch that production does not have yet."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div role="radiogroup" aria-label="How changes reach production" className="grid grid-cols-2 gap-1 rounded-lg bg-muted/60 p-1">
            {[
              { on: false, label: "Release branch", title: "Pull requests merge into a branch like dev, which ships to production" },
              { on: true, label: "Straight to production", title: "Pull requests merge into production directly, with no release branch" },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                role="radio"
                aria-checked={direct === option.on}
                title={option.title}
                onClick={() => setDirect(option.on)}
                className={cn(
                  "cursor-pointer rounded-md px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60",
                  direct === option.on
                    ? "bg-background font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          {field("base", "Production", "origin/main", "What is running in production. A branch or a commit.")}
          {!direct &&
            field("head", "Next release", "origin/dev", "What ships next. origin/ branches are fetched on every read.")}
          {field(
            "label",
            "Planned label",
            "next-release",
            "Open pull requests with this GitHub label count as planned for the release.",
          )}
        </div>
        <DialogFooter>
          {onRemove && (
            <Button
              variant="ghost"
              className="mr-auto text-destructive hover:text-destructive"
              onClick={() => {
                onRemove();
                onOpenChange(false);
              }}
            >
              Remove this repo
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Adds another repository to the release page by its folder on this computer. */
function AddRepoDialog({ onOpenChange, onAdd }: { onOpenChange: (open: boolean) => void; onAdd: (path: string) => void }) {
  const [value, setValue] = useState("");
  const trimmed = value.trim();
  const looksAbsolute = trimmed.startsWith("/") || trimmed.startsWith("~") || /^[A-Za-z]:[\\/]/.test(trimmed);
  function add() {
    if (!trimmed || !looksAbsolute) return;
    onAdd(trimmed);
    onOpenChange(false);
  }
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a repository</DialogTitle>
          <DialogDescription>
            A git checkout on this computer. Its pull requests are read with the GitHub CLI, so any repository you
            can open with gh works. It does not need a migrations folder.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="release-repo">Folder</Label>
          <Input
            id="release-repo"
            value={value}
            placeholder="~/code/backend"
            spellCheck={false}
            autoComplete="off"
            autoFocus
            aria-invalid={trimmed.length > 0 && !looksAbsolute}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && add()}
          />
          {trimmed.length > 0 && !looksAbsolute && (
            <p className="text-xs text-destructive">An absolute path, or one starting with ~.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!trimmed || !looksAbsolute} onClick={add}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function branchLabel(ref: string): string {
  return ref.replace(/^origin\//, "");
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function ago(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}
