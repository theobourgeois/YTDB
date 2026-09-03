"use client";

import Link from "next/link";
import { useState } from "react";
import { Link2Icon, MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConnections } from "@/lib/store/connections";
import { syncLayoutSharing, useSharedLayoutPartners } from "@/lib/store/explorer";
import { resolveConnectionColor } from "@/lib/connection-colors";
import type { Connection } from "@/lib/types";
import { ConnectionDialog, type ConnectionFormValues } from "./connection-dialog";
import { ConnectionColorMark } from "./connection-color";
import { StudioConfigActions } from "./studio-config";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function ConnectionRow({
  connection,
  onEdit,
  onRemove,
}: {
  connection: Connection;
  onEdit: (connection: Connection) => void;
  onRemove: (id: string) => void;
}) {
  const partners = useSharedLayoutPartners(connection.id);
  return (
    <li className="group flex items-center gap-2 pr-1.5">
      <Link
        href={`/${connection.id}`}
        className="flex flex-1 items-center gap-2.5 px-3 py-2.5 outline-none focus-visible:bg-muted/40"
      >
        <ConnectionColorMark connection={connection} className="size-2.5" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-medium">{connection.name}</span>
          <span className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <span className="truncate">{hostOf(connection.url)}</span>
            {partners.length > 0 && (
              <span className="inline-flex min-w-0 items-center gap-1 font-sans">
                <Link2Icon className="size-3 shrink-0" />
                <span className="truncate">
                  {partners.map((partner) => partner.name).join(", ")}
                </span>
              </span>
            )}
          </span>
        </span>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label="More" />}
          className="opacity-0 group-hover:opacity-100 data-open:opacity-100"
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onEdit(connection)}>Edit</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => onRemove(connection.id)}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

export function ConnectionList() {
  const { connections, add, update, remove } = useConnections();
  const [editing, setEditing] = useState<Connection | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const partners = useSharedLayoutPartners(editing?.id ?? "");

  function openNew() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(connection: Connection) {
    setEditing(connection);
    setDialogOpen(true);
  }

  function save(values: ConnectionFormValues) {
    const { shareWith, ...input } = values;
    if (editing) {
      update(editing.id, input);
      syncLayoutSharing(editing.id, shareWith);
      return;
    }
    const created = add(input);
    syncLayoutSharing(created.id, shareWith);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-sm font-medium">Connections</h1>
        <div className="flex items-center">
          <StudioConfigActions />
          <Button size="sm" variant="ghost" onClick={openNew}>
            <PlusIcon data-icon="inline-start" />
            New
          </Button>
        </div>
      </div>

      {connections.length === 0 ? (
        <button
          onClick={openNew}
          className="rounded-lg border border-dashed py-10 text-center text-muted-foreground hover:bg-muted/40"
        >
          Add a connection
        </button>
      ) : (
        <ul className="divide-y rounded-lg border">
          {connections.map((connection) => (
            <ConnectionRow
              key={connection.id}
              connection={connection}
              onEdit={openEdit}
              onRemove={remove}
            />
          ))}
        </ul>
      )}

      <ConnectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        connectionId={editing?.id}
        initial={
          editing
            ? {
                name: editing.name,
                url: editing.url,
                color: resolveConnectionColor(editing),
                shareWith: partners.map((partner) => partner.id),
              }
            : undefined
        }
        onSubmit={save}
      />
    </div>
  );
}
