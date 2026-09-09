"use client";

import { PaneToggle } from "@/components/ui/pane-toggle";

export type MigrationsPane = "migrations" | "history";

/** The status line and pane switch shared by the migration list and one migration. */
export function MigrationsFooter({
  caption,
  pane,
  onPaneChange,
  historyCount,
  migrationsLabel = "Migrations",
}: {
  caption: string;
  pane: MigrationsPane;
  onPaneChange: (pane: MigrationsPane) => void;
  historyCount: number;
  migrationsLabel?: string;
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
            { value: "history", label: historyCount > 0 ? `History (${historyCount})` : "History" },
          ]}
        />
      </div>
    </footer>
  );
}
