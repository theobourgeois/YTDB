"use client";

import { useConnectionPane } from "./use-connection-pane";

export function useMigrationsPane() {
  const pane = useConnectionPane("migrations");
  return { open: pane.open, migrationsHref: pane.href, toggle: pane.toggle };
}
