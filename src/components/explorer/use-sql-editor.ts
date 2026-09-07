"use client";

import { usePathname, useRouter } from "next/navigation";
import { useBrowseState } from "@/lib/store/explorer";
import { tableKey } from "@/lib/types";
import { useExplorerContext } from "./explorer-provider";

/**
 * Toggles between the SQL editor and the table the user came from, so the same
 * shortcut opens and closes the editor.
 */
export function useSqlEditor() {
  const router = useRouter();
  const pathname = usePathname();
  const { connection, tables } = useExplorerContext();
  const [browse] = useBrowseState(connection.id);

  const base = `/${encodeURIComponent(connection.id)}`;
  const queryHref = `${base}/query`;
  const open = pathname === queryHref;

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
    queryHref,
    toggle: () => router.push(open ? backHref() : queryHref),
  };
}
