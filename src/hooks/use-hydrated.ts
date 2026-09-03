import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** True once rendering on the client, so persisted stores can be trusted. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
