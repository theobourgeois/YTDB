"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  BookmarkIcon,
  ChevronRightIcon,
  CopyIcon,
  FolderIcon,
  FolderInputIcon,
  MoreHorizontalIcon,
  PencilLineIcon,
  Trash2Icon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { rankFuzzyMulti } from "@/lib/fuzzy";
import {
  MAX_QUERY_NAME_LENGTH,
  useQueries,
  type QueryFolder,
  type SavedQuery,
} from "@/lib/store/queries";
import { cn } from "@/lib/utils";

const DRAG_TYPE = "application/x-ytdb-saved-query";

type Props = {
  connectionId: string;
  search: string;
  activeId: string | null;
  dirty: boolean;
  creatingFolder: boolean;
  onCreatingFolderChange: (creating: boolean) => void;
  onSelect: (query: SavedQuery) => void;
};

function compareByName(left: { name: string }, right: { name: string }): number {
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}

/** A single-line name editor used for creating and renaming folders and queries. */
function InlineName({
  initial,
  placeholder,
  className,
  onCommit,
  onCancel,
}: {
  initial: string;
  placeholder: string;
  className?: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const settled = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  function settle(commit: boolean) {
    if (settled.current) return;
    settled.current = true;
    const name = value.trim();
    if (commit && name && name !== initial) onCommit(name);
    else onCancel();
  }

  return (
    <input
      ref={ref}
      value={value}
      maxLength={MAX_QUERY_NAME_LENGTH}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => settle(true)}
      onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
          event.preventDefault();
          settle(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          settle(false);
        }
      }}
      className={cn(
        "h-6 min-w-0 flex-1 rounded-md border border-ring/60 bg-background px-1.5 text-[13px] outline-none ring-2 ring-ring/30 placeholder:text-muted-foreground/70",
        className,
      )}
    />
  );
}

function RowMenuButton({ label }: { label: string }) {
  return (
    <DropdownMenuTrigger
      aria-label={label}
      title={label}
      onClick={(event) => event.stopPropagation()}
      className="mr-0.5 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none transition-[color,background-color,opacity] hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:opacity-100 group-hover/row:opacity-100 data-open:bg-foreground/10 data-open:text-foreground data-open:opacity-100"
    >
      <MoreHorizontalIcon className="size-3.5" />
    </DropdownMenuTrigger>
  );
}

