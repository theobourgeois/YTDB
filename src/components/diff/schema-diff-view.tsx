"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowRightIcon, SwapIcon, CaretUpDownIcon, CircleCheckIcon, LinkIcon, RefreshIcon, TrashIcon } from "@/components/icons";
import { ConnectionColorMark } from "@/components/connections/connection-color";
import { useExplorerContext } from "@/components/explorer/explorer-provider";
import { ViewHeader } from "@/components/explorer/view-header";
import { SchemaMultiSelect } from "@/components/explorer/schema-multi-select";
import { SqlSource } from "@/components/sql/sql-source";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PaneToggle } from "@/components/ui/pane-toggle";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchField } from "@/components/ui/search-field";
import { Skeleton } from "@/components/ui/skeleton";
import { useAsync } from "@/hooks/use-async";
import { api } from "@/lib/api";
import {
  diffSchemaNames,
  diffSnapshots,
  filterDiff,
  type DiffObject,
  type SchemaDiff,
} from "@/lib/schema-diff";
import { buildMigration, type Migration } from "@/lib/schema-migration";
import { useCompareTarget, useExplorer } from "@/lib/store/explorer";
import type { Connection, SchemaSnapshot } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DiffList } from "./diff-list";

type DiffPane = "changes" | "sql";

export function SchemaDiffView() {
  const router = useRouter();
  const { connection } = useExplorerContext();
  const { target, candidates, partnerIds, setTarget } = useCompareTarget(connection.id);
  const [pane, setPane] = useState<DiffPane>("changes");
  const [search, setSearch] = useState("");
  const [schemas, setSchemas] = useState<string[] | null>(null);
  const [includeDrops, setIncludeDrops] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);

  const source = useAsync(`${connection.url}:schema`, (signal) =>
    api.schema(connection.url, signal),
  );
  const targetUrl = target?.url;
  const comparand = useAsync(targetUrl ? `${targetUrl}:schema` : "no-target", (signal) =>
    targetUrl ? api.schema(targetUrl, signal) : Promise.resolve<SchemaSnapshot | null>(null),
  );

  const diff = useMemo(
    () =>
      source.data && comparand.data ? diffSnapshots(source.data, comparand.data) : null,
    [source.data, comparand.data],
  );
  const allSchemas = useMemo(() => (diff ? diffSchemaNames(diff) : []), [diff]);
  const visible = useMemo(
    () => (diff ? filterDiff(diff, { search, schemas }) : []),
    [diff, search, schemas],
  );
  const migration = useMemo(
    () =>
      diff
        ? buildMigration(diff, {
            sourceName: connection.name,
            targetName: target?.name ?? "the other database",
            includeDrops,
          })
        : null,
    [diff, connection.name, target?.name, includeDrops],
  );

  if (candidates.length === 0 || !target) {
    return <NothingToCompare />;
  }

  const loading = source.loading || comparand.loading;
  const error = source.error
    ? `${connection.name}: ${source.error}`
    : comparand.error
      ? `${target.name}: ${comparand.error}`
      : null;

  function swap() {
    if (!target) return;
    useExplorer.getState().setCompareTarget(target.id, connection.id);
    router.push(`/${encodeURIComponent(target.id)}/diff`);
  }

  function toggle(id: string) {
    setExpanded((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function hrefFor(object: DiffObject): string | null {
    if (object.category !== "relation" || !object.schema) return null;
    const owner = object.status === "removed" ? target : connection;
    if (!owner) return null;
    const name = object.name;
    return `/${encodeURIComponent(owner.id)}/${encodeURIComponent(object.schema)}/${encodeURIComponent(name)}`;
  }

  const allExpanded = visible.length > 0 && visible.every((item) => expanded.includes(item.id));

  return (
    <>
      <ViewHeader>
        <ConnectionColorMark connection={connection} />
        <span className="max-w-40 truncate font-medium">{connection.name}</span>
        <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <TargetPicker
          target={target}
          candidates={candidates}
          partnerIds={partnerIds}
          onSelect={setTarget}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          title={`Compare ${target.name} against ${connection.name} instead`}
          aria-label="Swap comparison direction"
          onClick={swap}
        >
          <SwapIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          disabled={loading}
          aria-label="Refresh"
          title="Re-read both schemas"
          onClick={() => {
            source.reload();
            comparand.reload();
          }}
        >
          <RefreshIcon className={cn(loading && "animate-spin")} />
        </Button>
      </ViewHeader>

      {pane === "changes" ? (
        <div className="flex items-center gap-1 border-b px-2 py-1">
          <SearchField
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter differences"
            aria-label="Filter differences"
            className="min-w-0 flex-1"
            trailing={
              <SchemaMultiSelect
                compact
                schemas={allSchemas}
                selected={schemas}
                onChange={setSchemas}
              />
            }
          />
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={visible.length === 0}
            onClick={() =>
              setExpanded(allExpanded ? [] : visible.map((object) => object.id))
            }
          >
            {allExpanded ? "Collapse all" : "Expand all"}
          </Button>
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1 flex-col">
        {error ? (
          <p className="flex-1 px-4 py-6 font-mono text-xs text-destructive">{error}</p>
        ) : !diff ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 10 }, (_, index) => (
              <Skeleton key={index} className="h-6 w-full" />
            ))}
          </div>
        ) : pane === "sql" ? (
          <SqlSource
            sql={migration?.sql}
            error={null}
            loading={loading}
            actions={
              <Button
                variant={includeDrops ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={includeDrops}
                title={`DROP statements for objects that exist only in ${target.name}`}
                onClick={() => setIncludeDrops((current) => !current)}
              >
                <TrashIcon data-icon="inline-start" />
                Include drops
              </Button>
            }
          />
        ) : diff.counts.total === 0 ? (
          <Matching sourceName={connection.name} targetName={target.name} />
        ) : visible.length === 0 ? (
          <p className="flex-1 px-4 py-6 text-sm text-muted-foreground">
            No differences match this filter.
          </p>
        ) : (
          <ScrollArea className={cn("min-h-0 flex-1", loading && "opacity-60")}>
            <DiffList
              objects={visible}
              sourceName={connection.name}
              targetName={target.name}
              expanded={expanded}
              onToggle={toggle}
              tableHref={hrefFor}
            />
          </ScrollArea>
        )}
      </div>

      <div className="flex items-center gap-2 border-t px-4 py-1.5 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">
          {pane === "sql"
            ? migrationStatus(migration)
            : diffStatus(diff, visible.length, connection.name, target.name)}
        </span>
        <div className="ml-auto">
          <PaneToggle
            label="Comparison pane"
            value={pane}
            onChange={setPane}
            options={[
              { value: "changes", label: "Changes" },
              { value: "sql", label: "Migration SQL" },
            ]}
          />
        </div>
      </div>
    </>
  );
}

function TargetPicker({
  target,
  candidates,
  partnerIds,
  onSelect,
}: {
  target: Connection;
  candidates: Connection[];
  partnerIds: string[];
  onSelect: (id: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-8 min-w-0 items-center gap-2 rounded-lg px-2 text-left font-medium outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 data-open:bg-muted/60">
        <ConnectionColorMark connection={target} />
        <span className="max-w-40 truncate">{target.name}</span>
        {candidates.length > 1 && (
          <CaretUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        {candidates.map((candidate) => (
          <DropdownMenuItem
            key={candidate.id}
            onClick={() => onSelect(candidate.id)}
            className={candidate.id === target.id ? "font-medium" : undefined}
          >
            <ConnectionColorMark connection={candidate} />
            <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
            {partnerIds.includes(candidate.id) && (
              <LinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Matching({ sourceName, targetName }: { sourceName: string; targetName: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
      <CircleCheckIcon className="size-5 text-emerald-600 dark:text-emerald-400" />
      <p className="text-sm">
        {sourceName} and {targetName} have the same schema
      </p>
    </div>
  );
}

function NothingToCompare() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
      <p className="text-sm">Comparing needs a second connection.</p>
      <Link href="/" className="text-foreground underline underline-offset-4">
        Add one
      </Link>
    </div>
  );
}

function diffStatus(
  diff: SchemaDiff | null,
  shown: number,
  sourceName: string,
  targetName: string,
): string {
  if (!diff) return "Reading both schemas…";
  if (diff.counts.total === 0) return "No differences";
  const parts = [
    `${diff.counts.added} only in ${sourceName}`,
    `${diff.counts.removed} only in ${targetName}`,
    `${diff.counts.modified} changed`,
  ];
  const filtered = shown === diff.counts.total ? "" : ` · showing ${shown}`;
  return `${diff.counts.total} differences · ${parts.join(" · ")}${filtered}`;
}

function migrationStatus(migration: Migration | null): string {
  if (!migration) return "Reading both schemas…";
  if (migration.statements === 0) return "Nothing to apply";
  const manual =
    migration.manual > 0
      ? ` · ${migration.manual} change${migration.manual === 1 ? "" : "s"} need editing by hand`
      : "";
  return `${migration.statements} statement${migration.statements === 1 ? "" : "s"}${manual}`;
}
