"use client";

import Link from "next/link";
import { PanelLeftOpenIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/hooks/use-hydrated";
import { useConnection } from "@/lib/store/connections";
import { useBrowseState } from "@/lib/store/explorer";
import { resolveConnectionColor } from "@/lib/connection-colors";
import { ExplorerProvider } from "./explorer-provider";
import { Sidebar } from "./sidebar";
import { CommandPalette } from "./command-palette";
import { TablePalette } from "./table-palette";

export function ExplorerShell({
  connectionId,
  children,
}: {
  connectionId: string;
  children: ReactNode;
}) {
  const hydrated = useHydrated();
  const connection = useConnection(connectionId);
  const [browse, setBrowse] = useBrowseState(connectionId);

  if (!hydrated) return null;

  if (!connection) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
        <p>Connection not found</p>
        <Link href="/" className="text-foreground underline underline-offset-4">
          Connections
        </Link>
      </div>
    );
  }

  const color = resolveConnectionColor(connection);

  return (
    <ExplorerProvider connection={connection}>
      <div className="flex h-dvh flex-col overflow-hidden">
        <div
          aria-hidden
          title={connection.name}
          className="h-1.5 w-full shrink-0"
          style={{ background: color }}
        />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {browse.sidebarCollapsed ? (
            <aside className="relative flex h-full w-10 shrink-0 justify-center border-r bg-sidebar pt-2">
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 w-1"
                style={{ background: color }}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Show database sidebar"
                title="Show sidebar"
                onClick={() => setBrowse({ sidebarCollapsed: false })}
              >
                <PanelLeftOpenIcon />
              </Button>
            </aside>
          ) : (
            <Sidebar
              key={connection.id}
              width={browse.sidebarWidth}
              onWidthChange={(sidebarWidth) => setBrowse({ sidebarWidth })}
              onCollapse={() => setBrowse({ sidebarCollapsed: true })}
            />
          )}
          <main className="flex min-w-0 flex-1 flex-col">{children}</main>
        </div>
      </div>
      <TablePalette />
      <CommandPalette />
    </ExplorerProvider>
  );
}
