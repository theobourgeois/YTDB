"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { TimelinePage, TimelineQuery } from "@/lib/migrations/timeline";
import type { Connection } from "@/lib/types";

export type TimelineRead = { page?: TimelinePage; error?: string };

/** Pages restart whenever the environment/filter scope changes. SQL is fetched separately. */
export function useTimeline(connections: Connection[], schema: string, query: TimelineQuery) {
  const [reads, setReads] = useState<Record<string, TimelineRead>>({});
  const [loading, setLoading] = useState(true);
  const snapshot = useRef(reads);
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const scope = JSON.stringify([connections.map((item) => [item.id, item.url]), schema, query]);
  const loadedScope = useRef(scope);

  const load = useCallback(async (older = false) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    const abort = new AbortController();
    controller.current = abort;
    const next = { ...snapshot.current };
    await Promise.all(connections.map(async (connection) => {
      const previous = snapshot.current[connection.id]?.page;
      if (older && !previous?.nextCursor) return;
      try {
        const page = await api.timeline(connection.url, schema, {
          ...query, before: older ? previous?.nextCursor ?? undefined : undefined,
        }, abort.signal);
        if (previous && page.initialized) {
          const incoming = new Set(page.events.map((event) => event.id));
          // If more than a full page arrived, restart pagination so no gap is
          // silently skipped. Otherwise keep the user's expanded older history.
          const overlap = page.events.some((event) => previous.events.some((old) => old.id === event.id));
          if (older || overlap) {
            page.events = [...page.events, ...previous.events.filter((event) => !incoming.has(event.id))]
              .sort((a, b) => BigInt(a.sequence) > BigInt(b.sequence) ? -1 : 1);
            if (!older) page.nextCursor = previous.nextCursor;
          }
        }
        next[connection.id] = { page };
      } catch (error) {
        next[connection.id] = { page: previous, error: error instanceof Error ? error.message : String(error) };
      }
    }));
    if (!abort.signal.aborted) {
      snapshot.current = next;
      setReads(next);
      setLoading(false);
      busy.current = false;
    }
  }, [connections, schema, query]);

  useEffect(() => {
    busy.current = false;
    // A new scope must not merge into the previous scope's pages. The old list
    // stays on screen until the replacement arrives.
    if (loadedScope.current !== scope) {
      loadedScope.current = scope;
      snapshot.current = {};
    }
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    // Debounce search/filter changes and avoid fetching abandoned scopes.
    const initial = window.setTimeout(() => void load(), 200);
    const timer = window.setInterval(refresh, 10_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      controller.current?.abort();
    };
  }, [load, scope]);

  return { reads, loading, refresh: () => void load(), loadMore: () => void load(true),
    hasMore: Object.values(reads).some((read) => Boolean(read.page?.nextCursor)) };
}
