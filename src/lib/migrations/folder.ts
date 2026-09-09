import type { ImportedFile } from "./parse";

/** Enough for a long-lived migrations folder, low enough that a stray drop cannot hang the tab. */
const MAX_ENTRIES = 2_000;
const MAX_DEPTH = 6;

export type FolderRead = {
  /** The dropped folder's name, used to name the set. */
  name: string;
  files: ImportedFile[];
};

/**
 * The browser's directory entry API. Not in lib.dom, and only reachable through
 * `webkitGetAsEntry`, so the shape is declared where it is used.
 */
type FsEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (onSuccess: (file: File) => void, onError: (error: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (entries: FsEntry[]) => void, fail: (e: unknown) => void) => void };
};

function readEntry(entry: FsEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    if (!entry.file) {
      reject(new Error(`Could not read ${entry.name}`));
      return;
    }
    entry.file(resolve, reject);
  });
}

/** `readEntries` returns at most 100 entries per call and signals the end with an empty batch. */
function readDirectory(entry: FsEntry): Promise<FsEntry[]> {
  const reader = entry.createReader?.();
  if (!reader) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const all: FsEntry[] = [];
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0 || all.length >= MAX_ENTRIES) {
          resolve(all);
          return;
        }
        all.push(...batch);
        readBatch();
      }, reject);
    };
    readBatch();
  });
}

async function walk(entry: FsEntry, prefix: string, depth: number, out: ImportedFile[]): Promise<void> {
  if (out.length >= MAX_ENTRIES || depth > MAX_DEPTH) return;
  if (entry.name.startsWith(".")) return;
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    if (!/\.sql$/i.test(entry.name)) return;
    const file = await readEntry(entry);
    out.push({ path, text: await file.text() });
    return;
  }
  if (!entry.isDirectory) return;
  for (const child of await readDirectory(entry)) {
    await walk(child, path, depth + 1, out);
  }
}

/** Reads a dropped folder — or a handful of dropped .sql files — into memory. */
export async function readDroppedFolder(transfer: DataTransfer): Promise<FolderRead | null> {
  const entries: FsEntry[] = [];
  for (const item of Array.from(transfer.items)) {
    if (item.kind !== "file") continue;
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null })
      .webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }

  if (entries.length === 0) {
    const files = Array.from(transfer.files).filter((file) => /\.sql$/i.test(file.name));
    if (files.length === 0) return null;
    return {
      name: "Migrations",
      files: await Promise.all(
        files.map(async (file) => ({ path: file.name, text: await file.text() })),
      ),
    };
  }

  // A single dropped directory names the set and becomes the root of every path.
  const root = entries.length === 1 && entries[0].isDirectory ? entries[0] : null;
  const files: ImportedFile[] = [];
  if (root) {
    for (const child of await readDirectory(root)) {
      await walk(child, "", 1, files);
    }
    return { name: root.name, files };
  }

  for (const entry of entries) {
    await walk(entry, "", 0, files);
  }
  return files.length > 0 ? { name: "Migrations", files } : null;
}

/** Reads the selection from an `<input type="file" webkitdirectory>`. */
export async function readPickedFolder(list: FileList): Promise<FolderRead | null> {
  const files = Array.from(list).filter((file) => /\.sql$/i.test(file.name));
  if (files.length === 0) return null;

  const relativePath = (file: File) =>
    (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;

  // The picker prefixes every path with the chosen folder, which names the set.
  const roots = new Set(files.map((file) => relativePath(file).split("/")[0]));
  const root = roots.size === 1 && relativePath(files[0]).includes("/") ? [...roots][0] : null;

  return {
    name: root ?? "Migrations",
    files: await Promise.all(
      files.slice(0, MAX_ENTRIES).map(async (file) => {
        const path = relativePath(file);
        return { path: root ? path.slice(root.length + 1) : path, text: await file.text() };
      }),
    ),
  };
}
