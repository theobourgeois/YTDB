"use client";

import { useEffect, useRef } from "react";
import { dismissPalettes } from "@/lib/palettes";
import { useConnections } from "@/lib/store/connections";
import { useMigrationsPane } from "./use-migrations-pane";
import { useSchemaDiff } from "./use-schema-diff";
import { useSqlEditor } from "./use-sql-editor";
import { useNavigationHistory } from "./use-navigation-history";
import { useSwitchConnection } from "./use-switch-connection";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** App-wide shortcuts that are not owned by a single view. */
export function GlobalShortcuts() {
  const { toggle } = useSqlEditor();
  const { toggle: toggleDiff } = useSchemaDiff();
  const { toggle: toggleMigrations } = useMigrationsPane();
  const { run: switchConnection } = useSwitchConnection();
  const history = useNavigationHistory();
  const comparable = useConnections((state) => state.connections.length > 1);
  const toggleRef = useRef(toggle);
  const diffRef = useRef(toggleDiff);
  const migrationsRef = useRef(toggleMigrations);
  const switchRef = useRef(switchConnection);
  const historyRef = useRef(history);
  const comparableRef = useRef(comparable);

  useEffect(() => {
    toggleRef.current = toggle;
  }, [toggle]);

  useEffect(() => {
    diffRef.current = toggleDiff;
  }, [toggleDiff]);

  useEffect(() => {
    migrationsRef.current = toggleMigrations;
  }, [toggleMigrations]);

  useEffect(() => {
    switchRef.current = switchConnection;
  }, [switchConnection]);

  useEffect(() => {
    comparableRef.current = comparable;
  }, [comparable]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.repeat) return;
      const key = event.key.toLowerCase();

      if (key === "[" || key === "]") {
        // Editors indent with these; only step through history when not typing.
        if (event.shiftKey || isTypingTarget(event.target)) return;
        event.preventDefault();
        dismissPalettes();
        if (key === "[") historyRef.current.goBack();
        else historyRef.current.goForward();
        return;
      }

      if (key === "m" && event.shiftKey) {
        event.preventDefault();
        dismissPalettes();
        migrationsRef.current();
        return;
      }

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
