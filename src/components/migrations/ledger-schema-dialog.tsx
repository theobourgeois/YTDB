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
          <DialogTitle>Ledger schema</DialogTitle>
          <DialogDescription>
            Where each database keeps its record of what has run. Created on the first apply.
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

        {elsewhere.length > 0 && (
          <p className="rounded-md border border-amber-600/25 bg-amber-500/8 px-3 py-2 text-xs">
            {elsewhere.map((item) => `${item.name} keeps its ledger in ${item.schema}`).join("; ")}.
            That one stays where it is.
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
