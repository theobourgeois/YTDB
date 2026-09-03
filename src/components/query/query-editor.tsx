"use client";

import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { PostgreSQL, sql, type SQLNamespace } from "@codemirror/lang-sql";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";

export type QueryEditorHandle = {
  focus: (toEnd?: boolean) => void;
  selectedText: () => string;
};

const editorTheme = [
  EditorView.theme({
    "&": {
      height: "100%",
      backgroundColor: "var(--background)",
      color: "var(--foreground)",
      fontSize: "13px",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: "var(--font-geist-mono), ui-monospace, SFMono-Regular, monospace",
      lineHeight: "1.6",
    },
    ".cm-content": { padding: "10px 0", caretColor: "var(--foreground)" },
    ".cm-line": { padding: "0 16px 0 8px" },
    ".cm-gutters": {
      backgroundColor: "color-mix(in oklch, var(--muted) 35%, var(--background))",
      color: "var(--muted-foreground)",
      borderRight: "1px solid var(--border)",
    },
    ".cm-lineNumbers .cm-gutterElement": { minWidth: "42px", padding: "0 10px 0 6px" },
    ".cm-activeLine": {
      backgroundColor: "color-mix(in oklch, var(--muted) 42%, transparent)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "color-mix(in oklch, var(--muted) 68%, var(--background))",
      color: "var(--foreground)",
    },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "color-mix(in oklch, var(--primary) 18%, transparent) !important",
    },
    ".cm-matchingBracket": {
      backgroundColor: "color-mix(in oklch, var(--primary) 16%, transparent)",
      outline: "1px solid color-mix(in oklch, var(--primary) 32%, transparent)",
    },
    ".cm-tooltip": {
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-md)",
      backgroundColor: "var(--popover)",
      color: "var(--popover-foreground)",
      overflow: "hidden",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "var(--accent)",
      color: "var(--accent-foreground)",
    },
  }),
  syntaxHighlighting(
    HighlightStyle.define([
      { tag: tags.keyword, color: "var(--chart-1)", fontWeight: "600" },
      { tag: [tags.string, tags.special(tags.string)], color: "var(--chart-2)" },
      { tag: [tags.number, tags.bool, tags.null], color: "var(--chart-3)" },
      { tag: [tags.typeName, tags.className], color: "var(--chart-4)" },
      { tag: tags.function(tags.variableName), color: "var(--chart-4)" },
      { tag: tags.comment, color: "var(--muted-foreground)", fontStyle: "italic" },
      { tag: [tags.operator, tags.punctuation], color: "var(--foreground)", opacity: "0.72" },
    ]),
  ),
];

export const QueryEditor = forwardRef<
  QueryEditorHandle,
  {
    value: string;
    schema: SQLNamespace;
    maxLength: number;
    onChange: (value: string) => void;
    onRun: () => void;
    onSave: () => void;
  }
>(function QueryEditor({ value, schema, maxLength, onChange, onRun, onSave }, ref) {
  const viewRef = useRef<EditorView | null>(null);
  const runRef = useRef(onRun);
  runRef.current = onRun;
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  const extensions = useMemo(
    () => [
      sql({ dialect: PostgreSQL, schema }),
      EditorState.changeFilter.of((transaction) => transaction.newDoc.length <= maxLength),
      EditorView.contentAttributes.of({ "aria-label": "SQL query editor" }),
      keymap.of([
        {
          key: "Mod-Enter",
          run: () => {
            runRef.current();
            return true;
          },
        },
        {
          key: "Mod-s",
          run: () => {
            saveRef.current();
            return true;
          },
        },
        indentWithTab,
      ]),
    ],
    [maxLength, schema],
  );

  useImperativeHandle(ref, () => ({
    focus(toEnd = false) {
      const view = viewRef.current;
      if (!view) return;
      if (toEnd) {
        const end = view.state.doc.length;
        view.dispatch({ selection: { anchor: end }, scrollIntoView: true });
      }
      view.focus();
    },
    selectedText() {
      const view = viewRef.current;
      if (!view) return "";
      const selection = view.state.selection.main;
      return selection.empty ? "" : view.state.sliceDoc(selection.from, selection.to);
    },
  }));

  return (
    <CodeMirror
      value={value}
      height="100%"
      theme={editorTheme}
      extensions={extensions}
      placeholder={"select *\nfrom public.users\nlimit 100;"}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLineGutter: true,
        highlightSpecialChars: true,
        history: true,
        drawSelection: true,
        dropCursor: true,
        allowMultipleSelections: true,
        indentOnInput: true,
        bracketMatching: true,
        closeBrackets: true,
        autocompletion: true,
        rectangularSelection: true,
        crosshairCursor: false,
        highlightActiveLine: true,
        highlightSelectionMatches: true,
      }}
      onCreateEditor={(view) => {
        viewRef.current = view;
      }}
      onChange={onChange}
    />
  );
});
