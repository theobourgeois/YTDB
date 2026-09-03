"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import { Link2Icon } from "lucide-react";
import type { Cell } from "@/lib/types";
import { HighlightMatch } from "./highlight-match";

type Props = {
  value: Cell;
  label: string | null;
  referenced: string;
  query?: string;
  onOpen: (event: ReactMouseEvent<HTMLButtonElement>) => void;
};

export function FkCellValue({ value, label, referenced, query = "", onOpen }: Props) {
  if (value === null) return <span className="text-muted-foreground/60">null</span>;
  const text = String(value);
  const showLabel = label !== null && label !== text;

  return (
    <button
      type="button"
      aria-label={`View referenced row in ${referenced}`}
      title={`${showLabel ? `${label} · ` : ""}${text} → ${referenced}`}
      onClick={onOpen}
      onDoubleClick={(event) => event.stopPropagation()}
      className="inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
    >
      <Link2Icon className="size-3 shrink-0 text-muted-foreground/70" />
      {showLabel && label !== null ? (
        <>
          <span className="truncate underline decoration-foreground/20 underline-offset-2">
            <HighlightMatch text={label} query={query} />
          </span>
          <span className="truncate text-muted-foreground/55">
            <HighlightMatch text={text} query={query} />
          </span>
        </>
      ) : (
        <span className="truncate underline decoration-foreground/20 underline-offset-2">
          <HighlightMatch text={text} query={query} />
        </span>
      )}
    </button>
  );
}
