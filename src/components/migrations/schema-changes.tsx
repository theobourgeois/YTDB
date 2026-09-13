"use client";

import type { ComponentType } from "react";
import {
  CodeIcon,
  EnumIcon,
  ExtensionIcon,
  FunctionIcon,
  IndexIcon,
  SchemaIcon,
  SequenceIcon,
  TableIcon,
  TypeIcon,
  ViewIcon,
} from "@/components/icons";
import {
  qualifiedName,
  type Part,
  type SchemaChanges,
  type Subject,
  type SubjectKind,
} from "@/lib/migrations/changes";
import { cn } from "@/lib/utils";

const ICON: Record<SubjectKind, ComponentType<{ className?: string }>> = {
  table: TableIcon,
  view: ViewIcon,
  "materialized-view": ViewIcon,
  function: FunctionIcon,
  procedure: FunctionIcon,
  enum: EnumIcon,
  type: TypeIcon,
  domain: TypeIcon,
  sequence: SequenceIcon,
  index: IndexIcon,
  schema: SchemaIcon,
  extension: ExtensionIcon,
};

const KIND_LABEL: Record<SubjectKind, string> = {
  table: "table",
  view: "view",
  "materialized-view": "materialized view",
  function: "function",
  procedure: "procedure",
  enum: "enum",
  type: "type",
  domain: "domain",
  sequence: "sequence",
  index: "index",
  schema: "schema",
  extension: "extension",
};

const ADDED = "text-emerald-600 dark:text-emerald-400";
const REMOVED = "text-red-600 dark:text-red-400";
const CHANGED = "text-amber-600 dark:text-amber-400";

/**
 * What a migration does to the schema, object by object: each table, function
 * or type it touches, and under it the columns, constraints, indexes, triggers
 * and policies it adds, changes, renames or drops.
 */
export function SchemaChangesView({
  changes,
  onVersion,
  className,
}: {
  changes: SchemaChanges;
  /** Set for a view of several migrations: each line then says which one it came from. */
  onVersion?: (version: string) => void;
  className?: string;
}) {
  if (changes.subjects.length === 0 && changes.other.length === 0) {
    return <p className={cn("px-3 py-2 text-xs text-muted-foreground", className)}>No schema changes</p>;
  }
  return (
    <div className={cn("space-y-0.5 py-1", className)}>
      {changes.subjects.map((subject) => (
        <SubjectBlock
          key={`${subject.kind}:${subject.schema}.${subject.name}:${subject.detail ?? ""}`}
          subject={subject}
          onVersion={onVersion}
        />
      ))}
      {changes.other.length > 0 && <OtherBlock other={changes.other} onVersion={onVersion} />}
    </div>
  );
}

function displayName(subject: Pick<Subject, "kind" | "schema" | "name">): string {
  if (subject.kind === "schema" || subject.kind === "extension") return subject.name;
  return qualifiedName(subject.schema, subject.name);
}

function EffectLabel({ subject }: { subject: Subject }) {
  const from = subject.from;
  const moved = from && from.schema !== subject.schema;
  const renamed = from && from.name !== subject.name;
  switch (subject.effect) {
    case "created":
      return <span className={cn("shrink-0 text-[11px]", ADDED)}>new</span>;
    case "replaced":
      return (
        <span className={cn("shrink-0 text-[11px]", ADDED)} title="CREATE OR REPLACE: new, or redefined in place">
          new or replaced
        </span>
      );
    case "dropped":
      return <span className={cn("shrink-0 text-[11px]", REMOVED)}>dropped</span>;
    case "altered":
      if (!from) return null;
      return (
        <span className={cn("shrink-0 font-mono text-[11px]", CHANGED)}>
          {renamed ? `renamed from ${moved ? qualifiedName(from.schema, from.name) : from.name}` : `moved from ${from.schema}`}
        </span>
      );
  }
}

function SubjectBlock({ subject, onVersion }: { subject: Subject; onVersion?: (version: string) => void }) {
  const Icon = ICON[subject.kind];
  const dropped = subject.effect === "dropped";
  return (
    <div className="px-3 py-1">
      <div className="flex h-6 min-w-0 items-center gap-2">
        <span title={KIND_LABEL[subject.kind]} className="flex shrink-0">
          <Icon className="size-3.5 text-muted-foreground" />
        </span>
        <span
          className={cn(
            "min-w-0 shrink-0 truncate font-mono text-xs font-medium",
            dropped && "text-muted-foreground line-through decoration-red-500/60",
          )}
        >
          {displayName(subject)}
        </span>
        <EffectLabel subject={subject} />
        {subject.detail && (
          <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground" title={subject.detail}>
            {subject.detail}
          </span>
        )}
        {onVersion && subject.parts.length === 0 && (
          <Versions versions={subject.versions} onVersion={onVersion} className="ml-auto" />
        )}
      </div>
      {subject.parts.length > 0 && (
        <div
          className={cn(
            "ml-[6px] grid items-baseline gap-x-3 border-l pl-3",
            onVersion
              ? "grid-cols-[0.75rem_auto_minmax(0,max-content)_minmax(0,1fr)_auto]"
              : "grid-cols-[0.75rem_auto_minmax(0,max-content)_minmax(0,1fr)]",
          )}
        >
          {subject.parts.map((part, index) => (
            <PartRow key={`${part.kind}:${part.name}:${index}`} part={part} onVersion={onVersion} />
          ))}
        </div>
      )}
    </div>
  );
}

