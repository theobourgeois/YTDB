import type { ReactNode } from "react";

export function HighlightMatch({ text, query }: { text: string; query: string }) {
  const trimmed = query.trim();
  if (!trimmed) return text;

  const lowerText = text.toLocaleLowerCase();
  const lowerQuery = trimmed.toLocaleLowerCase();
  const first = lowerText.indexOf(lowerQuery);
  if (first === -1) return text;

  const parts: ReactNode[] = [];
  let cursor = 0;
  let match = first;
  let key = 0;
  while (match !== -1) {
    if (match > cursor) parts.push(text.slice(cursor, match));
    parts.push(
      <mark
        key={key}
        className="rounded-[3px] bg-yellow-300/90 px-px text-yellow-950 dark:bg-yellow-400/85 dark:text-yellow-950"
      >
        {text.slice(match, match + trimmed.length)}
      </mark>,
    );
    key += 1;
    cursor = match + trimmed.length;
    match = lowerText.indexOf(lowerQuery, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}
