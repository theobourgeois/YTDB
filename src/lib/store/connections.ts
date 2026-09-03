import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nextConnectionColor, resolveConnectionColor } from "../connection-colors";
import type { Connection } from "../types";
import { randomId } from "../utils";
import { migrateLegacyStorage } from "./storage-migration";

const STORAGE_KEY = "ytdb:connections";
migrateLegacyStorage("db-studio:connections", STORAGE_KEY);

type ConnectionsState = {
  connections: Connection[];
  add: (input: Omit<Connection, "id">) => Connection;
  update: (id: string, input: Partial<Omit<Connection, "id">>) => void;
  remove: (id: string) => void;
};

export const useConnections = create<ConnectionsState>()(
  persist(
    (set, get) => ({
      connections: [],
      add: (input) => {
        const color =
          input.color ??
          nextConnectionColor(
            get().connections.map((connection) => resolveConnectionColor(connection)),
          );
        const connection = { id: randomId(), ...input, color };
        set((state) => ({ connections: [...state.connections, connection] }));
        return connection;
      },
      update: (id, input) =>
        set((state) => ({
          connections: state.connections.map((c) => (c.id === id ? { ...c, ...input } : c)),
        })),
      remove: (id) =>
        set((state) => ({ connections: state.connections.filter((c) => c.id !== id) })),
    }),
    { name: STORAGE_KEY },
  ),
);

export function useConnection(id: string): Connection | undefined {
  return useConnections((state) => state.connections.find((c) => c.id === id));
}
