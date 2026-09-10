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

type Props = {
  root: string | null;
  /** The environments that will read from this folder, for the description. */
  environmentNames: string[];
  onOpenChange: (open: boolean) => void;
  onSave: (root: string | null) => void;
};

/**
 * Points these environments at a folder on this machine. The folder is read by
 * the YTDB running locally, so it is a path on this computer and not a URL.
 */
export function RepoRootDialog({ root, environmentNames, onOpenChange, onSave }: Props) {
  const [value, setValue] = useState(root ?? "");
  const trimmed = value.trim();
  const looksAbsolute = trimmed.startsWith("/") || trimmed.startsWith("~") || /^[A-Za-z]:[\\/]/.test(trimmed);

  function save() {
    if (!trimmed || !looksAbsolute) return;
    onSave(trimmed);
    onOpenChange(false);
  }

  function clear() {
    onSave(null);
    onOpenChange(false);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Migrations folder</DialogTitle>
          <DialogDescription>
            A folder on this computer. Each folder inside it that holds .sql files is one
            migration, read fresh from disk every time — whatever branch is checked out is
            what shows. {environmentNames.join(", ")} will all read from it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="repo-root">Path</Label>
          <Input
            id="repo-root"
            value={value}
            placeholder="~/code/app/src/lib/supabase/migrations"
            spellCheck={false}
            autoComplete="off"
            autoFocus
            aria-invalid={trimmed.length > 0 && !looksAbsolute}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && save()}
          />
          {trimmed.length > 0 && !looksAbsolute && (
            <p className="text-xs text-destructive">
              An absolute path, or one starting with ~.
            </p>
          )}
        </div>

        <DialogFooter>
          {root && (
            <Button variant="ghost" className="mr-auto" onClick={clear}>
              Stop reading from disk
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!trimmed || !looksAbsolute} onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
