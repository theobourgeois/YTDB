"use client";

import { ChevronDownIcon, Layers3Icon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type Props = {
  schemas: string[];
  selected: string[] | null;
  onChange: (schemas: string[] | null) => void;
  /** A small icon trigger for sitting inside another row, instead of a full-width field. */
  compact?: boolean;
};

function selectionLabel(schemas: string[], selected: string[] | null): string {
  if (selected === null || selected.length === schemas.length) return "All schemas";
  if (selected.length === 0) return "No schemas";
  if (selected.length === 1) return selected[0];
  return `${selected.length} of ${schemas.length} schemas`;
}

export function SchemaMultiSelect({ schemas, selected, onChange, compact = false }: Props) {
  const allSelected = selected === null || selected.length === schemas.length;
  const label = selectionLabel(schemas, selected);

  function toggleSchema(schema: string, checked: boolean) {
    const current = selected ?? schemas;
    const next = checked
      ? [...new Set([...current, schema])]
      : current.filter((item) => item !== schema);
    onChange(next.length === schemas.length ? null : next);
  }

  return (
    <DropdownMenu>
      {compact ? (
        <DropdownMenuTrigger
          aria-label={`Schemas: ${label}`}
          title={label}
          className={cn(
            "flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1 text-[11px] tabular-nums outline-none transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 data-open:bg-foreground/10 data-open:text-foreground",
            allSelected ? "text-muted-foreground" : "text-foreground",
          )}
        >
          <Layers3Icon className="size-3.5" />
          {!allSelected && <span>{selected.length}</span>}
        </DropdownMenuTrigger>
      ) : (
        <DropdownMenuTrigger className="group flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left text-[0.8rem] outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60 data-open:bg-muted/60">
          <Layers3Icon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-open:rotate-180" />
        </DropdownMenuTrigger>
      )}

      <DropdownMenuContent
        align={compact ? "end" : "start"}
        sideOffset={6}
        className={cn("max-h-80 min-w-52", !compact && "w-(--anchor-width)")}
      >
        <DropdownMenuGroup>
          <DropdownMenuCheckboxItem
            checked={allSelected}
            onCheckedChange={(checked) => onChange(checked ? null : [])}
          >
            All schemas
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          {schemas.map((schema) => (
            <DropdownMenuCheckboxItem
              key={schema}
              checked={allSelected || (selected?.includes(schema) ?? false)}
              onCheckedChange={(checked) => toggleSchema(schema, checked)}
            >
              <span className="truncate">{schema}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
