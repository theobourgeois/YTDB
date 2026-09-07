"use client";

import { useEffect, useRef } from "react";
import { dismissPalettes } from "@/lib/palettes";
import { useSqlEditor } from "./use-sql-editor";
import { useSwitchConnection } from "./use-switch-connection";

/** App-wide shortcuts that are not owned by a single view. */
export function GlobalShortcuts() {
  const { toggle } = useSqlEditor();
  const { run: switchConnection } = useSwitchConnection();
  const toggleRef = useRef(toggle);
  const switchRef = useRef(switchConnection);

  useEffect(() => {
    toggleRef.current = toggle;
  }, [toggle]);

  useEffect(() => {
    switchRef.current = switchConnection;
  }, [switchConnection]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.repeat || event.key.toLowerCase() !== "e") return;
      event.preventDefault();
      dismissPalettes();
      if (event.shiftKey) {
        void switchRef.current();
        return;
      }
      toggleRef.current();
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return null;
}
