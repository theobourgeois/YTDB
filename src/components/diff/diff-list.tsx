"use client";

import Link from "next/link";
import { ChevronRightIcon, ExternalLinkIcon } from "lucide-react";
import { SqlCode } from "@/components/sql/sql-source";
import { createEnumSql, createRelationSql, quoteIdent } from "@/lib/schema-ddl";
import type { DetailGroup, DiffDetail, DiffObject, DiffStatus } from "@/lib/schema-diff";
import { cn } from "@/lib/utils";

const CATEGORY_TITLES: Record<DiffObject["category"], string> = {
  extension: "Extensions",
  schema: "Schemas",
  enum: "Types",
  relation: "Tables & views",
  function: "Functions",
};

const STATUS_MARK: Record<DiffStatus, string> = {
  added: "+",
  removed: "−",
  modified: "~",
};

const STATUS_CLASS: Record<DiffStatus, string> = {
  added: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  removed: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  modified: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
};

const GROUP_LABELS: Record<DetailGroup, [singular: string, plural: string]> = {
  column: ["column", "columns"],
  constraint: ["constraint", "constraints"],
  index: ["index", "indexes"],
  trigger: ["trigger", "triggers"],
  definition: ["body", "body"],
  property: ["property", "properties"],
  value: ["value", "values"],
};

type Props = {
  objects: DiffObject[];
  sourceName: string;
  targetName: string;
  expanded: string[];
  onToggle: (id: string) => void;
  /** Opens a table on the source connection, when it exists there. */
  tableHref: (object: DiffObject) => string | null;
};

export function DiffList({
  objects,
  sourceName,
  targetName,
  expanded,
  onToggle,
  tableHref,
}: Props) {
  const groups = groupByCategory(objects);

  return (
    <div className="pb-6">
      {groups.map(([category, items]) => (
        <section key={category}>
          <h2 className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-4 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
            {CATEGORY_TITLES[category]}
            <span className="tabular-nums opacity-60">{items.length}</span>
          </h2>
          <ul>
            {items.map((object) => (
              <DiffRow
                key={object.id}
                object={object}
                sourceName={sourceName}
                targetName={targetName}
                open={expanded.includes(object.id)}
                onToggle={() => onToggle(object.id)}
                href={tableHref(object)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function DiffRow({
  object,
  sourceName,
  targetName,
  open,
  onToggle,
  href,
}: {
  object: DiffObject;
  sourceName: string;
  targetName: string;
  open: boolean;
  onToggle: () => void;
  href: string | null;
}) {
  const preview = object.details.length === 0 ? previewSql(object) : null;

  return (
    <li className="group/diff-row border-b border-border/40 last:border-b-0">
      <div className="relative flex items-center">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/60"
        >
          <ChevronRightIcon
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
          <span
            aria-hidden
            className={cn(
              "flex size-4 shrink-0 items-center justify-center rounded-[4px] font-mono text-[11px] leading-none",
              STATUS_CLASS[object.status],
            )}
          >
            {STATUS_MARK[object.status]}
          </span>
          <span className="min-w-0 truncate font-mono text-[13px]">{object.label}</span>
          <span className="ml-auto shrink-0 truncate pl-3 text-xs text-muted-foreground">
            {summary(object, sourceName, targetName)}
          </span>
        </button>
        {href ? (
          <Link
            href={href}
            title="Open this table"
            aria-label={`Open ${object.label}`}
            className="mr-1.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/diff-row:opacity-100"
          >
            <ExternalLinkIcon className="size-3.5" />
          </Link>
        ) : (
          <span className="w-1.5 shrink-0" />
        )}
      </div>

      {open ? (
        <div className="border-t border-border/40 bg-muted/25 py-1">
          {preview ? (
            <SqlCode sql={preview} className="px-4 py-1.5" />
          ) : (
            object.details.map((detail) => <DetailRow key={detail.id} detail={detail} />)
          )}
        </div>
      ) : null}
    </li>
  );
}

function DetailRow({ detail }: { detail: DiffDetail }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-2 px-4 py-1">
      <span className="truncate pt-0.5 text-[11px] text-muted-foreground" title={detail.name}>
        {GROUP_LABELS[detail.group][0]}
      </span>
      <div className="min-w-0 font-mono text-xs leading-5">
        {detail.target !== null ? (
          <div className="text-rose-700 dark:text-rose-400">
            <span className="select-none opacity-60">− </span>
            <span className="break-all whitespace-pre-wrap">{detail.target}</span>
          </div>
        ) : null}
        {detail.source !== null ? (
          <div className="text-emerald-700 dark:text-emerald-400">
            <span className="select-none opacity-60">+ </span>
            <span className="break-all whitespace-pre-wrap">{detail.source}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function groupByCategory(objects: DiffObject[]): [DiffObject["category"], DiffObject[]][] {
  const groups = new Map<DiffObject["category"], DiffObject[]>();
  for (const object of objects) {
    groups.set(object.category, [...(groups.get(object.category) ?? []), object]);
  }
  return [...groups.entries()];
}

function summary(object: DiffObject, sourceName: string, targetName: string): string {
  if (object.status === "added") return `Only in ${sourceName}${size(object)}`;
  if (object.status === "removed") return `Only in ${targetName}${size(object)}`;
  return countDetails(object.details);
}

/** How big the object is, so a table missing on one side shows its shape. */
function size(object: DiffObject): string {
  const relation = object.category === "relation" ? (object.source ?? object.target) : null;
  if (relation) {
    const columns = relation.columns.length;
    return ` · ${columns} column${columns === 1 ? "" : "s"}`;
  }
  const type = object.category === "enum" ? (object.source ?? object.target) : null;
  if (type) return ` · ${type.labels.length} values`;
  return "";
}

function countDetails(details: DiffDetail[]): string {
  const counts = new Map<DetailGroup, number>();
  for (const detail of details) {
    counts.set(detail.group, (counts.get(detail.group) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([group, count]) => {
      const [singular, plural] = GROUP_LABELS[group];
      return `${count} ${count === 1 ? singular : plural}`;
    })
    .join(" · ");
}

/** The DDL of an object that exists on only one side, shown when its row opens. */
function previewSql(object: DiffObject): string | null {
  switch (object.category) {
    case "relation": {
      const relation = object.source ?? object.target;
      return relation ? createRelationSql(relation) : null;
    }
    case "enum": {
      const type = object.source ?? object.target;
      return type ? createEnumSql(type) : null;
    }
    case "function": {
      const fn = object.source ?? object.target;
      return fn ? fn.sql : null;
    }
    case "extension": {
      const extension = object.source ?? object.target;
      return extension
        ? `CREATE EXTENSION IF NOT EXISTS ${quoteIdent(extension.name)} WITH SCHEMA ${quoteIdent(extension.schema)};`
        : null;
    }
    case "schema":
      return `CREATE SCHEMA ${quoteIdent(object.name)};`;
    default: {
      const _exhaustive: never = object;
      return _exhaustive;
    }
  }
}
