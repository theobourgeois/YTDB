"use client";

import { useConnectionPane } from "./use-connection-pane";

export function useSqlEditor() {
  const pane = useConnectionPane("query");
  return { open: pane.open, queryHref: pane.href, toggle: pane.toggle };
}
