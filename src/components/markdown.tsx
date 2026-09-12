import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Renders the markdown a note is written in: headings, lists, task items, code,
 * links, emphasis. Nothing is interpreted as HTML, so a file from disk is safe to
 * show. A single newline inside a paragraph is kept as a line break, the way a
 * note written line by line reads.
 */

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; blocks: Block[] }
  | { type: "code"; code: string }
  | { type: "rule" }
  | { type: "list"; ordered: boolean; start: number; items: ListItem[] };

type ListItem = { checked: boolean | null; blocks: Block[] };

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BULLET = /^( {0,3})([-*+])(\s+|$)/;
const NUMBERED = /^( {0,3})(\d{1,9})[.)](\s+|$)/;
const QUOTE = /^ {0,3}>\s?/;
const TASK = /^\[([ xX])\]\s+/;

function isBlank(line: string): boolean {
  return line.trim() === "";
}

function startsBlock(line: string): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line) ||
    QUOTE.test(line)
  );
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const close = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`);
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !close.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push({ type: "code", code: code.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      i += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        inner.push(lines[i].replace(QUOTE, ""));
        i += 1;
      }
      blocks.push({ type: "quote", blocks: parseBlocks(inner) });
      continue;
    }

    const marker = BULLET.exec(line) ?? NUMBERED.exec(line);
    if (marker) {
      const ordered = NUMBERED.test(line);
      const start = ordered ? Number(marker[2]) : 1;
      const items: ListItem[] = [];
      while (i < lines.length) {
        const head = (ordered ? NUMBERED : BULLET).exec(lines[i]);
        if (!head) break;
        // Everything indented past the marker belongs to the item, including nested lists.
        const indent = head[0].length;
        const body = [lines[i].slice(indent)];
        i += 1;
        while (i < lines.length) {
          const next = lines[i];
          if (isBlank(next)) {
            const after = lines[i + 1];
            if (after !== undefined && leading(after) >= 2) {
              body.push("");
              i += 1;
              continue;
            }
            break;
          }
          if (leading(next) >= 2) {
            body.push(next.slice(Math.min(indent, leading(next))));
            i += 1;
            continue;
          }
          // A plain line right below the item wraps it, as it would in a text editor.
          if (!startsBlock(next) && body[body.length - 1] !== "") {
            body.push(next);
            i += 1;
            continue;
          }
          break;
        }
        const task = TASK.exec(body[0]);
        if (task) body[0] = body[0].replace(TASK, "");
        items.push({ checked: task ? task[1] !== " " : null, blocks: parseBlocks(body) });
        // A blank line between items is fine; two lists only split on a different marker kind.
        while (i < lines.length && isBlank(lines[i]) && lines[i + 1] !== undefined) {
          if ((ordered ? NUMBERED : BULLET).test(lines[i + 1])) i += 1;
          else break;
        }
      }
      blocks.push({ type: "list", ordered, start, items });
      continue;
    }

    const text: string[] = [line];
    i += 1;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i])) {
      text.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: "paragraph", text: text.join("\n") });
  }
  return blocks;
}

function leading(line: string): number {
  return line.length - line.trimStart().length;
}

// Escapes, code spans, strong, emphasis, links, bare URLs, then line breaks.
const INLINE =
  /\\([\\`*_[\]()#>~-])|(`+)([\s\S]*?[^`])\2(?!`)|\*\*(.+?)\*\*|(?<!\w)__(.+?)__(?!\w)|\*(?=\S)(.+?)(?<=\S)\*|(?<!\w)_(?=\S)(.+?)(?<=\S)_(?!\w)|~~(.+?)~~|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])|\n/g;

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    last = index + match[0].length;
    const [whole, escaped, , code, strong, strongAlt, em, emAlt, strike, linkText, href, url] = match;
    if (escaped !== undefined) out.push(escaped);
    else if (code !== undefined) out.push(<Code key={key++}>{code.trim()}</Code>);
    else if (strong !== undefined || strongAlt !== undefined)
      out.push(<strong key={key++} className="font-medium text-foreground">{renderInline(strong ?? strongAlt)}</strong>);
    else if (em !== undefined || emAlt !== undefined) out.push(<em key={key++}>{renderInline(em ?? emAlt)}</em>);
    else if (strike !== undefined) out.push(<s key={key++}>{renderInline(strike)}</s>);
    else if (linkText !== undefined) out.push(<Anchor key={key++} href={href}>{renderInline(linkText)}</Anchor>);
    else if (url !== undefined) out.push(<Anchor key={key++} href={url}>{url}</Anchor>);
    else if (whole === "\n") out.push(<br key={key++} />);
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1 py-px font-mono text-[0.92em]">{children}</code>;
}

