"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { dismissPalettes } from "@/lib/palettes";
import { equivalentHref, parseRoute } from "@/lib/routes";
import { useConnections } from "@/lib/store/connections";
import type { Connection, TableInfo, TableRef } from "@/lib/types";
import { useExplorerContext } from "./explorer-provider";

export function nextConnection(
  connections: Connection[],
  currentId: string,
): Connection | undefined {
  const currentIndex = connections.findIndex((item) => item.id === currentId);
  if (connections.length < 2 || currentIndex === -1) return undefined;
  return connections[(currentIndex + 1) % connections.length];
}

export function tableExistsOnConnection(tables: TableInfo[], table: TableRef): boolean {
  return tables.some((item) => item.schema === table.schema && item.name === table.name);
}

/**
 * Opens another connection at the same place the user is now: the same table,
 * the SQL editor, the same migration. A linked connection is the same database
 * in another environment, so the table is assumed to be there; otherwise the
 * destination is asked first, so the switch cannot land on a table it lacks.
 */
export function useGoToConnection() {
  const router = useRouter();
  const pathname = usePathname();
  const { connection } = useExplorerContext();
  const connections = useConnections((state) => state.connections);

  return useCallback(
    async (targetId: string) => {
      if (targetId === connection.id) return;
      const target = connections.find((item) => item.id === targetId);
      if (!target) return;
      dismissPalettes();

      const route = parseRoute(pathname);
      const linked = Boolean(connection.layoutGroup) && connection.layoutGroup === target.layoutGroup;
      let tableExists = true;
      if (route.kind === "table" && !linked) {
        try {
          tableExists = tableExistsOnConnection(await api.tables(target.url), route.table);
        } catch {
          // Unreachable for now; still land on that connection.
          tableExists = false;
        }
      }
      router.push(equivalentHref(pathname, targetId, { tableExists }));
    },
    [connection.id, connection.layoutGroup, connections, pathname, router],
  );
}

/** Cycles to the next saved connection, staying on the same page. */
export function useSwitchConnection() {
  const { connection } = useExplorerContext();
  const connections = useConnections((state) => state.connections);
  const goTo = useGoToConnection();
  const next = nextConnection(connections, connection.id);

  return {
    run: () => (next ? goTo(next.id) : Promise.resolve()),
    enabled: next !== undefined,
    next,
  };
}
