"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import { useConnections } from "@/lib/store/connections";
import { useMigrations } from "@/lib/store/migrations";
import { useNavigation } from "@/lib/store/navigation";
import { parseRoute, type Route } from "@/lib/routes";

export type HistoryStop = {
  href: string;
  route: Route;
  /** What the place is called, for a tooltip or a menu item. */
  label: string;
};

/**
 * Names a place the way its page does, adding the connection when it is not
 * the one the user is looking at.
 */
export function useRouteLabel() {
  const connections = useConnections((state) => state.connections);
  const sets = useMigrations((state) => state.sets);

  return useCallback(
    (route: Route, currentConnectionId?: string): string => {
      const connectionName = (id: string) =>
        connections.find((item) => item.id === id)?.name ?? id;
      const suffix =
        "connectionId" in route && route.connectionId !== currentConnectionId
          ? ` · ${connectionName(route.connectionId)}`
          : "";
      switch (route.kind) {
        case "home":
          return "Connections";
        case "connection":
          return connectionName(route.connectionId);
        case "query":
          return `SQL query${suffix}`;
        case "diff":
          return `Compare schema${suffix}`;
        case "migrations":
          return `Migrations${suffix}`;
        case "migration":
          return `${sets.find((set) => set.id === route.setId)?.name ?? "Migration"}${suffix}`;
        case "table":
          return `${route.table.name}${suffix}`;
      }
    },
    [connections, sets],
  );
}

/** The app's back/forward, with where each one leads. */
export function useNavigationHistory(currentConnectionId?: string) {
  const router = useRouter();
  const entries = useNavigation((state) => state.entries);
  const index = useNavigation((state) => state.index);
  const label = useRouteLabel();

  return useMemo(() => {
    const stop = (position: number): HistoryStop | null => {
      const href = entries[position];
      if (href === undefined) return null;
      const route = parseRoute(href);
      return { href, route, label: label(route, currentConnectionId) };
    };
    const back = stop(index - 1);
    const forward = stop(index + 1);
    return {
      back,
      forward,
      goBack: () => {
        if (back) router.back();
      },
      goForward: () => {
        if (forward) router.forward();
      },
    };
  }, [entries, index, label, currentConnectionId, router]);
}
