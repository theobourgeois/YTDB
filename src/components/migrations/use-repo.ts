"use client";

import { useAsync, type AsyncState } from "@/hooks/use-async";
import { api } from "@/lib/api";
import type { RepoRead } from "@/lib/migrations/types";

/**
 * The migrations folder, read fresh from disk every time the page needs it.
 * Nothing is cached across visits on purpose: switching branches changes what
 * is in the folder, and the list has to say so without being told.
 */
export function useRepo(root: string | null): AsyncState<RepoRead | null> {
  return useAsync<RepoRead | null>(`repo:${root ?? ""}`, async (signal) => {
    if (!root) return null;
    return api.repo(root, signal);
  });
}
