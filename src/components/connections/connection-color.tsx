"use client";

import { cn } from "@/lib/utils";
import { resolveConnectionColor } from "@/lib/connection-colors";
import type { Connection } from "@/lib/types";

export function ConnectionColorMark({
  connection,
  className,
}: {
  connection: Pick<Connection, "id" | "color">;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("size-2.5 shrink-0 rounded-full", className)}
      style={{ background: resolveConnectionColor(connection) }}
    />
  );
}
