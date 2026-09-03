"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SQLNamespace } from "@codemirror/lang-sql";
import {
  BookmarkIcon,
  EraserIcon,
  LoaderCircleIcon,
  PlayIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { useExplorerContext } from "@/components/explorer/explorer-provider";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { MAX_QUERY_LENGTH } from "@/lib/query-limits";
import { useQueries, type SavedQuery } from "@/lib/store/queries";
import type { SqlQueryResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { QueryEditor, type QueryEditorHandle } from "./query-editor";
import { QueryResultGrid } from "./query-result-grid";
import { QuerySidebar, type QuerySidebarTab } from "./query-sidebar";
import { SaveQueryDialog } from "./save-query-dialog";

const DATA_ONLY_COMMANDS = new Set(["SELECT", "SHOW", "EXPLAIN", "FETCH"]);

export function QueryView() {
  const { connection, tables } = useExplorerContext();
  const draft = useQueries((state) => state.drafts[connection.id] ?? "");
  const setDraft = useQueries((state) => state.setDraft);
  const record = useQueries((state) => state.record);
  const activeSavedId = useQueries((state) => state.activeSaved[connection.id] ?? null);
  const activeSaved = useQueries((state) =>
    activeSavedId ? (state.saved.find((query) => query.id === activeSavedId) ?? null) : null,
  );
  const setActiveSaved = useQueries((state) => state.setActiveSaved);
  const updateSaved = useQueries((state) => state.updateSaved);
  const [result, setResult] = useState<SqlQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<QuerySidebarTab>("saved");
  const editorRef = useRef<QueryEditorHandle>(null);
  const requestRef = useRef<AbortController | null>(null);

  const dirty = activeSaved !== null && activeSaved.sql !== draft;
  const canSave = draft.trim().length > 0 && (activeSaved === null || dirty);

  const completionSchema = useMemo((): SQLNamespace => {
    const root: Record<string, Record<string, string[]>> = {};
    for (const table of tables.data ?? []) {
      const schema = (root[table.schema] ??= {});
      schema[table.name] = table.columns.map((column) => column.name);
    }
    return root;
  }, [tables.data]);

  useEffect(() => () => requestRef.current?.abort(), []);

  function queryToRun(): string {
    return editorRef.current?.selectedText().trim() || draft.trim();
  }

  async function run() {
    if (loading) return;
    const sql = queryToRun();
    if (!sql) {
      setError("Enter a query to run.");
      editorRef.current?.focus();
      return;
    }

    const controller = new AbortController();
    requestRef.current = controller;
    record(connection.id, sql);
    setLoading(true);
    setError(null);
    try {
      const nextResult = await api.query(connection.url, sql, controller.signal);
      setResult(nextResult);
      if (nextResult.statements.some((statement) => !DATA_ONLY_COMMANDS.has(statement.command))) {
        tables.reload();
      }
    } catch (caught: unknown) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }

  /** Updates the loaded saved query in place, or asks for a name when nothing is loaded. */
  function save() {
    if (!draft.trim()) {
      setError("Enter a query to save.");
      editorRef.current?.focus();
      return;
    }
    if (activeSaved) {
      if (dirty) updateSaved(activeSaved.id, { sql: draft });
      return;
    }
    setSaving(true);
  }

  function loadEditor(sql: string) {
    setDraft(connection.id, sql);
    setError(null);
    window.requestAnimationFrame(() => editorRef.current?.focus(true));
  }

  function loadHistory(sql: string) {
    setActiveSaved(connection.id, null);
    loadEditor(sql);
  }

  function loadSaved(query: SavedQuery) {
    setActiveSaved(connection.id, query.id);
    loadEditor(query.sql);
  }

  function clear() {
    setDraft(connection.id, "");
    setActiveSaved(connection.id, null);
    setError(null);
    editorRef.current?.focus();
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
          <SquareTerminalIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="font-medium">Query</span>
          <span className="truncate text-xs text-muted-foreground">{connection.name}</span>
          {activeSaved && (
            <span
              className="flex min-w-0 items-center gap-1.5 rounded-md bg-muted/70 py-0.5 pr-2 pl-1.5 text-xs"
              title={dirty ? `${activeSaved.name} (unsaved changes)` : activeSaved.name}
            >
              <BookmarkIcon className="size-3 shrink-0 fill-current text-muted-foreground" />
              <span className="truncate">{activeSaved.name}</span>
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full bg-primary transition-opacity",
                  dirty ? "opacity-100" : "opacity-0",
                )}
              />
            </span>
          )}
          <span className="ml-auto hidden text-[11px] text-muted-foreground lg:inline">
            Run selection or script with <kbd className="font-mono">⌘/Ctrl ↵</kbd>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!canSave}
            title={activeSaved ? "Save changes (⌘S)" : "Save query (⌘S)"}
            onClick={save}
          >
            <BookmarkIcon
              data-icon="inline-start"
              className={cn(activeSaved && !dirty && "fill-current")}
            />
            {activeSaved && !dirty ? "Saved" : "Save"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={loading || (!draft && !activeSaved)}
            onClick={clear}
          >
            <EraserIcon data-icon="inline-start" />
            Clear
          </Button>
          <Button type="button" size="sm" disabled={loading || !draft.trim()} onClick={() => void run()}>
            {loading ? (
              <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
            ) : (
              <PlayIcon data-icon="inline-start" />
            )}
            {loading ? "Running" : "Run"}
          </Button>
        </header>

        <div className="h-56 min-h-36 max-h-[55vh] shrink-0 resize-y overflow-hidden border-b bg-background">
          <QueryEditor
            ref={editorRef}
            value={draft}
            schema={completionSchema}
            maxLength={MAX_QUERY_LENGTH}
            onChange={(value) => setDraft(connection.id, value)}
            onRun={() => void run()}
            onSave={save}
          />
        </div>

        {error ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-9 shrink-0 items-center border-b px-3 text-xs font-medium">
              Execution failed
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <div className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 font-mono text-xs whitespace-pre-wrap text-destructive">
                {error}
              </div>
            </div>
          </div>
        ) : (
          <QueryResultGrid result={result} loading={loading} />
        )}
      </section>

      <QuerySidebar
        connectionId={connection.id}
        tab={sidebarTab}
        onTabChange={setSidebarTab}
        activeSavedId={activeSaved?.id ?? null}
        dirty={dirty}
        onSelectSaved={loadSaved}
        onSelectHistory={loadHistory}
      />

      <SaveQueryDialog
        open={saving}
        connectionId={connection.id}
        sql={draft}
        onOpenChange={setSaving}
        onSaved={() => {
          setSidebarTab("saved");
          window.requestAnimationFrame(() => editorRef.current?.focus());
        }}
      />
    </div>
  );
}
