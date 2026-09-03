"use client";

import { createContext, useContext, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useAsync, type AsyncState } from "@/hooks/use-async";
import type { Connection, TableInfo } from "@/lib/types";

type ExplorerContextValue = {
  connection: Connection;
  tables: AsyncState<TableInfo[]>;
};

const ExplorerContext = createContext<ExplorerContextValue | null>(null);

export function ExplorerProvider({
  connection,
  children,
}: {
  connection: Connection;
  children: ReactNode;
}) {
  const tables = useAsync(connection.url, (signal) => api.tables(connection.url, signal));
  return (
    <ExplorerContext.Provider value={{ connection, tables }}>{children}</ExplorerContext.Provider>
  );
}

export function useExplorerContext(): ExplorerContextValue {
  const value = useContext(ExplorerContext);
  if (!value) throw new Error("useExplorerContext must be used inside ExplorerProvider");
  return value;
}
