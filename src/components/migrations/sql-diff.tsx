"use client";

import { useMemo } from "react";
import { diffLines, toHunks, type DiffLine } from "@/lib/migrations/diff";
import { cn } from "@/lib/utils";

const SIGN: Record<DiffLine["kind"], string> = { same: " ", add: "+", remove: "-" };

/** A git-style unified diff: removed lines red, added green, three lines of context around each change. */
export function SqlDiff({
  before,
  after,
  className,
}: {
  before: string;
  after: string;
  className?: string;
}) {
  const hunks = useMemo(() => toHunks(diffLines(before, after)), [before, after]);

  if (hunks.length === 0) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        Only whitespace at the end of the file differs.
      </p>
    );
  }

  return (
    <div className={cn("overflow-auto font-mono text-[11px] leading-5", className)}>
      <table className="w-full border-collapse">
        {hunks.map((hunk) => (
          <tbody key={hunk.header}>
            <tr>
              <td colSpan={3} className="bg-muted/60 px-3 text-muted-foreground select-none">
                {hunk.header}
              </td>
            </tr>
            {hunk.lines.map((line, index) => (
              <tr
                key={index}
                className={cn(
                  line.kind === "add" && "bg-emerald-500/12",
                  line.kind === "remove" && "bg-red-500/12",
                )}
              >
                <LineNumber value={line.oldNo} />
                <LineNumber value={line.newNo} />
                <td className="pr-3 whitespace-pre">
                  <span
                    className={cn(
                      "inline-block w-4 pl-1 select-none",
                      line.kind === "add" && "text-emerald-600 dark:text-emerald-400",
                      line.kind === "remove" && "text-red-600 dark:text-red-400",
                    )}
                  >
                    {SIGN[line.kind]}
                  </span>
                  {line.text}
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function LineNumber({ value }: { value: number | null }) {
  return (
    <td className="w-10 min-w-10 pr-2 text-right text-muted-foreground/50 tabular-nums select-none">
      {value ?? ""}
    </td>
  );
}
