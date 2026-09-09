/**
 * How a migration file's own transaction control is handled.
 *
 * A migration and the ledger row recording it must land together, or a failure
 * halfway leaves the two disagreeing. YTDB gets that by running both in one
 * transaction — which it can only do when the file is not already driving
 * transactions itself.
 */
export type TransactionMode =
  /** The file has no transaction control, so YTDB opens one around it. */
  | "wrapped-by-ytdb"
  /** The file is one BEGIN…COMMIT block; YTDB takes it over so the ledger joins it. */
  | "self-wrapped"
  /** `-- ytdb:no-transaction`: runs with no transaction at all. */
  | "unwrapped"
  /** The file commits more than once, so YTDB runs it as written and stays out of the way. */
  | "self-managed";

export type TransactionPlan = {
  mode: TransactionMode;
  /** The SQL to execute, with an outer BEGIN/COMMIT removed when YTDB took it over. */
  sql: string;
  /** True when the migration and its ledger row commit together. */
  atomic: boolean;
};

/** Opts a file out of any wrapping transaction — CREATE INDEX CONCURRENTLY and friends. */
const NO_TRANSACTION_DIRECTIVE = /^[ \t]*--+[ \t]*ytdb:[ \t]*no-?transaction\b/im;

const OPENS = new Set(["begin", "start"]);
const CLOSES = new Set(["commit", "end"]);
const ROLLS_BACK = new Set(["rollback"]);

type Statement = {
  /** Offset of the statement's first keyword, after any leading comments. */
  at: number;
  /** Offset just past the statement's terminating semicolon. */
  end: number;
  keyword: string;
};

function isIdentStart(ch: string | undefined): boolean {
  return ch !== undefined && ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_");
}

function isIdentPart(ch: string | undefined): boolean {
  return isIdentStart(ch) || (ch !== undefined && ch >= "0" && ch <= "9");
}

/** `$$` or `$tag$`, whose body PostgreSQL treats as one literal — semicolons and all. */
function dollarTag(sql: string, index: number): string | null {
  if (sql[index] !== "$") return null;
  let i = index + 1;
  while (i < sql.length && isIdentPart(sql[i])) i += 1;
  if (sql[i] !== "$") return null;
  return sql.slice(index, i + 1);
}

function skipQuoted(sql: string, index: number, quote: string): number {
  let i = index + 1;
  while (i < sql.length) {
    if (sql[i] === quote) {
      if (sql[i + 1] === quote) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  return i;
}

/** Advances past whitespace and comments, which never begin a statement. */
function skipTrivia(sql: string, index: number): number {
  let i = index;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      const close = sql.indexOf("*/", i + 2);
      i = close === -1 ? sql.length : close + 2;
      continue;
    }
    return i;
  }
  return i;
}

/**
 * Splits SQL into top-level statements, ignoring semicolons inside comments,
 * quoted text, and dollar-quoted bodies — which is what keeps the BEGIN of a
 * PL/pgSQL function from being read as a transaction.
 */
export function scanStatements(sql: string): Statement[] {
  const statements: Statement[] = [];
  let cursor = 0;
  let i = 0;

  const push = (end: number) => {
    const at = skipTrivia(sql, cursor);
    if (at >= end) return;
    let word = at;
    while (word < sql.length && isIdentPart(sql[word])) word += 1;
    statements.push({ at, end, keyword: sql.slice(at, word).toLowerCase() });
  };

  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      const close = sql.indexOf("*/", i + 2);
      i = close === -1 ? sql.length : close + 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      i = skipQuoted(sql, i, ch);
      continue;
    }
    if (ch === "$") {
      const tag = dollarTag(sql, i);
      if (tag) {
        const close = sql.indexOf(tag, i + tag.length);
        i = close === -1 ? sql.length : close + tag.length;
        continue;
      }
    }
    if (ch === ";") {
      push(i + 1);
      i += 1;
      cursor = i;
      continue;
    }
    i += 1;
  }
  push(sql.length);
  return statements;
}

/**
 * Decides how to run a migration file.
 *
 * A file wrapped in a single BEGIN…COMMIT — how most migration folders are
 * written — has those removed and is run inside YTDB's own transaction instead,
 * so the ledger row still commits with it. Nothing is asked of the author.
 */
export function planTransaction(input: string): TransactionPlan {
  const sql = input;
  if (NO_TRANSACTION_DIRECTIVE.test(sql)) {
    return { mode: "unwrapped", sql, atomic: false };
  }

  const statements = scanStatements(sql);
  const control = statements.filter(
    (statement) =>
      OPENS.has(statement.keyword) ||
      CLOSES.has(statement.keyword) ||
      ROLLS_BACK.has(statement.keyword),
  );

  if (control.length === 0) {
    return { mode: "wrapped-by-ytdb", sql, atomic: true };
  }

  const first = statements[0];
  const last = statements[statements.length - 1];
  const simplyWrapped =
    control.length === 2 &&
    control[0] === first &&
    control[1] === last &&
    OPENS.has(first.keyword) &&
    CLOSES.has(last.keyword);

  if (simplyWrapped) {
    // Cut only the keywords through their semicolons, so surrounding comments survive.
    const body = sql.slice(0, first.at) + sql.slice(first.end, last.at) + sql.slice(last.end);
    return { mode: "self-wrapped", sql: body, atomic: true };
  }

  return { mode: "self-managed", sql, atomic: false };
}

/** What to tell the user about a mode, or null when there is nothing worth saying. */
export function transactionNote(mode: TransactionMode): string | null {
  switch (mode) {
    case "unwrapped":
      return "Marked `-- ytdb:no-transaction`, so it runs with no transaction. A failure partway leaves the statements before it applied.";
    case "self-managed":
      return "This file commits more than once, so YTDB runs it as written and records it afterwards. A failure partway can leave it half applied and unrecorded.";
    default:
      return null;
  }
}

/** A short badge for the row, for the modes worth flagging. */
export function transactionBadge(mode: TransactionMode): string | null {
  if (mode === "unwrapped") return "no transaction";
  if (mode === "self-managed") return "self-managed";
  return null;
}