function QueryRow({
  query,
  folders,
  active,
  dirty,
  dragging,
  indent,
  onSelect,
  onDragStart,
  onDragEnd,
}: {
  query: SavedQuery;
  folders: QueryFolder[];
  active: boolean;
  dirty: boolean;
  dragging: boolean;
  indent: boolean;
  onSelect: (query: SavedQuery) => void;
  onDragStart: (event: ReactDragEvent<HTMLLIElement>, id: string) => void;
  onDragEnd: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const updateSaved = useQueries((state) => state.updateSaved);
  const removeSaved = useQueries((state) => state.removeSaved);
  const saveQuery = useQueries((state) => state.saveQuery);
  const otherFolders = folders.filter((folder) => folder.id !== query.folderId);

  return (
    <li
      draggable={!renaming}
      onDragStart={(event) => onDragStart(event, query.id)}
      onDragEnd={onDragEnd}
      className={cn(
        "group/row flex h-7 items-center rounded-md text-[13px] transition-[color,background-color,opacity] hover:bg-muted/60",
        active ? "bg-muted text-foreground" : "text-foreground/80",
        dragging && "opacity-45",
        indent ? "pl-4" : "pl-0",
      )}
    >
      {renaming ? (
        <div className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-1.5 pr-1">
          <BookmarkIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <InlineName
            initial={query.name}
            placeholder="Query name"
            onCommit={(name) => {
              updateSaved(query.id, { name });
              setRenaming(false);
            }}
            onCancel={() => setRenaming(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onSelect(query)}
          onDoubleClick={() => setRenaming(true)}
          title={query.sql}
          aria-current={active ? "true" : undefined}
          className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md pl-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <BookmarkIcon
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground",
              active && "fill-current text-foreground",
            )}
          />
          <span className="truncate">{query.name}</span>
          {active && dirty && (
            <span
              aria-label="Unsaved changes"
              title="Unsaved changes"
              className="ml-0.5 size-1.5 shrink-0 rounded-full bg-primary"
            />
          )}
        </button>
      )}
      {!renaming && (
        <DropdownMenu>
          <RowMenuButton label={`Actions for ${query.name}`} />
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => setRenaming(true)}>
              <PencilLineIcon />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                saveQuery(query.connectionId, {
                  name: `${query.name} copy`,
                  sql: query.sql,
                  folderId: query.folderId,
                })
              }
            >
              <CopyIcon />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderInputIcon />
                Move to
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 w-44">
                {query.folderId !== null && (
                  <DropdownMenuItem onClick={() => updateSaved(query.id, { folderId: null })}>
                    No folder
                  </DropdownMenuItem>
                )}
                {query.folderId !== null && otherFolders.length > 0 && <DropdownMenuSeparator />}
                {otherFolders.map((folder) => (
                  <DropdownMenuItem
                    key={folder.id}
                    onClick={() => updateSaved(query.id, { folderId: folder.id })}
                  >
                    <FolderIcon />
                    <span className="truncate">{folder.name}</span>
                  </DropdownMenuItem>
                ))}
                {query.folderId === null && otherFolders.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">No folders yet</div>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => removeSaved(query.id)}>
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

function FolderSection({
  folder,
  folders,
  queries,
  forceOpen,
  activeId,
  dirty,
  draggingId,
  dropTarget,
  onSelect,
  onDragStart,
  onDragEnd,
  onDragOverFolder,
  onDropOnFolder,
  onDragLeaveFolder,
}: {
  folder: QueryFolder;
  folders: QueryFolder[];
  queries: SavedQuery[];
  forceOpen: boolean;
  activeId: string | null;
  dirty: boolean;
  draggingId: string | null;
  dropTarget: string | null;
  onSelect: (query: SavedQuery) => void;
  onDragStart: (event: ReactDragEvent<HTMLLIElement>, id: string) => void;
  onDragEnd: () => void;
  onDragOverFolder: (event: ReactDragEvent<HTMLElement>, folderId: string) => void;
  onDropOnFolder: (event: ReactDragEvent<HTMLElement>, folderId: string) => void;
  onDragLeaveFolder: (event: ReactDragEvent<HTMLElement>, folderId: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const toggleFolder = useQueries((state) => state.toggleFolder);
  const renameFolder = useQueries((state) => state.renameFolder);
  const removeFolder = useQueries((state) => state.removeFolder);
  const open = forceOpen || !folder.collapsed;
  const dropping = dropTarget === folder.id;

  return (
    <div
      onDragOver={(event) => onDragOverFolder(event, folder.id)}
      onDragLeave={(event) => onDragLeaveFolder(event, folder.id)}
      onDrop={(event) => onDropOnFolder(event, folder.id)}
    >
      <div
        className={cn(
          "group/row flex h-7 items-center rounded-md transition-[color,background-color,box-shadow]",
          dropping ? "bg-primary/10 ring-1 ring-primary/50 ring-inset" : "hover:bg-muted/60",
        )}
      >
        {renaming ? (
          <div className="flex h-full min-w-0 flex-1 items-center gap-1 pl-1 pr-1">
            <FolderIcon className="ml-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <InlineName
              initial={folder.name}
              placeholder="Folder name"
              className="text-xs font-medium"
              onCommit={(name) => {
                renameFolder(folder.id, name);
                setRenaming(false);
              }}
              onCancel={() => setRenaming(false)}
            />
          </div>
        ) : (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => toggleFolder(folder.id)}
            onDoubleClick={() => setRenaming(true)}
            className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-md px-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <ChevronRightIcon
              className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
            />
            <FolderIcon className="size-3.5 shrink-0" />
            <span className="truncate">{folder.name}</span>
            <span className="ml-auto pr-1 tabular-nums opacity-60">{queries.length}</span>
          </button>
        )}
        {!renaming && (
          <DropdownMenu>
            <RowMenuButton label={`Actions for folder ${folder.name}`} />
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => setRenaming(true)}>
                <PencilLineIcon />
                Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => removeFolder(folder.id)}>
                <Trash2Icon />
                Delete folder
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {open &&
        (queries.length > 0 ? (
          <ul>
            {queries.map((query) => (
              <QueryRow
                key={query.id}
                query={query}
                folders={folders}
                active={query.id === activeId}
                dirty={dirty}
                dragging={draggingId === query.id}
                indent
                onSelect={onSelect}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
            ))}
          </ul>
        ) : (
          <p className="py-1.5 pl-[2.6rem] text-[11px] text-muted-foreground/70">
            {draggingId ? "Drop here" : "Empty folder"}
          </p>
        ))}
    </div>
  );
}

export function SavedQueries({
  connectionId,
  search,
  activeId,
  dirty,
  creatingFolder,
  onCreatingFolderChange,
  onSelect,
}: Props) {
  const folders = useQueries((state) => state.folders);
  const saved = useQueries((state) => state.saved);
  const createFolder = useQueries((state) => state.createFolder);
  const updateSaved = useQueries((state) => state.updateSaved);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const searching = search.trim().length > 0;

  const connectionFolders = useMemo(
    () => folders.filter((folder) => folder.connectionId === connectionId).sort(compareByName),
    [connectionId, folders],
  );
  const connectionQueries = useMemo(
    () => saved.filter((query) => query.connectionId === connectionId).sort(compareByName),
    [connectionId, saved],
  );
  const visibleQueries = useMemo(() => {
    if (!searching) return connectionQueries;
    const folderNames = new Map(connectionFolders.map((folder) => [folder.id, folder.name]));
    return rankFuzzyMulti(search, connectionQueries, (query) => [
      query.name,
      query.folderId ? (folderNames.get(query.folderId) ?? "") : "",
      query.sql,
    ]).map((hit) => hit.item);
  }, [connectionFolders, connectionQueries, search, searching]);

  const byFolder = useMemo(() => {
    const groups = new Map<string | null, SavedQuery[]>();
    for (const query of visibleQueries) {
      const key = query.folderId && connectionFolders.some((f) => f.id === query.folderId)
        ? query.folderId
        : null;
      groups.set(key, [...(groups.get(key) ?? []), query]);
    }
    return groups;
  }, [connectionFolders, visibleQueries]);

  const shownFolders = searching
    ? connectionFolders.filter((folder) => (byFolder.get(folder.id)?.length ?? 0) > 0)
    : connectionFolders;
  const loose = byFolder.get(null) ?? [];

  function beginDrag(event: ReactDragEvent<HTMLLIElement>, id: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_TYPE, id);
    event.dataTransfer.setData("text/plain", id);
    setDraggingId(id);
    setDropTarget(null);
  }

  function finishDrag() {
    setDraggingId(null);
    setDropTarget(null);
  }

  function draggedQueryId(event: ReactDragEvent<HTMLElement>): string | null {
    return draggingId ?? (event.dataTransfer.getData(DRAG_TYPE) || null);
  }

  function dragOver(event: ReactDragEvent<HTMLElement>, target: string | null) {
    if (!draggingId && !event.dataTransfer.types.includes(DRAG_TYPE)) return;
    const query = connectionQueries.find((item) => item.id === draggingId);
    if (query && query.folderId === target) {
      event.stopPropagation();
      setDropTarget(null);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropTarget((current) => (current === (target ?? "__root") ? current : (target ?? "__root")));
  }

  function dragLeave(event: ReactDragEvent<HTMLElement>, target: string | null) {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setDropTarget((current) => (current === (target ?? "__root") ? null : current));
  }

  function drop(event: ReactDragEvent<HTMLElement>, target: string | null) {
    event.preventDefault();
    event.stopPropagation();
    const id = draggedQueryId(event);
    if (id) updateSaved(id, { folderId: target });
    finishDrag();
  }

  const empty = connectionQueries.length === 0 && connectionFolders.length === 0;

  if (empty && !creatingFolder) {
    return (
      <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
        <BookmarkIcon className="size-4 text-muted-foreground/60" />
        <p className="text-xs text-muted-foreground">Save a query to keep it here.</p>
        <p className="text-[11px] text-muted-foreground/70">
          Group saved queries into folders like migrations or maintenance.
        </p>
      </div>
    );
  }

  return (
    <div
      onDragOver={(event) => dragOver(event, null)}
      onDragLeave={(event) => dragLeave(event, null)}
      onDrop={(event) => drop(event, null)}
      className={cn(
        "flex min-h-full flex-col gap-0.5 rounded-md px-1.5 pt-1.5 pb-4 transition-[background-color,box-shadow]",
        dropTarget === "__root" && "bg-primary/5 ring-1 ring-primary/30 ring-inset",
      )}
    >
      {creatingFolder && (
        <div className="flex h-7 items-center gap-1 rounded-md pl-1 pr-1">
          <ChevronRightIcon className="size-3.5 shrink-0 rotate-90 text-muted-foreground" />
          <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <InlineName
            initial=""
            placeholder="Folder name"
            className="text-xs font-medium"
            onCommit={(name) => {
              createFolder(connectionId, name);
              onCreatingFolderChange(false);
            }}
            onCancel={() => onCreatingFolderChange(false)}
          />
        </div>
      )}

      {shownFolders.map((folder) => (
        <FolderSection
          key={folder.id}
          folder={folder}
          folders={connectionFolders}
          queries={byFolder.get(folder.id) ?? []}
          forceOpen={searching}
          activeId={activeId}
          dirty={dirty}
          draggingId={draggingId}
          dropTarget={dropTarget}
          onSelect={onSelect}
          onDragStart={beginDrag}
          onDragEnd={finishDrag}
          onDragOverFolder={dragOver}
          onDropOnFolder={drop}
          onDragLeaveFolder={dragLeave}
        />
      ))}

      {loose.length > 0 && shownFolders.length > 0 && (
        <div className="my-1 border-t border-border/60" />
      )}

      {loose.length > 0 && (
        <ul>
          {loose.map((query) => (
            <QueryRow
              key={query.id}
              query={query}
              folders={connectionFolders}
              active={query.id === activeId}
              dirty={dirty}
              dragging={draggingId === query.id}
              indent={false}
              onSelect={onSelect}
              onDragStart={beginDrag}
              onDragEnd={finishDrag}
            />
          ))}
        </ul>
      )}

      {searching && visibleQueries.length === 0 && (
        <p className="px-3 py-8 text-center text-xs text-muted-foreground">No matching queries.</p>
      )}

      {!searching && draggingId && loose.length === 0 && (
        <p className="py-2 text-center text-[11px] text-muted-foreground/70">
          Drop outside a folder to unfile
        </p>
      )}
    </div>
  );
}
