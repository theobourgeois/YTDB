"use client";

import { useState } from "react";
import { ConnectionColorMark } from "@/components/connections/connection-color";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import type { AdoptEntry, AdoptResult } from "@/lib/migrations/types";
import type { Connection } from "@/lib/types";
import { describeConnection } from "./run-dialog";

export type AdoptPlan = {
  /** How many sets the rows come from, for the summary. */
  sets: number;
  entries: AdoptEntry[];
};

type Props = {
  connection: Connection;
  ledgerSchema: string;
  plan: AdoptPlan;
  onDone: () => void;
  onOpenChange: (open: boolean) => void;
};

/**
 * Marks everything in the folder as already applied on one database, in one
 * transaction and without running any SQL. This is how a database that was
 * migrated by hand before the ledger existed gets a ledger that tells the truth:
 * after it, only what is genuinely new shows as pending.
 */
export function AdoptDialog({ connection, ledgerSchema, plan, onDone, onOpenChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AdoptResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const count = plan.entries.length;

  async function adopt() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.adopt(connection.url, { ledgerSchema, entries: plan.entries }));
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {result
              ? `Marked ${result.recorded} as applied`
              : `Mark ${count} migration${count === 1 ? "" : "s"} as already applied?`}
          </DialogTitle>
          <DialogDescription>
            <span className="flex flex-wrap items-center gap-1.5">
              <span>{result ? "Recorded on" : "Records on"}</span>
              <ConnectionColorMark connection={connection} />
              <span className="font-medium text-foreground">{connection.name}</span>
              <span className="font-mono text-[11px]">{describeConnection(connection.url)}</span>
            </span>
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <p className="text-xs text-muted-foreground">
            {result.existing > 0
              ? `${result.existing} were already in the ledger and were left as they were.`
              : "Every one of them was new to the ledger."}
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Everything in the folder that {connection.name} has no ledger row for, across{" "}
              {plan.sets} migration{plan.sets === 1 ? "" : "s"}. Use this once, for a database
              whose schema already has these changes, so that from here on only new work shows
              as pending.
            </p>
            <p className="rounded-md border border-amber-600/25 bg-amber-500/8 px-3 py-2 text-xs">
              <span className="font-medium">No SQL runs.</span> Only the ledger on{" "}
              {connection.name} changes, in one transaction. Rows already there are not touched.
            </p>
          </>
        )}

        {error && (
          <p className="max-h-32 overflow-auto rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 font-mono text-[11px] whitespace-pre-wrap text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          ) : (
            <>
              <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button disabled={busy || count === 0} onClick={() => void adopt()}>
                {busy ? "Marking…" : `Mark as applied (${count})`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
