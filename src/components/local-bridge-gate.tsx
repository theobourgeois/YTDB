"use client";

import { useEffect, useState, type ReactNode } from "react";
import { bridgeFetch, isHostedUi } from "@/lib/bridge";

type Status = "local" | "checking" | "offline" | "outdated" | "ready";

const RETRY_MS = 1500;

export function LocalBridgeGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const probe = async (): Promise<Status> => {
      if (!isHostedUi()) return "local";
      try {
        const response = await bridgeFetch("/api/health", { signal: controller.signal });
        if (response.ok) return "ready";
        // Older bridges still demand the per-launch token this UI no longer sends.
        return response.status === 401 ? "outdated" : "offline";
      } catch {
        return "offline";
      }
    };
    // Keep probing until the bridge answers, so starting the CLI unlocks an open tab.
    const check = async () => {
      const next = await probe();
      if (controller.signal.aborted) return;
      setStatus(next);
      if (next !== "local" && next !== "ready") timer = setTimeout(check, RETRY_MS);
    };

    void check();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);

  if (status === "local" || status === "ready") return children;

  const outdated = status === "outdated";
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-6 text-foreground">
      <div className="max-w-lg space-y-4">
        <p className="font-mono text-xs tracking-[0.22em] text-muted-foreground">YTDB</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {status === "checking"
            ? "Connecting to YTDB…"
            : outdated
              ? "Update the local YTDB bridge"
              : "Start the local YTDB bridge"}
        </h1>
        {status !== "checking" && (
          <>
            <p className="text-sm leading-6 text-muted-foreground">
              Your database connection stays on this computer. This page connects as soon as the
              bridge is running.
            </p>
            <pre className="w-fit rounded-md border bg-muted px-4 py-3 font-mono text-sm">
              {outdated ? "npx @theobourgeois/ytdb@latest" : "npx @theobourgeois/ytdb"}
            </pre>
          </>
        )}
      </div>
    </main>
  );
}
