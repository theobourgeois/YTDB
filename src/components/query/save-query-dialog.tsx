"use client";

import { useMemo, useState, type FormEvent } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MAX_QUERY_NAME_LENGTH, useQueries } from "@/lib/store/queries";

const NO_FOLDER = "__none";
const NEW_FOLDER = "__new";

type Props = {
  open: boolean;
  connectionId: string;
  sql: string;
  onOpenChange: (open: boolean) => void;
  onSaved: (id: string) => void;
};

/** Suggests a name from the first meaningful line of SQL. */
function suggestedName(sql: string): string {
  const line = sql
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate && !candidate.startsWith("--"));
  return (line ?? "").replace(/\s+/g, " ").slice(0, MAX_QUERY_NAME_LENGTH);
}

export function SaveQueryDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {props.open && <SaveQueryForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function SaveQueryForm({ connectionId, sql, onOpenChange, onSaved }: Props) {
  const folders = useQueries((state) => state.folders);
  const createFolder = useQueries((state) => state.createFolder);
  const saveQuery = useQueries((state) => state.saveQuery);
  const connectionFolders = useMemo(
    () =>
      folders
        .filter((folder) => folder.connectionId === connectionId)
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" })),
    [connectionId, folders],
  );

  const [name, setName] = useState(() => suggestedName(sql));
  const [folderChoice, setFolderChoice] = useState(NO_FOLDER);
  const [newFolderName, setNewFolderName] = useState("");

  const folderItems = useMemo(
    () => ({
      [NO_FOLDER]: "No folder",
      ...Object.fromEntries(connectionFolders.map((folder) => [folder.id, folder.name])),
      [NEW_FOLDER]: "New folder…",
    }),
    [connectionFolders],
  );

  const trimmedName = name.trim();
  const needsFolderName = folderChoice === NEW_FOLDER && !newFolderName.trim();
  const canSubmit = trimmedName.length > 0 && !needsFolderName;

  function resolveFolderId(): string | null {
    if (folderChoice === NO_FOLDER) return null;
    if (folderChoice === NEW_FOLDER) return createFolder(connectionId, newFolderName);
    return folderChoice;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    const id = saveQuery(connectionId, { name: trimmedName, sql, folderId: resolveFolderId() });
    onSaved(id);
    onOpenChange(false);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader className="gap-1.5 pr-8">
        <DialogTitle>Save query</DialogTitle>
        <DialogDescription className="text-xs">
          Keep this query in the sidebar and organize it into a folder.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="save-query-name" className="text-xs text-muted-foreground">
            Name
          </Label>
          <Input
            id="save-query-name"
            autoFocus
            value={name}
            maxLength={MAX_QUERY_NAME_LENGTH}
            placeholder="Active users by plan"
            onChange={(event) => setName(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="save-query-folder" className="text-xs text-muted-foreground">
            Folder
          </Label>
          <Select
            items={folderItems}
            value={folderChoice}
            onValueChange={(value) => value && setFolderChoice(String(value))}
          >
            <SelectTrigger id="save-query-folder" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectItem value={NO_FOLDER}>No folder</SelectItem>
              {connectionFolders.length > 0 && <SelectSeparator />}
              {connectionFolders.map((folder) => (
                <SelectItem key={folder.id} value={folder.id}>
                  {folder.name}
                </SelectItem>
              ))}
              <SelectSeparator />
              <SelectItem value={NEW_FOLDER}>New folder…</SelectItem>
            </SelectContent>
          </Select>
          {folderChoice === NEW_FOLDER && (
            <Input
              aria-label="New folder name"
              autoFocus
              value={newFolderName}
              maxLength={MAX_QUERY_NAME_LENGTH}
              placeholder="Folder name"
              onChange={(event) => setNewFolderName(event.target.value)}
            />
          )}
        </div>
      </div>

      <DialogFooter>
        <Button type="submit" disabled={!canSubmit}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
