"use client";

import { useState } from "react";
import { CheckCircle2Icon } from "lucide-react";
import type { Cell, SqlQueryResult, SqlStatementResult } from "@/lib/types";
import { cn } from "@/lib/utils";

function displayCell(value: Cell): string {
  if (value === null) return "null";
  return String(value);
}

function rowLabel(statement: SqlStatementResult): string | null {
  if (statement.truncated) return `${statement.rows.length.toLocaleString()}+ rows`;
  const count = statement.rowCount ?? statement.rows.length;
  if (statement.columns.length === 0 && statement.rowCount === null) return null;
  return `${count.toLocaleString()} ${count === 1 ? "row" : "rows"}`;
}

function ResultTable({ statement }: { statement: SqlStatementResult }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="min-w-full border-separate border-spacing-0 font-mono text-xs">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-20 h-8 w-10 border-r border-b bg-muted px-2 text-right font-normal text-muted-foreground">
              #
            </th>
            {statement.columns.map((column, index) => (
              <th
                key={`${column}:${index}`}
                className="sticky top-0 z-10 h-8 min-w-32 border-r border-b bg-muted px-3 text-left font-medium whitespace-nowrap text-foreground last:border-r-0"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {statement.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="group hover:bg-muted/45">
              <th className="sticky left-0 z-10 h-8 border-r border-b bg-background px-2 text-right font-normal text-muted-foreground group-hover:bg-muted">
                {rowIndex + 1}
              </th>
              {statement.columns.map((column, columnIndex) => {
                const value = row[columnIndex] ?? null;
                const text = displayCell(value);
                return (
                  <td
                    key={`${column}:${columnIndex}`}
                    title={text}
                    className="h-8 max-w-96 min-w-32 border-r border-b px-3 whitespace-nowrap last:border-r-0"
                  >
                    <span
                      className={
                        value === null
                          ? "text-muted-foreground/65"
                          : "block max-w-96 truncate text-foreground/90"
                      }
                    >
                      {text}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {statement.rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">Query returned no rows.</p>
      ) : null}
    </div>
  );
}

export function QueryResultGrid({
  result,
  loading,
}: {
  result: SqlQueryResult | null;
  loading: boolean;
}) {
  const [selection, setSelection] = useState<{
    source: SqlQueryResult | null;
    index: number;
  }>({ source: null, index: 0 });

  if (!result) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
        Run a query or migration to see its results.
      </div>
    );
  }

  let activeIndex = selection.index;
  if (selection.source !== result) {
    activeIndex = Math.max(0, result.statements.length - 1);
    setSelection({ source: result, index: activeIndex });
  }
  const statement = result.statements[activeIndex];

  if (!statement) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
        Execution completed without a result.
      </div>
    );
  }

  const rows = rowLabel(statement);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", loading && "opacity-55")} data-query-results="">
      <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b px-2 text-xs">
        <span className="mr-1 shrink-0 font-medium">Results</span>
        {result.statements.length > 1 ? (
          result.statements.map((item, index) => (
            <button
              key={index}
              type="button"
              aria-pressed={index === activeIndex}
              onClick={() => setSelection({ source: result, index })}
              className={cn(
                "h-6 shrink-0 rounded-md px-2 font-mono text-[11px] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60",
                index === activeIndex && "bg-muted text-foreground",
              )}
            >
              {index + 1} {item.command}
            </button>
          ))
        ) : (
          <span className="font-mono text-[11px] text-muted-foreground">{statement.command}</span>
        )}
        {rows ? <span className="ml-1 shrink-0 text-muted-foreground">· {rows}</span> : null}
        {statement.truncated ? (
          <span className="shrink-0 text-muted-foreground">· limited to {statement.rows.length}</span>
        ) : null}
        <span className="ml-auto shrink-0 font-mono tabular-nums text-muted-foreground">
          {result.durationMs.toLocaleString()} ms
        </span>
      </div>

      {statement.columns.length > 0 ? (
        <ResultTable statement={statement} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <CheckCircle2Icon className="size-5 text-emerald-600 dark:text-emerald-400" />
          <p className="font-medium">{statement.command} completed</p>
          {rows ? <p className="text-xs text-muted-foreground">{rows} affected</p> : null}
        </div>
      )}
    </div>
  );
}
