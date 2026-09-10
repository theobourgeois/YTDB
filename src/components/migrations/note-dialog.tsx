"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { MAX_NOTE_LENGTH } from "@/lib/migrations/types";

type Props = {
  initial: string;
  /** The file the note is written to, for a migration read from a folder. */
  file: string | null;
  onOpenChange: (open: boolean) => void;
  /** Throws when the note could not be kept, so the dialog stays open and says why. */
  onSave: (note: string) => Promise<void> | void;
};

/** Writes the note on how to run a migration. Emptying it removes the note. */
export function MigrationNoteDialog({ initial, file, onOpenChange, onSave }: Props) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = value.trim() !== initial.trim();

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!changed || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(value.trim());
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <DialogHeader>
            <div className="flex items-baseline gap-3">
              <DialogTitle>Note</DialogTitle>
              {file && (
                <span
                  className="ml-auto truncate font-mono text-[11px] text-muted-foreground"
                  title="Written into the migration's folder, to commit with the SQL"
                >
                  {file}
                </span>
              )}
            </div>
          </DialogHeader>
          <Textarea
            autoFocus
            aria-label="Note"
            value={value}
            maxLength={MAX_NOTE_LENGTH}
            placeholder="Apply 0001–0007, deploy the app, then apply 0008."
            className="max-h-[50vh] min-h-32"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit();
            }}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!changed || saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