function Anchor({ href, children }: { href: string; children: ReactNode }) {
  const safe = /^(https?:|mailto:)/i.test(href);
  return (
    <a
      href={safe ? href : undefined}
      target="_blank"
      rel="noreferrer"
      className="underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground"
    >
      {children}
    </a>
  );
}

function renderBlocks(blocks: Block[], tight: boolean): ReactNode {
  return blocks.map((block, index) => {
    switch (block.type) {
      case "heading":
        return (
          <p
            key={index}
            className={cn("font-medium text-foreground", block.level <= 2 ? "text-[1.1em]" : "")}
          >
            {renderInline(block.text)}
          </p>
        );
      case "paragraph":
        return tight ? (
          <Fragment key={index}>{renderInline(block.text)}</Fragment>
        ) : (
          <p key={index}>{renderInline(block.text)}</p>
        );
      case "quote":
        return (
          <blockquote key={index} className="space-y-2 border-l-2 pl-3 text-muted-foreground">
            {renderBlocks(block.blocks, false)}
          </blockquote>
        );
      case "code":
        return (
          <pre
            key={index}
            className="overflow-x-auto rounded-md border bg-muted/40 px-2.5 py-2 font-mono text-[0.92em] leading-relaxed"
          >
            {block.code}
          </pre>
        );
      case "rule":
        return <hr key={index} className="border-border" />;
      case "list": {
        const Tag = block.ordered ? "ol" : "ul";
        const tasks = block.items.some((item) => item.checked !== null);
        return (
          <Tag
            key={index}
            start={block.ordered ? block.start : undefined}
            className={cn(
              "space-y-0.5",
              tasks ? "list-none pl-0" : block.ordered ? "list-decimal pl-5" : "list-disc pl-5",
            )}
          >
            {block.items.map((item, itemIndex) => {
              const single = item.blocks.length === 1 && item.blocks[0].type === "paragraph";
              return (
                <li key={itemIndex} className={cn(item.checked !== null && "flex items-start gap-2")}>
                  {item.checked !== null && (
                    <span
                      aria-hidden
                      className={cn(
                        "mt-[0.3em] inline-flex size-[0.85em] shrink-0 items-center justify-center rounded-[3px] border",
                        item.checked ? "border-foreground bg-foreground text-background" : "border-muted-foreground/60",
                      )}
                    >
                      {item.checked && (
                        <svg viewBox="0 0 12 12" className="size-[0.7em]" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M2.5 6.5 5 9l4.5-6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                  )}
                  <span className={cn("min-w-0", !single && "block space-y-1.5", item.checked && "text-muted-foreground line-through")}>
                    {renderBlocks(item.blocks, single)}
                  </span>
                </li>
              );
            })}
          </Tag>
        );
      }
    }
  });
}

type Props = { text: string; className?: string };

export function Markdown({ text, className }: Props) {
  const blocks = parseBlocks(text.replace(/\r\n?/g, "\n").split("\n"));
  return <div className={cn("space-y-2 break-words", className)}>{renderBlocks(blocks, false)}</div>;
}
