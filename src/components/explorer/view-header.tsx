"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { HistoryButtons } from "./history-buttons";

/** The bar across the top of every view: back and forward, then what the view is. */
export function ViewHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <header
      className={cn("flex h-11 shrink-0 items-center gap-2 border-b pr-3 pl-1.5", className)}
    >
      <HistoryButtons className="mr-0.5" />
      {children}
    </header>
  );
}
