"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpenIcon, FolderUpIcon, LoaderCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readDroppedFolder, readPickedFolder } from "@/lib/migrations/folder";
import type { ImportedFile } from "@/lib/migrations/parse";
import { cn } from "@/lib/utils";

export type FolderDrop = {
  /** The folder's name, used to name a set that does not have one yet. */
  name: string;
  files: ImportedFile[];
};

/**
 * Reads whatever was dropped or picked into a list of .sql files, and leaves it to
 * the caller to decide which set they join. Shared by the empty state, the Import
 * button, and the drop target covering the whole view.
 */
export function useMigrationImport(onFiles: (drop: FolderDrop) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const importFrom = useCallback(
    async (source: DataTransfer | FileList) => {
      setBusy(true);
      setError(null);
      try {
        const read =
          source instanceof FileList
            ? await readPickedFolder(source)
            : await readDroppedFolder(source);
        if (!read || read.files.length === 0) {
          setError("No .sql files in there.");
          return;
        }
        onFiles(read);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Couldn’t read that folder.");
      } finally {
        setBusy(false);
      }
    },
    [onFiles],
  );

  return { importFrom, busy, error, clearError: () => setError(null) };
}

type Props = {
  onFiles: (drop: FolderDrop) => void;
  /** Overrides the default explanation, which assumes a first import. */
  hint?: string;
  className?: string;
  compact?: boolean;
};

export function MigrationDropZone({ onFiles, hint, className, compact = false }: Props) {
  const { importFrom, busy, error } = useMigrationImport(onFiles);
  const [over, setOver] = useState(false);
  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);

  // `webkitdirectory` is not in React's input props, so it is set on the element.
  useEffect(() => {
    folderRef.current?.setAttribute("webkitdirectory", "");
    folderRef.current?.setAttribute("directory", "");
  }, []);

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        void importFrom(event.dataTransfer);
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center transition-colors",
        compact ? "gap-2 px-4 py-6" : "px-6 py-10",
        over ? "border-primary bg-primary/5" : "border-border",
        className,
      )}
    >
      {busy ? (
        <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />
      ) : (
        <FolderUpIcon className="size-5 text-muted-foreground" />
      )}
      <div className="space-y-1">
        <p className="text-sm font-medium">Drop migrations here</p>
        <p className="max-w-md text-xs text-muted-foreground">
          {hint ??
            "A folder of .sql files, or one split into apply/ and revert/ (or up/ and down/). Revert files are optional, and you can add more files later."}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => folderRef.current?.click()}>
          <FolderOpenIcon data-icon="inline-start" />
          Choose folder
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => filesRef.current?.click()}>
          Choose files
        </Button>
      </div>
      {error && <p className="max-w-sm text-xs text-destructive">{error}</p>}

      <input
        ref={folderRef}
        type="file"
        multiple
        className="sr-only"
        onChange={(event) => {
          const { files } = event.target;
          if (files && files.length > 0) void importFrom(files);
          event.target.value = "";
        }}
      />
      <input
        ref={filesRef}
        type="file"
        multiple
        accept=".sql"
        className="sr-only"
        onChange={(event) => {
          const { files } = event.target;
          if (files && files.length > 0) void importFrom(files);
          event.target.value = "";
        }}
      />
    </div>
  );
}
