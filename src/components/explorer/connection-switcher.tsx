"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronsUpDownIcon, Link2Icon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConnections } from "@/lib/store/connections";
import type { Connection } from "@/lib/types";
import { ConnectionColorMark } from "@/components/connections/connection-color";

export function ConnectionSwitcher({ current }: { current: Connection }) {
  const router = useRouter();
  const connections = useConnections((s) => s.connections);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-8 w-full items-center justify-between gap-2 rounded-lg px-2 text-left font-medium outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 data-open:bg-muted/60">
        <span className="flex min-w-0 items-center gap-2">
          <ConnectionColorMark connection={current} />
          <span className="truncate">{current.name}</span>
          {current.layoutGroup && (
            <Link2Icon className="size-3.5 shrink-0 text-muted-foreground" />
          )}
        </span>
        <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-(--anchor-width)">
        {connections.map((connection) => (
          <DropdownMenuItem
            key={connection.id}
            onClick={() => router.push(`/${connection.id}`)}
            className={connection.id === current.id ? "font-medium" : undefined}
          >
            <ConnectionColorMark connection={connection} />
            <span className="min-w-0 flex-1 truncate">{connection.name}</span>
            {connection.layoutGroup && connection.layoutGroup === current.layoutGroup && (
              <Link2Icon className="size-3.5 shrink-0 text-muted-foreground" />
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/" />}>Manage connections</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