const PART_LABEL: Record<Part["kind"], string> = {
  column: "column",
  constraint: "constraint",
  index: "index",
  trigger: "trigger",
  policy: "policy",
  value: "value",
  rows: "rows",
  setting: "setting",
  comment: "comment",
  grant: "grant",
};

function glyph(part: Part): { sign: string; className: string; title: string } {
  if (part.kind === "rows") return { sign: "≡", className: "text-muted-foreground", title: "data" };
  switch (part.op) {
    case "add":
      return { sign: "+", className: ADDED, title: "added" };
    case "drop":
      return { sign: "−", className: REMOVED, title: "dropped" };
    case "rename":
      return { sign: "~", className: CHANGED, title: "renamed" };
    case "change":
      return { sign: "~", className: CHANGED, title: "changed" };
  }
}

function PartRow({ part, onVersion }: { part: Part; onVersion?: (version: string) => void }) {
  const mark = glyph(part);
  const label = part.kind === "grant" && part.op === "drop" ? "revoke" : PART_LABEL[part.kind];
  const name = part.kind === "value" ? `'${part.name}'` : part.name;
  const from = part.from !== undefined ? (part.kind === "value" ? `'${part.from}'` : part.from) : undefined;
  const detail = part.op === "drop" && part.kind !== "grant" && part.kind !== "comment" ? undefined : part.detail;
  return (
    <>
      <span className={cn("text-center font-mono text-xs select-none", mark.className)} title={mark.title}>
        {mark.sign}
      </span>
      <span className="text-[11px] text-muted-foreground/80">{label}</span>
      <span
        className={cn(
          "min-w-0 truncate py-px font-mono text-xs",
          part.op === "drop" && "text-muted-foreground",
        )}
        title={from ? `${from} → ${name}` : name}
      >
        {from && (
          <>
            <span className="text-muted-foreground">{from}</span>
            <span className="px-1 text-muted-foreground/60">→</span>
          </>
        )}
        {name}
      </span>
      <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground" title={detail}>
        {detail}
      </span>
      {onVersion && <Versions versions={part.versions} onVersion={onVersion} />}
    </>
  );
}

/** The migrations a line came from; each one opens that file. */
function Versions({
  versions,
  onVersion,
  className,
}: {
  versions: string[];
  onVersion: (version: string) => void;
  className?: string;
}) {
  const shown = versions.length > 3 ? [versions[0], versions[versions.length - 1]] : versions;
  return (
    <span className={cn("flex shrink-0 items-baseline justify-end gap-1.5 font-mono text-[10px]", className)}>
      {shown.map((version, index) => (
        <span key={version} className="flex items-baseline gap-1.5">
          {versions.length > 3 && index === 1 && (
            <span className="text-muted-foreground/50" title={versions.join(", ")}>
              …
            </span>
          )}
          <button
            type="button"
            title={`Show ${version}`}
            onClick={() => onVersion(version)}
            className="cursor-pointer rounded-sm text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            {version}
          </button>
        </span>
      ))}
    </span>
  );
}

function OtherBlock({
  other,
  onVersion,
}: {
  other: SchemaChanges["other"];
  onVersion?: (version: string) => void;
}) {
  return (
    <div className="px-3 py-1">
      <div className="flex h-6 items-center gap-2">
        <CodeIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs text-muted-foreground" title="Statements that are not a schema change this can describe">
          Other statements
        </span>
      </div>
      <div className="ml-[6px] space-y-px border-l pl-3">
        {other.map((item) => (
          <div key={item.text} className="flex min-w-0 items-baseline gap-3">
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground" title={item.text}>
              {item.text}
            </span>
            {onVersion && <Versions versions={item.versions} onVersion={onVersion} />}
          </div>
        ))}
      </div>
    </div>
  );
}

/** `3 new · 2 changed · 1 dropped`, for a caption. */
export function changeCounts(changes: SchemaChanges): string {
  let created = 0;
  let changed = 0;
  let dropped = 0;
  for (const subject of changes.subjects) {
    if (subject.effect === "created" || subject.effect === "replaced") created += 1;
    else if (subject.effect === "dropped") dropped += 1;
    else changed += 1;
  }
  const parts: string[] = [];
  if (created > 0) parts.push(`${created} new`);
  if (changed > 0) parts.push(`${changed} changed`);
  if (dropped > 0) parts.push(`${dropped} dropped`);
  return parts.length > 0 ? parts.join(" · ") : "No schema changes";
}
