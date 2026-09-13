"use client";

import { PaneToggle } from "@/components/ui/pane-toggle";

export type MigrationsPane = "migrations" | "schema" | "history";

/** The status line and pane switch shared by the migration list and one migration. */
export function MigrationsFooter({
  caption,
  pane,
  onPaneChange,
  migrationsLabel = "Migrations",
  showSchema = false,
}: {
  caption: string;
  pane: MigrationsPane;
  onPaneChange: (pane: MigrationsPane) => void;
  historyCount: number;
  migrationsLabel?: string;
  /** Offers the pane with what the whole migration does to the schema. */
  showSchema?: boolean;
}) {
  return (
    <footer className="flex shrink-0 items-center gap-2 border-t px-4 py-1.5 text-xs text-muted-foreground">
      <span className="min-w-0 truncate">{caption}</span>
      <div className="ml-auto">
        <PaneToggle
          label="Migrations pane"
          value={pane}
          onChange={onPaneChange}
          options={[
            { value: "migrations", label: migrationsLabel },
            ...(showSchema ? [{ value: "schema" as const, label: "Schema" }] : []),
            { value: "history", label: "Timeline" },
          ]}
        />
      </div>
    </footer>
  );
}
