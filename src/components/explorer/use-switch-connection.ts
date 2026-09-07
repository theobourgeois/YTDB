"use client";

import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { dismissPalettes } from "@/lib/palettes";
import { useConnections } from "@/lib/store/connections";
import type { Connection, TableInfo, TableRef } from "@/lib/types";
import { useExplorerContext } from "./explorer-provider";
import { useSqlEditor } from "./use-sql-editor";

function currentTable(params: { schema?: string; table?: string }): TableRef | null {
  if (!params.schema || !params.table) return null;
  return {
    schema: decodeURIComponent(params.schema),
    name: decodeURIComponent(params.table),
  };
}

function connectionHref(connectionId: string, path = ""): string {
  return `/${encodeURIComponent(connectionId)}${path}`;
}

function tableHref(connectionId: string, table: TableRef): string {
  return connectionHref(
    connectionId,
    `/${encodeURIComponent(table.schema)}/${encodeURIComponent(table.name)}`,
  );
}

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

export function switchConnectionHref(
  nextId: string,
  {
    onQuery,
    table,
    tableExists,
  }: {
    onQuery: boolean;
    table: TableRef | null;
    tableExists: boolean;
  },
): string {
  if (onQuery) return connectionHref(nextId, "/query");
  if (table && tableExists) return tableHref(nextId, table);
  return connectionHref(nextId);
}

/**
 * Cycles to the next saved connection, keeping the SQL editor or the current
 * table when that table also exists on the destination.
 */
export function useSwitchConnection() {
  const router = useRouter();
  const params = useParams<{ connectionId: string; schema?: string; table?: string }>();
  const { connection } = useExplorerContext();
  const connections = useConnections((state) => state.connections);
  const sqlEditor = useSqlEditor();
  const next = nextConnection(connections, connection.id);

  async function run() {
    if (!next) return;
    dismissPalettes();
    const table = currentTable(params);
    let tableExists = false;
    if (!sqlEditor.open && table) {
      try {
        tableExists = tableExistsOnConnection(await api.tables(next.url), table);
      } catch {
        // Destination may be unreachable; still land on that connection.
      }
    }
    router.push(
      switchConnectionHref(next.id, {
        onQuery: sqlEditor.open,
        table,
        tableExists,
      }),
    );
  }

  return {
    run,
    enabled: next !== undefined,
    next,
  };
}
