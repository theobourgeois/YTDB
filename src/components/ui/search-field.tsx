"use client";

import { SearchIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = Omit<ComponentProps<"input">, "className"> & {
  /** Rendered after the input, inside the same row. */
  trailing?: ReactNode;
  className?: string;
};

/**
 * A borderless search row that sits in a list the way a ghost button does, so it
 * reads as part of the list rather than as a form control dropped on top of it.
 */
export function SearchField({ trailing, className, ...props }: Props) {
  return (
    <div
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-lg px-2 text-muted-foreground transition-colors focus-within:bg-muted/60 hover:bg-muted/60",
        className,
      )}
    >
      <SearchIcon className="size-3.5 shrink-0" />
      <input
        type="text"
        spellCheck={false}
        autoComplete="off"
        {...props}
        className="h-full min-w-0 flex-1 bg-transparent text-[0.8rem] text-foreground outline-none placeholder:text-muted-foreground"
      />
      {trailing}
    </div>
  );
}
