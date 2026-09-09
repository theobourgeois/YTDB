"use client";

import { usePathname, useRouter } from "next/navigation";
import { useBrowseState } from "@/lib/store/explorer";
import { tableKey } from "@/lib/types";
import { useExplorerContext } from "./explorer-provider";

/**
 * Toggles between a connection-level pane — the SQL editor, schema compare — and
 * the table the user came from, so the same shortcut opens and closes it.
 */
export function useConnectionPane(segment: string) {
  const router = useRouter();
  const pathname = usePathname();
  const { connection, tables } = useExplorerContext();
  const [browse] = useBrowseState(connection.id);

  const base = `/${encodeURIComponent(connection.id)}`;
  const href = `${base}/${segment}`;
  const open = pathname === href;

  function backHref(): string {
    for (const key of browse.recentTables) {
      const table = (tables.data ?? []).find((item) => tableKey(item) === key);
      if (!table) continue;
      return `${base}/${encodeURIComponent(table.schema)}/${encodeURIComponent(table.name)}`;
    }
    return base;
  }

  return {
    open,
    href,
    toggle: () => router.push(open ? backHref() : href),
  };
}
