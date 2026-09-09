"use client";

import { useEffect, useRef } from "react";
import { dismissPalettes } from "@/lib/palettes";
import { useConnections } from "@/lib/store/connections";
import { useSchemaDiff } from "./use-schema-diff";
import { useSqlEditor } from "./use-sql-editor";
import { useSwitchConnection } from "./use-switch-connection";

/** App-wide shortcuts that are not owned by a single view. */
export function GlobalShortcuts() {
  const { toggle } = useSqlEditor();
  const { toggle: toggleDiff } = useSchemaDiff();
  const { run: switchConnection } = useSwitchConnection();
  const comparable = useConnections((state) => state.connections.length > 1);
  const toggleRef = useRef(toggle);
  const diffRef = useRef(toggleDiff);
  const switchRef = useRef(switchConnection);
  const comparableRef = useRef(comparable);

  useEffect(() => {
    toggleRef.current = toggle;
  }, [toggle]);

  useEffect(() => {
    diffRef.current = toggleDiff;
  }, [toggleDiff]);

  useEffect(() => {
    switchRef.current = switchConnection;
  }, [switchConnection]);

  useEffect(() => {
    comparableRef.current = comparable;
  }, [comparable]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.repeat) return;
      const key = event.key.toLowerCase();

      if (key === "d" && event.shiftKey) {
        if (!comparableRef.current) return;
        event.preventDefault();
        dismissPalettes();
        diffRef.current();
        return;
      }

      if (key !== "e") return;
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
