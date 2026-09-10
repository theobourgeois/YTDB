"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { SHORTCUTS } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { useExplorerContext } from "./explorer-provider";
import { useNavigationHistory } from "./use-navigation-history";

/** Back and forward through the places visited, like a browser's own buttons. */
export function HistoryButtons({ className }: { className?: string }) {
  const { connection } = useExplorerContext();
  const { back, forward, goBack, goForward } = useNavigationHistory(connection.id);
  return (
    <div className={cn("flex items-center", className)}>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={!back}
        aria-label={back ? `Back to ${back.label}` : "Back"}
        title={back ? `Back to ${back.label} (${SHORTCUTS.back})` : undefined}
        className="disabled:opacity-30"
        onClick={goBack}
      >
        <ChevronLeftIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={!forward}
        aria-label={forward ? `Forward to ${forward.label}` : "Forward"}
        title={forward ? `Forward to ${forward.label} (${SHORTCUTS.forward})` : undefined}
        className="disabled:opacity-30"
        onClick={goForward}
      >
        <ChevronRightIcon />
      </Button>
    </div>
  );
}
