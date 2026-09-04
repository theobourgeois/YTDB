"use client";

import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLanguage } from "@codemirror/lang-json";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { BracesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Matches the SQL editor's palette so json and sql read as the same surface,
 * minus the gutter and active-line chrome: these fields are a few lines tall.
 */
const editorTheme = [
  EditorView.theme({
    "&": {
      backgroundColor: "var(--background)",
      color: "var(--foreground)",
      fontSize: "12px",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: "var(--font-geist-mono), ui-monospace, SFMono-Regular, monospace",
      lineHeight: "1.5",
    },
    ".cm-content": { padding: "6px 0", caretColor: "var(--foreground)" },
    ".cm-line": { padding: "0 8px" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "color-mix(in oklch, var(--primary) 18%, transparent) !important",
    },
    ".cm-matchingBracket": {
      backgroundColor: "color-mix(in oklch, var(--primary) 16%, transparent)",
      outline: "1px solid color-mix(in oklch, var(--primary) 32%, transparent)",
    },
    ".cm-placeholder": { color: "var(--muted-foreground)" },
  }),
  syntaxHighlighting(
    HighlightStyle.define([
      { tag: tags.propertyName, color: "var(--chart-1)", fontWeight: "600" },
      { tag: [tags.string, tags.special(tags.string)], color: "var(--chart-2)" },
      { tag: [tags.number, tags.bool, tags.null], color: "var(--chart-3)" },
      { tag: [tags.separator, tags.punctuation], color: "var(--foreground)", opacity: "0.72" },
    ]),
  ),
];

/** Pretty-prints when the draft parses; returns null when it does not. */
export function formatJson(draft: string): string | null {
  try {
    return JSON.stringify(JSON.parse(draft), null, 2);
  } catch {
    return null;
  }
}

/** The parse complaint for a draft, or null when it is valid (or empty). */
export function jsonError(draft: string): string | null {
  if (!draft.trim()) return null;
  try {
    JSON.parse(draft);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid JSON";
  }
}

export function JsonField({
  id,
  value,
  disabled,
  invalid,
  autoFocus,
  minHeight = "5rem",
  onChange,
  onSubmit,
}: {
  id?: string;
  value: string;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  minHeight?: string;
  onChange: (value: string) => void;
  /** Fired on Cmd/Ctrl-Enter, which is never a newline here. */
  onSubmit?: () => void;
}) {
  const parseError = jsonError(value);
  const formatted = formatJson(value);
  const canFormat = formatted !== null && formatted !== value;

  const extensions = useMemo(
    () => [
      jsonLanguage(),
      editorTheme,
      EditorState.readOnly.of(Boolean(disabled)),
      EditorView.lineWrapping,
      keymap.of([
        {
          key: "Mod-Enter",
          run: () => {
            onSubmit?.();
            return true;
          },
        },
      ]),
    ],
    [disabled, onSubmit],
  );

  return (
    <div>
      <div
        id={id}
        data-invalid={invalid || Boolean(parseError) || undefined}
        className={cn(
          "relative overflow-hidden rounded-lg border border-input bg-transparent transition-[color,box-shadow]",
          "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
          "data-invalid:border-destructive data-invalid:focus-within:border-destructive data-invalid:focus-within:ring-destructive/30",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        <CodeMirror
          value={value}
          height="auto"
          minHeight={minHeight}
          maxHeight="18rem"
          autoFocus={autoFocus}
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            highlightActiveLine: false,
            highlightActiveLineGutter: false,
            autocompletion: false,
            bracketMatching: true,
            closeBrackets: true,
            indentOnInput: true,
            searchKeymap: false,
          }}
          placeholder="{ }"
          extensions={extensions}
          onChange={onChange}
        />
        {canFormat && !disabled && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            title="Format JSON"
            aria-label="Format JSON"
            onClick={() => onChange(formatted)}
            className="absolute top-1 right-1 bg-background/80 backdrop-blur-xs"
          >
            <BracesIcon />
          </Button>
        )}
      </div>
      {parseError && (
        <p className="mt-1 font-mono text-[10px] text-destructive">{parseError}</p>
      )}
    </div>
  );
}
