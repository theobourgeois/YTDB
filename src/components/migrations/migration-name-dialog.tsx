"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Props = {
  open: boolean;
  title: string;
  /** What the input starts with; empty for a new migration. */
  initial?: string;
  submitLabel: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => void;
};

/** Asks for a migration's name, for creating one or renaming it. */
export function MigrationNameDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        {props.open && <NameForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function NameForm({ title, initial = "", submitLabel, onOpenChange, onSubmit }: Props) {
  const [name, setName] = useState(initial);
  const trimmed = name.trim();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmed) return;
    onSubmit(trimmed);
    onOpenChange(false);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <Input
        autoFocus
        aria-label="Migration name"
        value={name}
        placeholder="add_users_table"
        onChange={(event) => setName(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
      />
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={!trimmed}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
