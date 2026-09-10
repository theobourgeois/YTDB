"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SQLNamespace } from "@codemirror/lang-sql";
import { ArrowLeftIcon, EraserIcon, SpinnerIcon, PlayIcon, TerminalIcon } from "@/components/icons";
import { useExplorerContext } from "@/components/explorer/explorer-provider";
import { ViewHeader } from "@/components/explorer/view-header";
import { useNavigationHistory } from "@/components/explorer/use-navigation-history";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { MAX_QUERY_LENGTH } from "@/lib/query-limits";
import { SHORTCUTS } from "@/lib/shortcuts";
import { MAX_EDITOR_HEIGHT, MIN_EDITOR_HEIGHT, useQueries } from "@/lib/store/queries";
import type { SqlQueryResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { QueryEditor, type QueryEditorHandle } from "./query-editor";
import { QueryResultGrid } from "./query-result-grid";
import { QuerySidebar } from "./query-sidebar";

const DATA_ONLY_COMMANDS = new Set(["SELECT", "SHOW", "EXPLAIN", "FETCH"]);

export function QueryView() {
  const { connection, tables } = useExplorerContext();
  const draft = useQueries((state) => state.drafts[connection.id] ?? "");
  const setDraft = useQueries((state) => state.setDraft);
  const record = useQueries((state) => state.record);
  const editorHeight = useQueries((state) => state.editorHeight);
  const setEditorHeight = useQueries((state) => state.setEditorHeight);
  const [result, setResult] = useState<SqlQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const editorRef = useRef<QueryEditorHandle>(null);
  const editorPaneRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const history = useNavigationHistory(connection.id);
  // SQL opened from a migration wants a way back to it once it has been looked at.
  const cameFromMigration =
    history.back?.route.kind === "migration" && history.back.route.connectionId === connection.id
      ? history.back
      : null;

  const completionSchema = useMemo((): SQLNamespace => {
    const root: Record<string, Record<string, string[]>> = {};
    for (const table of tables.data ?? []) {
      const schema = (root[table.schema] ??= {});
      schema[table.name] = table.columns.map((column) => column.name);
    }
    return root;
  }, [tables.data]);

  useEffect(() => () => requestRef.current?.abort(), []);

  /** Remembers where the user left the drag handle on the editor pane. */
  useEffect(() => {
    const pane = editorPaneRef.current;
    if (!pane) return;
    let timer: number | null = null;
    const observer = new ResizeObserver(() => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => setEditorHeight(pane.offsetHeight), 200);
    });
    observer.observe(pane);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [setEditorHeight]);

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

  function loadEditor(sql: string) {
    setDraft(connection.id, sql);
    setError(null);
    window.requestAnimationFrame(() => editorRef.current?.focus(true));
  }

  function clear() {
    setDraft(connection.id, "");
    setError(null);
    editorRef.current?.focus();
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <section className="flex min-w-0 flex-1 flex-col">
        <ViewHeader>
          <TerminalIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="font-medium">Query</span>
          {cameFromMigration && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto text-muted-foreground"
              title={`Back to ${cameFromMigration.label} (${SHORTCUTS.back})`}
              onClick={history.goBack}
            >
              <ArrowLeftIcon data-icon="inline-start" />
              <span className="max-w-40 truncate">{cameFromMigration.label}</span>
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(!cameFromMigration && "ml-auto")}
            disabled={loading || !draft}
            onClick={clear}
          >
            <EraserIcon data-icon="inline-start" />
            Clear
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={loading || !draft.trim()}
            title="Run the selection or the whole script (⌘↵)"
            onClick={() => void run()}
          >
            {loading ? (
              <SpinnerIcon data-icon="inline-start" className="animate-spin" />
            ) : (
              <PlayIcon data-icon="inline-start" />
            )}
            {loading ? "Running" : "Run"}
          </Button>
        </ViewHeader>

        <div
          ref={editorPaneRef}
          style={{ height: editorHeight, minHeight: MIN_EDITOR_HEIGHT, maxHeight: MAX_EDITOR_HEIGHT }}
          className="max-h-[55vh] shrink-0 resize-y overflow-hidden border-b bg-background"
        >
          <QueryEditor
            ref={editorRef}
            value={draft}
            schema={completionSchema}
            maxLength={MAX_QUERY_LENGTH}
            onChange={(value) => setDraft(connection.id, value)}
            onRun={() => void run()}
            onLimitExceeded={() =>
              setError(
                `Query is too long (maximum ${MAX_QUERY_LENGTH.toLocaleString()} characters).`,
              )
            }
          />
        </div>

        {error ? (
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <div className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 font-mono text-xs whitespace-pre-wrap text-destructive">
              {error}
            </div>
          </div>
        ) : (
          <QueryResultGrid result={result} loading={loading} />
        )}
      </section>

      <QuerySidebar connectionId={connection.id} onSelectHistory={loadEditor} />
    </div>
  );
}
