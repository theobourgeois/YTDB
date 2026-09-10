"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useBrowseState } from "@/lib/store/explorer";
import { useNavigation } from "@/lib/store/navigation";
import { routeHref } from "@/lib/routes";
import { SHORTCUTS } from "@/lib/shortcuts";
import { tableKey } from "@/lib/types";
import { useExplorerContext } from "./explorer-provider";

/**
 * A connection's front door. Opens the table the user last had open on it, so
 * coming back picks up where they left off; asks for a table only the first time.
 */
export function ConnectionHome() {
  const router = useRouter();
  const { connection, tables } = useExplorerContext();
  const [browse] = useBrowseState(connection.id);

  const resumeKey = browse.recentTables[0] ?? null;
  const resume = resumeKey
    ? (tables.data ?? []).find((table) => tableKey(table) === resumeKey)
    : undefined;

  useEffect(() => {
    if (!resume) return;
    useNavigation.getState().markReplace();
    router.replace(
      routeHref({
        kind: "table",
        connectionId: connection.id,
        table: { schema: resume.schema, name: resume.name },
      }),
    );
  }, [resume, connection.id, router]);

  if (!tables.data || resume) return null;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1.5 text-muted-foreground">
      <p className="text-sm">Select a table</p>
      <kbd className="font-mono text-[11px] text-muted-foreground/60">{SHORTCUTS.tableSearch}</kbd>
    </div>
  );
}
