"use client";

import { useEffect, useState, type ReactNode } from "react";
import { bridgeFetch, getBridgeConfig, isHostedUi } from "@/lib/bridge";

type Status = "local" | "checking" | "missing" | "offline" | "ready";

export function LocalBridgeGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("checking");
  useEffect(() => {
    const controller = new AbortController();
    const check = async (): Promise<Status> => {
      if (!isHostedUi()) { getBridgeConfig(); return "local"; }
      if (!getBridgeConfig()) return "missing";
      const response = await bridgeFetch("/api/health", { signal: controller.signal });
      if (!response.ok) throw new Error("The local bridge rejected this session.");
      return "ready";
    };
    void check().then(setStatus).catch(() => { if (!controller.signal.aborted) setStatus("offline"); });
    return () => controller.abort();
  }, []);
  if (status === "local" || status === "ready") return children;
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-6 text-foreground">
      <div className="max-w-lg space-y-4">
        <p className="font-mono text-xs tracking-[0.22em] text-muted-foreground">YTDB</p>
        <h1 className="text-2xl font-semibold tracking-tight">{status === "checking" ? "Connecting to YTDB…" : "Start the local YTDB bridge"}</h1>
        {status !== "checking" && <><p className="text-sm leading-6 text-muted-foreground">Your database connection stays on this computer. Run the command below and use the browser tab it opens.</p><pre className="w-fit rounded-md border bg-muted px-4 py-3 font-mono text-sm">npx @theobourgeois/ytdb</pre>{status === "offline" && <p className="text-sm text-muted-foreground">This tab has an expired bridge session. Restart the command to create a new one.</p>}</>}
      </div>
    </main>
  );
}
