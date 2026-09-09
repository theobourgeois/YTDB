"use client";

import { useConnectionPane } from "./use-connection-pane";

export function useSchemaDiff() {
  const pane = useConnectionPane("diff");
  return { open: pane.open, diffHref: pane.href, toggle: pane.toggle };
}
