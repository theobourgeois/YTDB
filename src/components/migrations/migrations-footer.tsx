"use client";

import { PaneToggle } from "@/components/ui/pane-toggle";
import type { MigrationView } from "@/lib/routes";

export type MigrationsPane = "migrations" | "schema" | "diagram" | "history";

/** Each pane is its own page, so back and forward step between them. */
export function paneOfView(view: MigrationView | undefined): MigrationsPane {
  if (view === "schema" || view === "diagram") return view;
  return view === "timeline" ? "history" : "migrations";
}

export function viewOfPane(pane: MigrationsPane): MigrationView | undefined {
  if (pane === "schema" || pane === "diagram") return pane;
  return pane === "history" ? "timeline" : undefined;
}

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
  /** Offers the panes with what the whole migration does to the schema, as a list and as a diagram. */
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
            ...(showSchema
              ? [
                  { value: "schema" as const, label: "Schema" },
                  { value: "diagram" as const, label: "Diagram" },
                ]
              : []),
            { value: "history", label: "Timeline" },
          ]}
        />
      </div>
    </footer>
  );
}
