export type SqlTokenKind =
  | "keyword"
  | "function"
  | "ident"
  | "string"
  | "number"
  | "comment"
  | "text";

export type SqlToken = { kind: SqlTokenKind; value: string };

const KEYWORDS = new Set([
  "add",
  "all",
  "alter",
  "always",
  "and",
  "as",
  "asc",
  "authorization",
  "between",
  "by",
  "cascade",
  "case",
  "cast",
  "check",
  "collate",
  "column",
  "concurrently",
  "constraint",
  "create",
  "cross",
  "current",
  "default",
  "deferrable",
  "deferred",
  "delete",
  "desc",
  "distinct",
  "drop",
  "else",
  "end",
  "except",
  "exclude",
  "exists",
  "false",
  "foreign",
  "from",
  "full",
  "generated",
  "grant",
  "group",
  "having",
  "identity",
  "if",
  "ilike",
  "immediate",
  "in",
  "include",
  "index",
  "inherits",
  "inner",
  "instead",
  "intersect",
  "into",
  "is",
  "join",
  "key",
  "lateral",
  "left",
  "like",
  "limit",
  "match",
  "materialized",
  "natural",
  "no",
  "not",
  "null",
  "nulls",
  "of",
  "offset",
  "on",
  "only",
  "or",
  "order",
  "outer",
  "over",
  "partition",
  "primary",
  "references",
  "replace",
  "restrict",
  "returning",
  "right",
  "select",
  "server",
  "set",
  "stored",
  "table",
  "temp",
  "temporary",
  "then",
  "time",
  "to",
  "trigger",
  "true",
  "union",
  "unique",
  "unlogged",
  "update",
  "using",
  "values",
  "view",
  "when",
  "where",
  "window",
  "with",
  "without",
  "zone",
]);

export function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];
    if (!ch) break;

    if (isWhitespace(ch)) {
      const start = i;
      i += 1;
      while (i < sql.length && isWhitespace(sql[i])) i += 1;
      tokens.push({ kind: "text", value: sql.slice(start, i) });
      continue;
    }

    if (ch === "-" && sql[i + 1] === "-") {
      const start = i;
      i += 2;
      while (i < sql.length && sql[i] !== "\n") i += 1;
      tokens.push({ kind: "comment", value: sql.slice(start, i) });
      continue;
    }

    if (ch === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      const next = end === -1 ? sql.length : end + 2;
      tokens.push({ kind: "comment", value: sql.slice(i, next) });
      i = next;
      continue;
    }

    if (ch === "$") {
      const tag = dollarTag(sql, i);
      if (tag) {
        const contentStart = i + tag.length;
        const end = sql.indexOf(tag, contentStart);
        const next = end === -1 ? sql.length : end + tag.length;
        tokens.push({ kind: "string", value: sql.slice(i, next) });
        i = next;
        continue;
      }
    }

    if (ch === '"') {
      i = pushQuoted(sql, i, '"', "ident", tokens);
      continue;
    }

    if (ch === "'") {
      i = pushQuoted(sql, i, "'", "string", tokens);
      continue;
    }

    if (isDigit(ch) || (ch === "." && isDigit(sql[i + 1]))) {
      const start = i;
      i = scanNumber(sql, i);
      tokens.push({ kind: "number", value: sql.slice(start, i) });
      continue;
    }

    if (isIdentStart(ch)) {
      const start = i;
      i += 1;
      while (i < sql.length && isIdentPart(sql[i])) i += 1;
      const word = sql.slice(start, i);
      tokens.push({ kind: wordKind(sql, word, i), value: word });
      continue;
    }

    tokens.push({ kind: "text", value: ch });
    i += 1;
  }

  return tokens;
}

export function tokensByLine(tokens: SqlToken[]): SqlToken[][] {
  const lines: SqlToken[][] = [[]];
  for (const token of tokens) {
    const parts = token.value.split("\n");
    for (let index = 0; index < parts.length; index += 1) {
      if (index > 0) lines.push([]);
      const part = parts[index];
      const line = lines[lines.length - 1];
      if (part && line) line.push({ kind: token.kind, value: part });
    }
  }
  return lines;
}

function wordKind(sql: string, word: string, after: number): SqlTokenKind {
  const lower = word.toLowerCase();
  if (KEYWORDS.has(lower)) return "keyword";
  let look = after;
  while (look < sql.length && (sql[look] === " " || sql[look] === "\t")) look += 1;
  if (sql[look] === "(") return "function";
  return "ident";
}

function dollarTag(sql: string, index: number): string | null {
  if (sql[index] !== "$") return null;
  let i = index + 1;
  while (i < sql.length && isIdentPart(sql[i])) i += 1;
  if (sql[i] !== "$") return null;
  return sql.slice(index, i + 1);
}

function pushQuoted(
  sql: string,
  index: number,
  quote: '"' | "'",
  kind: Extract<SqlTokenKind, "ident" | "string">,
  tokens: SqlToken[],
): number {
  let i = index + 1;
  while (i < sql.length) {
    if (sql[i] === quote) {
      if (sql[i + 1] === quote) {
        i += 2;
        continue;
      }
      i += 1;
      break;
    }
    i += 1;
  }
  tokens.push({ kind, value: sql.slice(index, i) });
  return i;
}

function scanNumber(sql: string, index: number): number {
  let i = index;
  if (sql[i] === ".") i += 1;
  while (i < sql.length && isDigit(sql[i])) i += 1;
  if (sql[i] === "." && isDigit(sql[i + 1])) {
    i += 1;
    while (i < sql.length && isDigit(sql[i])) i += 1;
  }
  if (sql[i] === "e" || sql[i] === "E") {
    let next = i + 1;
    if (sql[next] === "+" || sql[next] === "-") next += 1;
    if (isDigit(sql[next])) {
      i = next;
      while (i < sql.length && isDigit(sql[i])) i += 1;
    }
  }
  return i;
}

function isWhitespace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

function isIdentStart(ch: string | undefined): boolean {
  return ch !== undefined && ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_");
}

function isIdentPart(ch: string | undefined): boolean {
  return isIdentStart(ch) || isDigit(ch) || ch === "$";
}
