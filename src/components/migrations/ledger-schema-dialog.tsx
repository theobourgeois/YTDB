"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_LEDGER_SCHEMA,
  LEDGER_TABLE,
  isLedgerSchema,
} from "@/lib/migrations/types";

type Props = {
  schema: string;
  /** Where each environment's ledger was actually found, when that differs. */
  found: { name: string; schema: string }[];
  onOpenChange: (open: boolean) => void;
  onSave: (schema: string) => void;
};

export function LedgerSchemaDialog({ schema, found, onOpenChange, onSave }: Props) {
  const [value, setValue] = useState(schema);
  const trimmed = value.trim();
  const valid = isLedgerSchema(trimmed);
  const elsewhere = found.filter((item) => item.schema !== trimmed);

  function save() {
    if (!valid) return;
    onSave(trimmed);
    onOpenChange(false);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Where the ledger lives</DialogTitle>
          <DialogDescription>
            Each database records what it has run in its own table. This is the schema that
            table goes in, for every connection — dev and prod have to look in the same place
            for their columns to mean anything.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="ledger-schema">Schema</Label>
          <Input
            id="ledger-schema"
            value={value}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={trimmed.length > 0 && !valid}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && save()}
          />
          <p className="font-mono text-xs text-muted-foreground">
            {valid ? `${trimmed}.${LEDGER_TABLE}` : ` `}
          </p>
          {trimmed.length > 0 && !valid && (
            <p className="text-xs text-destructive">
              Letters, digits and underscores only, starting with a letter or underscore.
            </p>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          The schema is created on the first apply, so the connection needs permission to
          create it. Nothing is created just by reading a ledger.
        </p>

        {elsewhere.length > 0 && (
          <p className="rounded-md border border-amber-600/25 bg-amber-500/8 px-3 py-2 text-xs">
            {elsewhere.map((item) => `${item.name} already keeps its ledger in ${item.schema}`).join("; ")}.
            Those keep being used where they are, so nothing already applied is forgotten.
          </p>
        )}

        <DialogFooter>
          {trimmed !== DEFAULT_LEDGER_SCHEMA && (
            <Button variant="ghost" onClick={() => setValue(DEFAULT_LEDGER_SCHEMA)}>
              Reset
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!valid} onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
