"use client";

import { ChevronDownIcon, Layers3Icon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Props = {
  schemas: string[];
  selected: string[] | null;
  onChange: (schemas: string[] | null) => void;
};

function selectionLabel(schemas: string[], selected: string[] | null): string {
  if (selected === null || selected.length === schemas.length) return "All schemas";
  if (selected.length === 0) return "No schemas";
  if (selected.length === 1) return selected[0];
  return `${selected.length} schemas`;
}

export function SchemaMultiSelect({ schemas, selected, onChange }: Props) {
  const allSelected = selected === null || selected.length === schemas.length;

  function toggleSchema(schema: string, checked: boolean) {
    const current = selected ?? schemas;
    const next = checked
      ? [...new Set([...current, schema])]
      : current.filter((item) => item !== schema);
    onChange(next.length === schemas.length ? null : next);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="group flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg border border-input bg-background/60 px-2.5 text-left text-sm outline-none transition-[border-color,background-color,box-shadow] hover:border-foreground/20 hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-open:border-foreground/20 data-open:bg-muted/60">
        <Layers3Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">
          {selectionLabel(schemas, selected)}
        </span>
        {!allSelected && (
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
            {selected.length}/{schemas.length}
          </span>
        )}
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-open:rotate-180" />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="max-h-80 w-(--anchor-width) min-w-52"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between px-2 py-1.5">
            <span>Visible schemas</span>
            <span className="font-normal tabular-nums opacity-70">{schemas.length}</span>
          </DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            checked={allSelected}
            onCheckedChange={(checked) => onChange(checked ? null : [])}
          >
            <span className="font-medium">Show all schemas</span>
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
