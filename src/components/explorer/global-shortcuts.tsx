"use client";

import { useEffect, useRef } from "react";
import { dismissPalettes } from "@/lib/palettes";
import { useSqlEditor } from "./use-sql-editor";

/** App-wide shortcuts that are not owned by a single view. */
export function GlobalShortcuts() {
  const { toggle } = useSqlEditor();
  const toggleRef = useRef(toggle);

  useEffect(() => {
    toggleRef.current = toggle;
  }, [toggle]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "e") return;
      event.preventDefault();
      dismissPalettes();
      toggleRef.current();
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return null;
}
