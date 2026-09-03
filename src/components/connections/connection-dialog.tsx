"use client";

import { useState } from "react";
import { CheckIcon, Link2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CONNECTION_COLORS,
  isConnectionColor,
  nextConnectionColor,
  resolveConnectionColor,
} from "@/lib/connection-colors";
import { useConnections } from "@/lib/store/connections";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConnectionColorMark } from "./connection-color";

export type ConnectionFormValues = {
  name: string;
  url: string;
  color?: string;
  shareWith: string[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId?: string;
  initial?: ConnectionFormValues;
  onSubmit: (values: ConnectionFormValues) => void;
};

export function ConnectionDialog({
  open,
  onOpenChange,
  connectionId,
  initial,
  onSubmit,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Mounted only while open, so the form starts fresh each time. */}
        <ConnectionForm
          key={connectionId ?? "new"}
          connectionId={connectionId}
          initial={initial}
          onSubmit={(values) => {
            onSubmit(values);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function ConnectionForm({
  connectionId,
  initial,
  onSubmit,
}: {
  connectionId?: string;
  initial?: ConnectionFormValues;
  onSubmit: (values: ConnectionFormValues) => void;
}) {
  const connections = useConnections((state) => state.connections);
  const others = connections.filter((connection) => connection.id !== connectionId);
  const [values, setValues] = useState<ConnectionFormValues>(() => {
    if (initial) {
      return {
        ...initial,
        color: isConnectionColor(initial.color)
          ? initial.color
          : nextConnectionColor(
              connections.map((connection) => resolveConnectionColor(connection)),
            ),
        shareWith: initial.shareWith,
      };
    }
    return {
      name: "",
      url: "",
      color: nextConnectionColor(
        connections.map((connection) => resolveConnectionColor(connection)),
      ),
      shareWith: [],
    };
  });
  const canSubmit = values.name.trim().length > 0 && values.url.trim().length > 0;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (canSubmit) {
      onSubmit({
        name: values.name.trim(),
        url: values.url.trim(),
        color: values.color,
        shareWith: values.shareWith,
      });
    }
  }

  function toggleShare(id: string) {
    setValues((current) => ({
      ...current,
      shareWith: current.shareWith.includes(id)
        ? current.shareWith.filter((item) => item !== id)
        : [...current.shareWith, id],
    }));
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>{initial ? "Edit connection" : "New connection"}</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="connection-name">Name</Label>
          <Input
            id="connection-name"
            autoFocus
            autoComplete="off"
            value={values.name}
            onChange={(e) => setValues({ ...values, name: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="connection-url">Database URL</Label>
          <Input
            id="connection-url"
            autoComplete="off"
            spellCheck={false}
            placeholder="postgresql://user:password@host:5432/db"
            className="font-mono"
            value={values.url}
            onChange={(e) => setValues({ ...values, url: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label id="connection-color">Color</Label>
          <div role="group" aria-labelledby="connection-color" className="flex flex-wrap gap-2">
            {CONNECTION_COLORS.map((color) => {
              const selected = values.color === color;
              return (
                <button
                  key={color}
                  type="button"
                  aria-label={`Use color ${color}`}
                  aria-pressed={selected}
                  onClick={() => setValues({ ...values, color })}
                  className={cn(
                    "size-6 cursor-pointer rounded-full outline-none ring-offset-2 ring-offset-background transition-[box-shadow,transform] hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring",
                    selected && "ring-2 ring-foreground",
                  )}
                  style={{ background: color }}
                />
              );
            })}
          </div>
        </div>
        {others.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <Label id="connection-share" className="flex items-center gap-1.5">
              <Link2Icon className="size-3.5 text-muted-foreground" />
              Share layout with
            </Label>
            <p className="text-xs text-muted-foreground">
              Pins, hidden columns, column widths, schema filters, and pinned tables. Filters and
              search stay per connection.
            </p>
            <div
              role="group"
              aria-labelledby="connection-share"
              className="flex flex-col gap-1 rounded-lg border p-1"
            >
              {others.map((connection) => {
                const checked = values.shareWith.includes(connection.id);
                return (
                  <button
                    key={connection.id}
                    type="button"
                    aria-pressed={checked}
                    onClick={() => toggleShare(connection.id)}
                    className={cn(
                      "flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60",
                      checked && "bg-muted/40",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-4 items-center justify-center rounded-[5px] border border-input",
                        checked && "border-foreground bg-foreground text-background",
                      )}
                    >
                      {checked && <CheckIcon className="size-3" strokeWidth={3} />}
                    </span>
                    <ConnectionColorMark connection={connection} />
                    <span className="min-w-0 truncate">{connection.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button type="submit" disabled={!canSubmit}>
          {initial ? "Save" : "Add"}
        </Button>
      </DialogFooter>
    </form>
  );
}
