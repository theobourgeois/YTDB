"use client";

import { useMemo, useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { tokenizeSql, tokensByLine, type SqlToken, type SqlTokenKind } from "@/lib/sql-highlight";
import { cn } from "@/lib/utils";

function tokenClass(kind: SqlTokenKind): string {
  switch (kind) {
    case "keyword":
      return "text-sky-700 dark:text-sky-400";
    case "function":
      return "text-violet-700 dark:text-fuchsia-400";
    case "ident":
      return "text-foreground";
    case "string":
    case "number":
      return "text-amber-700 dark:text-amber-300";
    case "comment":
      return "text-muted-foreground";
    case "text":
      return "text-foreground/80";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function Line({ tokens }: { tokens: SqlToken[] }) {
  return tokens.map((token, index) => (
    <span key={index} className={tokenClass(token.kind)}>
      {token.value}
    </span>
  ));
}

export async function copySql(sql: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(sql);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = sql;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

/** Highlighted SQL without a gutter, for previews inside another list or panel. */
export function SqlCode({ sql, className }: { sql: string; className?: string }) {
  const lines = useMemo(() => tokensByLine(tokenizeSql(sql.trimEnd())), [sql]);
  return (
    <pre
      className={cn(
        "overflow-x-auto font-mono text-[12px] leading-5 whitespace-pre",
        className,
      )}
    >
      <code>
        {lines.map((line, index) => (
          <div key={index} className="min-h-5">
            <Line tokens={line} />
          </div>
        ))}
      </code>
    </pre>
  );
}

/** A full pane of SQL: line numbers, a copy button, and room for extra actions. */
export function SqlSource({
  sql,
  error,
  loading,
  actions,
}: {
  sql: string | undefined;
  error: string | null;
  loading: boolean;
  actions?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const lines = useMemo(
    () => (sql ? tokensByLine(tokenizeSql(sql.trimEnd())) : []),
    [sql],
  );

  if (error) {
    return <p className="flex-1 px-4 py-6 font-mono text-xs text-destructive">{error}</p>;
  }

  if (!sql || (loading && lines.length === 0)) {
    return (
      <div className="flex flex-col gap-2 p-4">
        {Array.from({ length: 16 }, (_, index) => (
          <Skeleton key={index} className="h-4 w-full" />
        ))}
      </div>
    );
  }

  async function copy() {
    if (!sql) return;
    await copySql(sql);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  const gutter = `${Math.max(String(lines.length).length, 2) + 1}ch`;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-sql-source="">
      <div className="flex shrink-0 items-center justify-end gap-2 px-3 py-1">
        {actions}
        <Button type="button" variant="ghost" size="sm" onClick={() => void copy()}>
          {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
          {copied ? "Copied" : "Copy SQL"}
        </Button>
      </div>
      <div className={cn("min-h-0 flex-1 overflow-auto", loading && "opacity-60")}>
        <pre className="min-w-max px-4 pb-4 font-mono text-[13px] leading-6">
          {lines.map((line, index) => (
            <div key={index} className="flex min-h-6">
              <span
                className="sticky left-0 shrink-0 bg-background pr-4 text-right text-muted-foreground/45 select-none"
                style={{ width: gutter }}
              >
                {index + 1}
              </span>
              <code className="pr-8 whitespace-pre">
                <Line tokens={line} />
              </code>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
