"use client";

import { ConnectionList } from "@/components/connections/connection-list";
import { useHydrated } from "@/hooks/use-hydrated";

export default function Home() {
  const hydrated = useHydrated();

  return (
    <main className="mx-auto w-full max-w-lg px-6 py-24">
      {hydrated && <ConnectionList />}
    </main>
  );
}
