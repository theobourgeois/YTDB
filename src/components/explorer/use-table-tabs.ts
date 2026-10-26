"use client";

import { useParams, useRouter } from "next/navigation";
import { useMemo } from "react";
import { useBrowseState } from "@/lib/store/explorer";
import { usePreferences } from "@/lib/store/preferences";
import { routeHref } from "@/lib/routes";
import { tableKey, type TableInfo } from "@/lib/types";
import { useExplorerContext } from "./explorer-provider";

/** The tables open as tabs on this connection, and how to close them. */
export function useTableTabs() {
  const router = useRouter();
  const params = useParams<{ schema?: string; table?: string }>();
  const { connection, tables } = useExplorerContext();
  const [browse, setBrowse] = useBrowseState(connection.id);
  const enabled = usePreferences((state) => state.tabView);

  const activeKey =
    params.schema && params.table
      ? tableKey({ schema: decodeURIComponent(params.schema), name: decodeURIComponent(params.table) })
      : null;

  // Tables dropped since they were opened fall away.
  const tabs = useMemo((): TableInfo[] => {
    const byKey = new Map((tables.data ?? []).map((table) => [tableKey(table), table]));
    return browse.openTabs.flatMap((key) => byKey.get(key) ?? []);
  }, [browse.openTabs, tables.data]);

  function go(table: TableInfo | undefined) {
    router.push(
      table
        ? routeHref({ kind: "table", connectionId: connection.id, table })
        : routeHref({ kind: "connection", connectionId: connection.id }),
    );
  }

  /** Closes a tab; closing the one in view moves to its neighbour. */
  function close(key: string) {
    const position = tabs.findIndex((table) => tableKey(table) === key);
    if (position === -1) return;
    const remaining = tabs.filter((table) => tableKey(table) !== key);
    setBrowse({ openTabs: remaining.map(tableKey) });
    if (key === activeKey) go(remaining[Math.min(position, remaining.length - 1)]);
  }

  function closeOthers(key: string) {
    setBrowse({ openTabs: tabs.some((table) => tableKey(table) === key) ? [key] : [] });
  }

  return { enabled, tabs, activeKey, close, closeOthers };
}
