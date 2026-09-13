/**
 * What a migration does to the schema, read from its SQL alone — no database.
 *
 * Each statement is tokenized and parsed far enough to say which object it
 * touches and how: a table created with its columns, a column added or retyped,
 * a constraint, index, trigger or policy added to a table, a function defined.
 * Changes from several statements (or several files) fold into their net
 * effect, so a column added and then renamed shows once, under its final name,
 * and a table created and then dropped does not show at all. A statement that
 * cannot be read is listed as it is rather than dropped.
 */

export type SubjectKind =
  | "table"
  | "view"
  | "materialized-view"
  | "function"
  | "procedure"
  | "enum"
  | "type"
  | "domain"
  | "sequence"
  | "index"
  | "schema"
  | "extension";

/** `replaced` is CREATE OR REPLACE: the file cannot say whether it existed before. */
export type Effect = "created" | "replaced" | "altered" | "dropped";

export type PartKind =
  | "column"
  | "constraint"
  | "index"
  | "trigger"
  | "policy"
  | "value"
  | "rows"
  | "setting"
  | "comment"
  | "grant";

export type PartOp = "add" | "drop" | "change" | "rename";

export type Part = {
  kind: PartKind;
  op: PartOp;
  name: string;
  /** The old name, for a rename. */
  from?: string;
  /** What it is or what changed, one short line: `text · not null`, `unique (email)`. */
  detail?: string;
  /** Migrations this came from, in the order they touched it. */
  versions: string[];
};

export type Subject = {
  kind: SubjectKind;
  schema: string;
  name: string;
  effect: Effect;
  /** A function's arguments and return type, a view's source, a domain's base type. */
  detail?: string;
  /** Where it was before a rename or a move to another schema. */
  from?: { schema: string; name: string };
  parts: Part[];
  versions: string[];
};

export type OtherStatement = { text: string; versions: string[] };

export type SchemaChanges = {
  subjects: Subject[];
  /** Statements that change something this cannot describe, shown as written. */
  other: OtherStatement[];
};

/** A migration to summarize: its version, and the SQL it runs. */
export type ChangeSource = { version: string; sql: string };

export function describeChanges(sources: ChangeSource[]): SchemaChanges {
  const builder = new Builder();
  for (const source of sources) readFile(source.sql, source.version, builder);
  return builder.result();
}

/** The schema a name is shown under when it is the one most names are in anyway. */
export const DEFAULT_SCHEMA = "public";

export function qualifiedName(schema: string, name: string): string {
  return schema === DEFAULT_SCHEMA ? name : `${schema}.${name}`;
}

/* ---------------------------------------------------------------- tokens */

type TokenKind = "word" | "ident" | "string" | "number" | "punct";

type Token = {
  kind: TokenKind;
  /** Lowercased for a word, unescaped for a quoted identifier or string. */
  value: string;
  start: number;
  end: number;
};

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_\u0080-\uffff]/.test(ch);
}

function isIdentPart(ch: string): boolean {
  return /[A-Za-z0-9_$\u0080-\uffff]/.test(ch);
}

const OPERATOR_CHARS = "+-*/<>=~!@#%^&|`?";

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f") {
      i += 1;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      // Block comments nest in PostgreSQL.
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth += 1;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      continue;
    }
    const start = i;
    // E'…', U&'…', B'…', X'…' and N'…' are strings with a prefix.
    if (/[eEbBxXnN]/.test(ch) && sql[i + 1] === "'") {
      const end = skipString(sql, i + 1, /[eE]/.test(ch));
      tokens.push({ kind: "string", value: unescapeString(sql.slice(i + 2, end - 1)), start, end });
      i = end;
      continue;
    }
    if ((ch === "u" || ch === "U") && sql[i + 1] === "&" && (sql[i + 2] === "'" || sql[i + 2] === '"')) {
      const quote = sql[i + 2];
      const end = skipString(sql, i + 2, false, quote);
      const inner = sql.slice(i + 3, end - 1);
      tokens.push(
        quote === "'"
          ? { kind: "string", value: unescapeString(inner), start, end }
          : { kind: "ident", value: inner.replace(/""/g, '"'), start, end },
      );
      i = end;
      continue;
    }
    if (ch === "'") {
      const end = skipString(sql, i, false);
      tokens.push({ kind: "string", value: unescapeString(sql.slice(i + 1, end - 1)), start, end });
      i = end;
      continue;
    }
    if (ch === '"') {
      const end = skipString(sql, i, false, '"');
      tokens.push({ kind: "ident", value: sql.slice(i + 1, end - 1).replace(/""/g, '"'), start, end });
      i = end;
      continue;
    }
    if (ch === "$") {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        const end = close === -1 ? sql.length : close + tag[0].length;
        const body = sql.slice(i + tag[0].length, close === -1 ? sql.length : close);
        tokens.push({ kind: "string", value: body, start, end });
        i = end;
        continue;
      }
      // $1, a positional parameter.
      let j = i + 1;
      while (j < sql.length && /[0-9]/.test(sql[j])) j += 1;
      tokens.push({ kind: "punct", value: sql.slice(i, j), start, end: j });
      i = Math.max(j, i + 1);
      continue;
    }
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < sql.length && isIdentPart(sql[j])) j += 1;
      tokens.push({ kind: "word", value: sql.slice(i, j).toLowerCase(), start, end: j });
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(sql[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < sql.length && /[0-9.eE_]/.test(sql[j])) {
        if ((sql[j] === "e" || sql[j] === "E") && /[+-]/.test(sql[j + 1] ?? "")) j += 1;
        j += 1;
      }
      tokens.push({ kind: "number", value: sql.slice(i, j), start, end: j });
      i = j;
      continue;
    }
    if (ch === ":" && sql[i + 1] === ":") {
      tokens.push({ kind: "punct", value: "::", start, end: i + 2 });
      i += 2;
      continue;
    }
    if (OPERATOR_CHARS.includes(ch)) {
      let j = i + 1;
      while (j < sql.length && OPERATOR_CHARS.includes(sql[j])) {
        // A comment starting right after an operator ends it.
        if ((sql[j] === "-" && sql[j + 1] === "-") || (sql[j] === "/" && sql[j + 1] === "*")) break;
        j += 1;
      }
      tokens.push({ kind: "punct", value: sql.slice(i, j), start, end: j });
      i = j;
      continue;
    }
    tokens.push({ kind: "punct", value: ch, start, end: i + 1 });
    i += 1;
  }
  return tokens;
}

/** Index just past a quoted run starting at `index`, where the quote is doubled to escape it. */
function skipString(sql: string, index: number, backslashes: boolean, quote = "'"): number {
  let i = index + 1;
  while (i < sql.length) {
    if (backslashes && sql[i] === "\\") {
      i += 2;
      continue;
    }
    if (sql[i] === quote) {
      if (sql[i + 1] === quote) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  return sql.length;
}

function unescapeString(inner: string): string {
  return inner.replace(/''/g, "'");
}

/* ---------------------------------------------------------------- cursor */

/** Words that end a column's type and begin its constraints. */
const COLUMN_CLAUSE = new Set([
  "constraint",
  "not",
  "null",
  "default",
  "primary",
  "unique",
  "references",
  "check",
  "generated",
  "collate",
  "compression",
  "deferrable",
  "initially",
]);

/** Words after which an opening paren is spaced, when rendering an expression. */
const SPACED_BEFORE_PAREN = new Set([
  "and",
  "or",
  "not",
  "in",
  "as",
  "is",
  "exists",
  "any",
  "all",
  "some",
  "check",
  "using",
  "on",
  "select",
  "where",
  "when",
  "then",
  "else",
  "case",
  "from",
  "values",
  "with",
  "distinct",
]);

class Cursor {
  pos = 0;
  constructor(
    readonly tokens: Token[],
    readonly sql: string,
  ) {}

  get done(): boolean {
    return this.pos >= this.tokens.length;
  }

  peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  isWord(word: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token?.kind === "word" && token.value === word;
  }

  isPunct(value: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token?.kind === "punct" && token.value === value;
  }

  /** Consumes the words in order when all of them are next; otherwise consumes nothing. */
  accept(...words: string[]): boolean {
    for (const [index, word] of words.entries()) if (!this.isWord(word, index)) return false;
    this.pos += words.length;
    return true;
  }

  acceptPunct(value: string): boolean {
    if (!this.isPunct(value)) return false;
    this.pos += 1;
    return true;
  }

  /** One of these words, consumed and returned, or null. */
  acceptOne(words: readonly string[]): string | null {
    const token = this.peek();
    if (token?.kind === "word" && words.includes(token.value)) {
      this.pos += 1;
      return token.value;
    }
    return null;
  }

  /** An identifier, quoted or not. */
  name(): string | null {
    const token = this.peek();
    if (token?.kind === "word" || token?.kind === "ident") {
      this.pos += 1;
      return token.value;
    }
    return null;
  }

  /** `schema.name`, `name`, or `db.schema.name`, with the schema null when not written. */
  qualified(): { schema: string | null; name: string } | null {
    const parts: string[] = [];
    const first = this.name();
    if (first === null) return null;
    parts.push(first);
    while (this.isPunct(".") && (this.peek(1)?.kind === "word" || this.peek(1)?.kind === "ident")) {
      this.pos += 1;
      parts.push(this.name()!);
    }
    if (parts.length === 1) return { schema: null, name: parts[0] };
    return { schema: parts[parts.length - 2], name: parts[parts.length - 1] };
  }

  /** When at `(`, the tokens inside the matching `)`, consumed. */
  group(): Token[] | null {
    if (!this.isPunct("(")) return null;
    const start = this.pos;
    let depth = 0;
    for (let i = this.pos; i < this.tokens.length; i += 1) {
      const token = this.tokens[i];
      if (token.kind !== "punct") continue;
      if (token.value === "(" || token.value === "[") depth += 1;
      else if (token.value === ")" || token.value === "]") {
        depth -= 1;
        if (depth === 0) {
          this.pos = i + 1;
          return this.tokens.slice(start + 1, i);
        }
      }
    }
    this.pos = this.tokens.length;
    return this.tokens.slice(start + 1);
  }

  /** Tokens up to (not including) the first top-level token `stop` accepts, consumed. */
  until(stop: (token: Token, cursor: Cursor) => boolean): Token[] {
    const start = this.pos;
    let depth = 0;
    while (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos];
      if (depth === 0 && stop(token, this)) break;
      if (token.kind === "punct") {
        if (token.value === "(" || token.value === "[") depth += 1;
        else if (token.value === ")" || token.value === "]") depth -= 1;
      }
      this.pos += 1;
    }
    return this.tokens.slice(start, this.pos);
  }

  rest(): Token[] {
    const rest = this.tokens.slice(this.pos);
    this.pos = this.tokens.length;
    return rest;
  }

  sub(tokens: Token[]): Cursor {
    return new Cursor(tokens, this.sql);
  }
}

/** Splits tokens on the commas that are not inside parentheses. */
function splitTopLevel(tokens: Token[]): Token[][] {
  const pieces: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.kind === "punct") {
      if (token.value === "(" || token.value === "[") depth += 1;
      else if (token.value === ")" || token.value === "]") depth -= 1;
      else if (token.value === "," && depth === 0) {
        pieces.push(current);
        current = [];
        continue;
      }
    }
    current.push(token);
  }
  if (current.length > 0) pieces.push(current);
  return pieces;
}

const NO_SPACE_BEFORE = new Set([")", ",", ".", "::", "]", "[", ";"]);
const NO_SPACE_AFTER = new Set(["(", ".", "::", "["]);

/** Tokens back to SQL, keywords lowercased and spaced evenly: `numeric(10, 2)`, `now()`. */
function render(tokens: Token[], sql: string): string {
  let out = "";
  let previous: Token | null = null;
  for (const token of tokens) {
    const text =
      token.kind === "word"
        ? token.value
        : token.kind === "ident"
          ? quoteIdent(token.value)
          : sql.slice(token.start, token.end);
    if (previous) {
      const tight =
        (token.kind === "punct" && NO_SPACE_BEFORE.has(token.value)) ||
        (previous.kind === "punct" && NO_SPACE_AFTER.has(previous.value)) ||
        (token.kind === "punct" &&
          token.value === "(" &&
          (previous.kind === "ident" ||
            (previous.kind === "word" && !SPACED_BEFORE_PAREN.has(previous.value))));
      if (!tight) out += " ";
    }
    out += text.replace(/\s+/g, " ");
    previous = token;
  }
  return out;
}

/** An identifier as it has to be written: bare when that reads back the same, quoted otherwise. */
function quoteIdent(name: string): string {
  return /^[a-z_][a-z0-9_$]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
}

/** Column names of a parenthesized list like `(a, b)`, for a plain list of columns. */
function columnList(tokens: Token[], sql: string): string[] {
  return splitTopLevel(tokens).map((piece) =>
    piece.length === 1 && (piece[0].kind === "word" || piece[0].kind === "ident")
      ? piece[0].value
      : render(piece, sql),
  );
}

/* --------------------------------------------------------------- builder */

type Family = "relation" | "sequence" | "index" | "type" | "routine" | "schema" | "extension";

function familyOf(kind: SubjectKind): Family {
  switch (kind) {
    case "table":
    case "view":
    case "materialized-view":
      return "relation";
    case "function":
    case "procedure":
      return "routine";
    case "enum":
    case "type":
    case "domain":
      return "type";
    default:
      return kind;
  }
}

/** An aspect of a column that a later statement replaces rather than adds to. */
type ColumnAspect = "type" | "null" | "default" | "identity" | "generated" | "collate" | "other";

type Fact = { aspect: ColumnAspect | "pk" | "unique" | "ref" | "check"; text: string; constraint?: string };

type WorkingPart = Omit<Part, "detail" | "versions"> & {
  detail?: string;
  /** For a column: what is known about it, rendered into `detail`. */
  facts?: Fact[];
  versions: Set<string>;
};

type WorkingSubject = Omit<Subject, "parts" | "versions"> & {
  signature?: string;
  parts: WorkingPart[];
  versions: Set<string>;
};

function key(kind: SubjectKind, schema: string, name: string, signature?: string): string {
  const base = `${familyOf(kind)}:${schema}.${name}`;
  return signature === undefined ? base : `${base}(${signature})`;
}

/** One change to a column, applied to what is already known about it. */
type ColumnChange = { aspect: ColumnAspect; value: string | null; text: string };

class Builder {
  private subjects: WorkingSubject[] = [];
  private byKey = new Map<string, WorkingSubject>();
  private other: { text: string; versions: Set<string> }[] = [];

  private keyOf(subject: WorkingSubject): string {
    return key(subject.kind, subject.schema, subject.name, subject.signature);
  }

  find(kind: SubjectKind, schema: string, name: string, signature?: string, loose = false): WorkingSubject | undefined {
    const exact = this.byKey.get(key(kind, schema, name, signature));
    if (exact || familyOf(kind) !== "routine") return exact;
    // Another overload is a different function, unless the arguments were left unsaid.
    if (signature !== undefined && !loose) return undefined;
    // A routine named without its arguments, or with them written differently,
    // is the one routine of that name if there is only one.
    const matches = this.subjects.filter(
      (subject) => familyOf(subject.kind) === "routine" && subject.schema === schema && subject.name === name,
    );
    return matches.length === 1 ? matches[0] : undefined;
  }

  private add(subject: WorkingSubject): WorkingSubject {
    this.subjects.push(subject);
    this.byKey.set(this.keyOf(subject), subject);
    return subject;
  }

  private remove(subject: WorkingSubject): void {
    this.subjects = this.subjects.filter((item) => item !== subject);
    this.byKey.delete(this.keyOf(subject));
  }

  create(
    kind: SubjectKind,
    schema: string,
    name: string,
    version: string,
    options: { replace?: boolean; detail?: string; signature?: string } = {},
  ): WorkingSubject {
    const existing = this.find(kind, schema, name, options.signature);
    if (!existing) {
      return this.add({
        kind,
        schema,
        name,
        signature: options.signature,
        effect: options.replace ? "replaced" : "created",
        detail: options.detail,
        parts: [],
        versions: new Set([version]),
      });
    }
    existing.versions.add(version);
    existing.kind = kind;
    if (options.detail !== undefined) existing.detail = options.detail;
    if (existing.effect === "dropped") {
      // Dropped and made again: what it is now is only what this defines.
      existing.effect = "replaced";
      existing.parts = [];
    } else if (existing.effect === "altered") {
      existing.effect = "replaced";
    } else if (!options.replace) {
      existing.parts = [];
    }
    return existing;
  }

  drop(kind: SubjectKind, schema: string, name: string, version: string, signature?: string): void {
    const existing = this.find(kind, schema, name, signature);
    if (!existing) {
      this.add({
        kind,
        schema,
        name,
        signature,
        effect: "dropped",
        parts: [],
        versions: new Set([version]),
      });
      return;
    }
    if (existing.effect === "created") {
      // Made and removed within the migration: it leaves nothing behind.
      this.remove(existing);
      return;
    }
    existing.effect = "dropped";
    existing.parts = [];
    existing.detail = undefined;
    existing.versions.add(version);
  }

  /** The subject a change to an existing object is recorded on. */
  alter(kind: SubjectKind, schema: string, name: string, version: string, signature?: string): WorkingSubject {
    const existing = this.find(kind, schema, name, signature);
    if (existing) {
      existing.versions.add(version);
      if (existing.effect === "dropped") existing.effect = "altered";
      return existing;
    }
    return this.add({
      kind,
      schema,
      name,
      signature,
      effect: "altered",
      parts: [],
      versions: new Set([version]),
    });
  }

  /** Renames or moves an object; one made in this migration is simply made under the new name. */
  move(
    kind: SubjectKind,
    from: { schema: string; name: string },
    to: { schema: string; name: string },
    version: string,
    signature?: string,
  ): void {
    const existing = this.find(kind, from.schema, from.name, signature);
    const subject = existing ?? this.alter(kind, from.schema, from.name, version, signature);
    this.byKey.delete(this.keyOf(subject));
    if (subject.effect !== "created" && !subject.from) subject.from = { ...from };
    subject.schema = to.schema;
    subject.name = to.name;
    subject.versions.add(version);
    // Moved back to where it started: no longer worth saying.
    if (subject.from && subject.from.schema === to.schema && subject.from.name === to.name) {
      subject.from = undefined;
      if (subject.effect === "altered" && subject.parts.length === 0) {
        this.remove(subject);
        return;
      }
    }
    this.byKey.set(this.keyOf(subject), subject);
  }

  note(text: string, version: string): void {
    const existing = this.other.find((item) => item.text === text);
    if (existing) existing.versions.add(version);
    else this.other.push({ text, versions: new Set([version]) });
  }

  /** Finds a table-scoped part by name anywhere in a schema — an index dropped by name alone. */
  findPart(kind: PartKind, schema: string, name: string): { subject: WorkingSubject; part: WorkingPart } | null {
    for (const subject of this.subjects) {
      if (subject.schema !== schema) continue;
      const part = subject.parts.find((item) => item.kind === kind && item.name === name && item.op !== "drop");
      if (part) return { subject, part };
    }
    return null;
  }

  result(): SchemaChanges {
    const subjects: Subject[] = [];
    for (const subject of this.subjects) {
      // Only a later statement's own changes, all cancelled out, leaves an alteration with nothing in it.
      if (subject.effect === "altered" && subject.parts.length === 0 && !subject.from) continue;
      subjects.push({
        kind: subject.kind,
        schema: subject.schema,
        name: subject.name,
        effect: subject.effect,
        ...(subject.detail !== undefined ? { detail: subject.detail } : {}),
        ...(subject.from ? { from: subject.from } : {}),
        parts: subject.parts.map((part) => ({
          kind: part.kind,
          op: part.op,
          name: part.name,
          ...(part.from !== undefined ? { from: part.from } : {}),
          ...(partDetail(part) ? { detail: partDetail(part) } : {}),
          versions: [...part.versions],
        })),
        versions: [...subject.versions],
      });
    }
    return {
      subjects,
      other: this.other.map((item) => ({ text: item.text, versions: [...item.versions] })),
    };
  }
}

function partDetail(part: WorkingPart): string | undefined {
  if (part.facts) {
    const text = part.facts.map((fact) => fact.text).join(" · ");
    return text || undefined;
  }
  return part.detail;
}

/** Things that can be looked up by name on their table: all but data, grants, settings. */
const NAMED: ReadonlySet<PartKind> = new Set(["column", "constraint", "index", "trigger", "policy", "value"]);

/**
 * Adds a change to a subject, folding it into what is already there: a drop
 * cancels an add, a rename renames the add, a change to something added in the
 * same migration becomes part of how it was added.
 */
function addPart(subject: WorkingSubject, incoming: Omit<WorkingPart, "versions">, version: string): void {
  const { kind } = incoming;
  const parts = subject.parts;
  const same = (part: WorkingPart, name: string) => part.kind === kind && part.name === name;

  if (!NAMED.has(kind)) {
    if (kind === "rows") {
      const existing = parts.find((part) => part.kind === "rows" && part.name === incoming.name);
      if (existing) {
        existing.versions.add(version);
        const count = Number(existing.detail?.replace(/\D/g, "") || "1") + 1;
        existing.detail = `×${count}`;
        return;
      }
    }
    if (kind === "setting" || kind === "comment") {
      const existing = parts.find((part) => part.kind === kind && part.name === incoming.name);
      if (existing) {
        existing.detail = incoming.detail;
        existing.op = incoming.op;
        existing.versions.add(version);
        return;
      }
    }
    if (kind === "grant") {
      const existing = parts.find(
        (part) => part.kind === "grant" && part.name === incoming.name && part.detail === incoming.detail,
      );
      if (existing) {
        existing.op = incoming.op;
        existing.versions.add(version);
        return;
      }
    }
    parts.push({ ...incoming, versions: new Set([version]) });
    return;
  }

  switch (incoming.op) {
    case "add": {
      const index = parts.findIndex((part) => same(part, incoming.name));
      if (index !== -1) {
        const existing = parts[index];
        // Dropped then added again: the same name, redefined.
        const op: PartOp = existing.op === "drop" || existing.op === "change" ? "change" : "add";
        parts[index] = { ...incoming, op, versions: new Set([...existing.versions, version]) };
        return;
      }
      parts.push({ ...incoming, versions: new Set([version]) });
      return;
    }
    case "drop": {
      const index = parts.findIndex((part) => same(part, incoming.name));
      if (index !== -1) {
        const existing = parts[index];
        if (existing.op === "add") {
          parts.splice(index, 1);
          return;
        }
        const from = existing.op === "rename" ? existing.from : undefined;
        parts[index] = {
          kind,
          op: "drop",
          name: from ?? incoming.name,
          versions: new Set([...existing.versions, version]),
        };
        return;
      }
      // A constraint written into a column's definition goes with a drop of that constraint.
      if (kind === "constraint") {
        for (const part of parts) {
          const fact = part.facts?.find((item) => item.constraint === incoming.name);
          if (fact && part.op === "add") {
            part.facts = part.facts!.filter((item) => item !== fact);
            part.versions.add(version);
            return;
          }
        }
      }
      if (kind === "column") {
        // Changes to a column that is then dropped no longer matter.
        subject.parts = parts.filter((part) => !(part.kind === "column" && part.name === incoming.name));
      }
      subject.parts.push({ ...incoming, versions: new Set([version]) });
      return;
    }
    case "rename": {
      const from = incoming.from!;
      const existing = parts.find((part) => same(part, from) && part.op !== "drop");
      if (existing) {
        existing.versions.add(version);
        if (existing.op === "rename") {
          if (existing.from === incoming.name) {
            subject.parts = parts.filter((part) => part !== existing);
            return;
          }
          existing.name = incoming.name;
          return;
        }
        if (existing.op === "change") {
          // Changed, then renamed: shown as a rename carrying the change.
          existing.op = "rename";
          existing.from = from;
        }
        existing.name = incoming.name;
        return;
      }
      parts.push({ ...incoming, versions: new Set([version]) });
      return;
    }
    case "change": {
      const existing = parts.find((part) => same(part, incoming.name) && part.op !== "drop");
      if (!existing) {
        parts.push({ ...incoming, versions: new Set([version]) });
        return;
      }
      existing.versions.add(version);
      if (incoming.facts) {
        for (const fact of incoming.facts) mergeFact(existing, fact, existing.op === "add");
        return;
      }
      if (existing.op === "add") {
        existing.detail = [existing.detail, incoming.detail].filter(Boolean).join(" · ");
      } else {
        existing.detail = incoming.detail;
      }
      return;
    }
  }
}

/** Folds a change into a column: into its definition when it was added here, into its changes otherwise. */
function mergeFact(part: WorkingPart, fact: Fact, intoDefinition: boolean): void {
  const facts = part.facts ?? [];
  if (fact.aspect === "other") {
    facts.push(fact);
    part.facts = facts;
    return;
  }
  const index = facts.findIndex((item) => item.aspect === fact.aspect);
  const dropping = fact.text.startsWith("drop ");
  if (intoDefinition) {
    // `set not null` on a column added here makes it `not null`; `drop default` removes the default.
    const text = dropping ? "" : fact.text.replace(/^set (not null)$/, "$1").replace(/^type /, "");
    if (index !== -1) {
      if (text) facts[index] = { ...fact, text };
      else facts.splice(index, 1);
    } else if (text) {
      facts.splice(fact.aspect === "type" ? 0 : facts.length, 0, { ...fact, text });
    }
  } else if (index !== -1) {
    facts[index] = fact;
  } else {
    facts.push(fact);
  }
  part.facts = facts;
}

/* ------------------------------------------------------------ statements */

type Context = {
  builder: Builder;
  version: string;
  /** Where an unqualified name goes: the first schema on the search path. */
  schema: string;
  sql: string;
};

function readFile(input: string, version: string, builder: Builder): void {
  // psql meta-commands (`\connect`, `\set`) have no semicolon and are not SQL.
  const sql = input.replace(/^[ \t]*\\[^\n]*$/gm, "");
  const context: Context = { builder, version, schema: DEFAULT_SCHEMA, sql };
  for (const tokens of splitStatements(tokenize(sql))) readStatement(tokens, context, false);
}

/**
 * Statements, split on the semicolons the tokenizer left standing — the ones
 * inside strings, dollar-quoted bodies, and (nested) comments are already gone.
 */
function splitStatements(tokens: Token[]): Token[][] {
  const statements: Token[][] = [];
  let current: Token[] = [];
  for (const token of tokens) {
    if (token.kind === "punct" && token.value === ";") {
      if (current.length > 0) statements.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  if (current.length > 0) statements.push(current);
  return statements;
}

/**
 * Reads one statement, whose tokens index into `outer.sql`; false when it was
 * not understood (and, outside a DO block, noted as other).
 */
function readStatement(tokens: Token[], outer: Context, quiet: boolean): boolean {
  if (tokens.length === 0) return true;
  const cursor = new Cursor(tokens, outer.sql);
  let understood: boolean;
  try {
    understood = statement(cursor, { ...outer }, outer);
  } catch {
    understood = false;
  }
  if (!understood && !quiet) outer.builder.note(summarize(tokens, outer.sql), outer.version);
  return understood;
}

/** A statement too unusual to describe, cut to its first line or so. */
function summarize(tokens: Token[], sql: string): string {
  const text = render(tokens.slice(0, 24), sql);
  return tokens.length > 24 || text.length > 96 ? `${text.slice(0, 96).trimEnd()}…` : text;
}

/** Statements that change nothing lasting about the schema. */
const INERT = new Set([
  "begin",
  "start",
  "commit",
  "end",
  "rollback",
  "abort",
  "savepoint",
  "release",
  "lock",
  "analyze",
  "analyse",
  "vacuum",
  "notify",
  "listen",
  "unlisten",
  "discard",
  "checkpoint",
  "reset",
  "prepare",
  "deallocate",
  "explain",
]);

function statement(c: Cursor, context: Context, outer: Context): boolean {
  const first = c.peek();
  if (first?.kind !== "word") return false;
  const verb = first.value;
  if (INERT.has(verb)) return true;
  switch (verb) {
    case "set":
      return readSet(c, context, outer);
    case "create":
      return readCreate(c, context);
    case "alter":
      return readAlter(c, context);
    case "drop":
      return readDrop(c, context);
    case "comment":
      return readComment(c, context);
    case "grant":
    case "revoke":
      return readGrant(c, context);
    case "do":
      return readDo(c, context);
    case "with":
    case "insert":
    case "update":
    case "delete":
    case "merge":
    case "truncate":
    case "copy":
    case "select":
      return readData(c, context);
    case "refresh":
      return readRefresh(c, context);
    default:
      return false;
  }
}

function resolve(context: Context, name: { schema: string | null; name: string }): { schema: string; name: string } {
  return { schema: name.schema ?? context.schema, name: name.name };
}

/** `SET search_path TO app, public` changes where every unqualified name after it goes. */
function readSet(c: Cursor, context: Context, outer: Context): boolean {
  c.accept("set");
  c.acceptOne(["session", "local"]);
  if (!c.accept("search_path")) return true;
  if (!c.acceptPunct("=")) c.accept("to");
  for (const piece of splitTopLevel(c.rest())) {
    const token = piece[0];
    if (!token) continue;
    const value = token.kind === "string" ? token.value.trim() : token.value;
    if (!value || value === "$user" || value === "default") continue;
    outer.schema = value.replace(/^"(.*)"$/, "$1");
    context.schema = outer.schema;
    break;
  }
  return true;
}

/* ---------------------------------------------------------------- create */

function readCreate(c: Cursor, context: Context): boolean {
  c.accept("create");
  const replace = c.accept("or", "replace");
  let temporary = false;
  let unique = false;
  let materialized = false;
  let constraint = false;
  for (;;) {
    const flag = c.acceptOne([
      "temp",
      "temporary",
      "unlogged",
      "global",
      "local",
      "unique",
      "materialized",
      "recursive",
      "constraint",
      "trusted",
      "procedural",
      "foreign",
    ]);
    if (!flag) break;
    if (flag === "temp" || flag === "temporary") temporary = true;
    if (flag === "unique") unique = true;
    if (flag === "materialized") materialized = true;
    if (flag === "constraint") constraint = true;
  }
  const what = c.acceptOne([
    "table",
    "view",
    "index",
    "type",
    "domain",
    "function",
    "procedure",
    "trigger",
    "policy",
    "schema",
    "extension",
    "sequence",
  ]);
  switch (what) {
    case "table":
      return createTable(c, context, temporary);
    case "view":
      return createView(c, context, materialized, replace, temporary);
    case "index":
      return createIndex(c, context, unique);
    case "type":
      return createType(c, context);
    case "domain":
      return createDomain(c, context);
    case "function":
    case "procedure":
      return createRoutine(c, context, what, replace);
    case "trigger":
      return createTrigger(c, context, constraint);
    case "policy":
      return createPolicy(c, context);
    case "schema":
      return createSchema(c, context);
    case "extension":
      return createExtension(c, context);
    case "sequence":
      return createSequence(c, context, temporary);
    default:
      return false;
  }
}

function createTable(c: Cursor, context: Context, temporary: boolean): boolean {
  c.accept("if", "not", "exists");
  const raw = c.qualified();
  if (!raw) return false;
  // A temporary table is gone when the session ends.
  if (temporary || raw.schema === "pg_temp") return true;
  const { schema, name } = resolve(context, raw);
  const details: string[] = [];
  let elements: Token[] | null = null;

  if (c.accept("partition", "of")) {
    const parent = c.qualified();
    if (parent) details.push(`partition of ${qualifiedName(resolve(context, parent).schema, parent.name)}`);
    elements = c.group();
    const bound = c.until((token) => token.kind === "word" && token.value === "partition");
    if (bound.length > 0) details.push(render(bound, context.sql));
  } else if (c.accept("of")) {
    const type = c.qualified();
    if (type) details.push(`of type ${type.name}`);
    elements = c.group();
  } else {
    elements = c.group();
  }

  const tail = c.rest();
  const tailCursor = c.sub(tail);
  while (!tailCursor.done) {
    if (tailCursor.accept("inherits")) {
      const parents = tailCursor.group();
      if (parents) details.push(`inherits ${columnList(parents, context.sql).join(", ")}`);
    } else if (tailCursor.accept("partition", "by")) {
      const method = tailCursor.name();
      const columns = tailCursor.group();
      details.push(`partitioned by ${method ?? ""} (${columns ? columnList(columns, context.sql).join(", ") : ""})`);
    } else if (tailCursor.accept("as")) {
      details.push("from a query");
      break;
    } else {
      tailCursor.pos += 1;
    }
  }

  const subject = context.builder.create("table", schema, name, context.version, {
    detail: details.length > 0 ? details.join(" · ") : undefined,
  });

  if (!elements) return true;
  for (const piece of splitTopLevel(elements)) {
    const cursor = c.sub(piece);
    if (cursor.isWord("like")) {
      cursor.pos += 1;
      const source = cursor.qualified();
      if (source) {
        addPart(subject, { kind: "setting", op: "add", name: "columns like", detail: source.name }, context.version);
      }
      continue;
    }
    if (isTableConstraintStart(piece[0])) {
      const read = tableConstraint(cursor, context, name);
      if (read) addConstraint(subject, read, context.version);
      continue;
    }
    const column = columnDefinition(cursor, context, name);
    if (column) addPart(subject, { kind: "column", op: "add", name: column.name, facts: column.facts }, context.version);
  }
  return true;
}

function isTableConstraintStart(token: Token | undefined): boolean {
  return (
    token?.kind === "word" &&
    ["constraint", "primary", "unique", "foreign", "check", "exclude"].includes(token.value)
  );
}

/** A column written into CREATE TABLE or ADD COLUMN: its name, type, and inline constraints. */
function columnDefinition(c: Cursor, context: Context, table: string): { name: string; facts: Fact[] } | null {
  const name = c.name();
  if (name === null) return null;
  const typeTokens = c.until((token) => token.kind === "word" && COLUMN_CLAUSE.has(token.value));
  const facts: Fact[] = [];
  if (typeTokens.length > 0) facts.push({ aspect: "type", text: render(typeTokens, context.sql) });
  const stopAtClause = (token: Token) => token.kind === "word" && COLUMN_CLAUSE.has(token.value);
  let constraintName: string | undefined;
  while (!c.done) {
    if (c.accept("constraint")) {
      constraintName = c.name() ?? undefined;
      continue;
    }
    if (c.accept("not", "null")) {
      facts.push({ aspect: "null", text: "not null" });
    } else if (c.accept("null")) {
      // Nullable is the default; saying so changes nothing.
    } else if (c.accept("default")) {
      // `default null` would otherwise stop at its own `null`.
      const expression = c.isWord("null") ? [c.peek()!] : [];
      if (expression.length > 0) c.pos += 1;
      expression.push(...c.until(stopAtClause));
      facts.push({ aspect: "default", text: `default ${render(expression, context.sql)}` });
    } else if (c.accept("primary", "key")) {
      c.until(stopAtClause);
      facts.push({ aspect: "pk", text: "primary key", constraint: constraintName ?? `${table}_pkey` });
    } else if (c.accept("unique")) {
      c.until(stopAtClause);
      facts.push({ aspect: "unique", text: "unique", constraint: constraintName ?? `${table}_${name}_key` });
    } else if (c.accept("references")) {
      const target = c.qualified();
      const columns = c.group();
      const actions = referentialActions(c.until(stopAfterReference), context.sql);
      if (target) {
        const to = `${qualifiedName(resolve(context, target).schema, target.name)}${
          columns ? `.${columnList(columns, context.sql).join(", ")}` : ""
        }`;
        facts.push({
          aspect: "ref",
          text: `→ ${to}${actions ? ` ${actions}` : ""}`,
          constraint: constraintName ?? `${table}_${name}_fkey`,
        });
      }
    } else if (c.accept("check")) {
      const expression = c.group();
      c.until(stopAtClause);
      facts.push({
        aspect: "check",
        text: `check (${expression ? render(expression, context.sql) : ""})`,
        constraint: constraintName ?? `${table}_${name}_check`,
      });
    } else if (c.accept("generated")) {
      const rest = c.until(stopAtClause);
      const cursor = c.sub(rest);
      if (rest.some((token) => token.kind === "word" && token.value === "identity")) {
        facts.push({ aspect: "identity", text: "identity" });
      } else {
        cursor.acceptOne(["always", "by"]);
        cursor.accept("default");
        cursor.accept("as");
        const expression = cursor.group();
        facts.push({
          aspect: "generated",
          text: `generated (${expression ? render(expression, context.sql) : ""})`,
        });
      }
    } else if (c.accept("collate")) {
      const collation = c.qualified();
      if (collation) facts.push({ aspect: "collate", text: `collate ${collation.name}` });
    } else {
      // deferrable, initially deferred, compression: nothing worth a line.
      c.pos += 1;
      c.until(stopAtClause);
    }
    constraintName = undefined;
  }
  return { name, facts };
}

/** The end of a REFERENCES clause: the next constraint, but not the `null` of `on delete set null`. */
function stopAfterReference(token: Token, cursor: Cursor): boolean {
  if (token.kind !== "word" || !COLUMN_CLAUSE.has(token.value)) return false;
  const previous = cursor.tokens[cursor.pos - 1];
  return !(previous?.kind === "word" && previous.value === "set" && (token.value === "null" || token.value === "default"));
}

/** `on delete cascade`, from what follows a REFERENCES target; empty when nothing notable. */
function referentialActions(tokens: Token[], sql: string): string {
  const cursor = new Cursor(tokens, sql);
  const out: string[] = [];
  while (!cursor.done) {
    if (cursor.accept("on", "delete") || cursor.accept("on", "update")) {
      const event = cursor.tokens[cursor.pos - 1].value;
      const action = cursor.until((token) => token.kind === "word" && (token.value === "on" || token.value === "deferrable" || token.value === "match" || token.value === "not" || token.value === "initially"));
      out.push(`on ${event} ${render(action, sql)}`);
    } else {
      cursor.pos += 1;
    }
  }
  return out.join(" ");
}

/**
 * A table-level constraint — PRIMARY KEY (…), FOREIGN KEY (…) REFERENCES …,
 * CHECK (…), UNIQUE (…), EXCLUDE — named as PostgreSQL would name it when the
 * SQL does not, so a later DROP CONSTRAINT by that name still finds it.
 */
function tableConstraint(c: Cursor, context: Context, table: string): ReadConstraint | null {
  const read = readTableConstraint(c, context, table);
  return read ? { ...read, named: c.tokens[0]?.value === "constraint" } : null;
}

type ReadConstraint = { name: string; detail: string; named: boolean };

/**
 * Adds a constraint read from SQL. One PostgreSQL named itself is numbered
 * when the name is taken, as it does: `orders_check`, then `orders_check1`.
 */
function addConstraint(subject: WorkingSubject, read: ReadConstraint, version: string): void {
  let name = read.name;
  if (!read.named) {
    const taken = (candidate: string) =>
      subject.parts.some((part) => part.kind === "constraint" && part.name === candidate && part.op !== "drop");
    for (let n = 1; taken(name); n += 1) name = `${read.name}${n}`;
  }
  addPart(subject, { kind: "constraint", op: "add", name, detail: read.detail }, version);
}

function readTableConstraint(c: Cursor, context: Context, table: string): { name: string; detail: string } | null {
  let name: string | null = null;
  if (c.accept("constraint")) name = c.name();
  const sql = context.sql;
  if (c.accept("primary", "key")) {
    const list = c.group();
    const cols = list ? columnList(list, sql) : [];
    return { name: name ?? `${table}_pkey`, detail: `primary key (${cols.join(", ")})${trailing(c, sql)}` };
  }
  if (c.accept("unique")) {
    if (c.accept("nulls")) {
      c.accept("not");
      c.accept("distinct");
    }
    if (c.accept("using", "index")) {
      const index = c.name();
      return { name: name ?? index ?? `${table}_key`, detail: `unique using index ${index ?? ""}` };
    }
    const list = c.group();
    const cols = list ? columnList(list, sql) : [];
    return { name: name ?? `${table}_${cols.join("_")}_key`, detail: `unique (${cols.join(", ")})${trailing(c, sql)}` };
  }
  if (c.accept("foreign", "key")) {
    const list = c.group();
    const cols = list ? columnList(list, sql) : [];
    c.accept("references");
    const target = c.qualified();
    const targetColumns = c.group();
    const rest = c.rest();
    const actions = referentialActions(rest, sql);
    const to = target
      ? `${qualifiedName(resolve(context, target).schema, target.name)}${
          targetColumns ? `(${columnList(targetColumns, sql).join(", ")})` : ""
        }`
      : "";
    const notValid = hasNotValid(rest) ? " · not valid" : "";
    return {
      name: name ?? `${table}_${cols.join("_")}_fkey`,
      detail: `(${cols.join(", ")}) → ${to}${actions ? ` ${actions}` : ""}${notValid}`,
    };
  }
  if (c.accept("check")) {
    const expression = c.group() ?? [];
    const rest = c.rest();
    const notValid = hasNotValid(rest) ? " · not valid" : "";
    // Written apart from any column, a check is named after the table alone.
    return {
      name: name ?? `${table}_check`,
      detail: `check (${render(expression, sql)})${notValid}`,
    };
  }
  if (c.accept("exclude")) {
    return { name: name ?? `${table}_excl`, detail: `exclude ${render(c.rest(), sql)}` };
  }
  return null;
}

function hasNotValid(tokens: Token[]): boolean {
  return tokens.some(
    (token, index) => token.kind === "word" && token.value === "not" && tokens[index + 1]?.value === "valid",
  );
}

/** What follows a key's column list that is worth keeping: `include (…)`, `not valid`. */
function trailing(c: Cursor, sql: string): string {
  const rest = c.rest();
  const cursor = new Cursor(rest, sql);
  const out: string[] = [];
  while (!cursor.done) {
    if (cursor.accept("include")) {
      const list = cursor.group();
      if (list) out.push(`include (${columnList(list, sql).join(", ")})`);
    } else if (cursor.accept("not", "valid")) {
      out.push("not valid");
    } else {
      cursor.pos += 1;
    }
  }
  return out.length > 0 ? ` · ${out.join(" · ")}` : "";
}

function createView(
  c: Cursor,
  context: Context,
  materialized: boolean,
  replace: boolean,
  temporary: boolean,
): boolean {
  c.accept("if", "not", "exists");
  const raw = c.qualified();
  if (!raw) return false;
  if (temporary) return true;
  const { schema, name } = resolve(context, raw);
  c.group();
  // The tables a view reads from are what it is about; the rest is its query.
  const body = c.rest();
  const sources = new Set<string>();
  const ctes = new Set<string>();
  let depth = 0;
  for (let i = 0; i < body.length - 1; i += 1) {
    const token = body[i];
    if (token.kind === "punct" && token.value === "(") depth += 1;
    if (token.kind === "punct" && token.value === ")") depth -= 1;
    // `name AS (` at the top of the query is a CTE, not a table.
    if (depth === 0 && (token.kind === "word" || token.kind === "ident") && body[i + 1]?.value === "as" && body[i + 2]?.value === "(") {
      ctes.add(token.value);
    }
    if (depth !== 0 || token.kind !== "word" || (token.value !== "from" && token.value !== "join")) continue;
    const next = body[i + 1];
    if (next.kind !== "word" && next.kind !== "ident") continue;
    const cursor = new Cursor(body.slice(i + 1), context.sql);
    const source = cursor.qualified();
    // `FROM (SELECT …)` and `extract(x FROM y)` start with something else, or nothing.
    if (source && !ctes.has(source.name) && !["select", "lateral", "unnest", "only"].includes(source.name)) {
      sources.add(qualifiedName(resolve(context, source).schema, source.name));
    }
  }
  context.builder.create(materialized ? "materialized-view" : "view", schema, name, context.version, {
    replace,
    detail: sources.size > 0 ? `from ${[...sources].join(", ")}` : undefined,
  });
  return true;
}

function createIndex(c: Cursor, context: Context, unique: boolean): boolean {
  c.accept("concurrently");
  c.accept("if", "not", "exists");
  let name: string | null = null;
  if (!c.isWord("on")) name = c.name();
  if (!c.accept("on")) return false;
  c.accept("only");
  const raw = c.qualified();
  if (!raw) return false;
  const table = resolve(context, raw);
  let method: string | null = null;
  if (c.accept("using")) method = c.name();
  const list = c.group() ?? [];
  const columns = columnList(list, context.sql);
  const rest = c.rest();
  const tail = new Cursor(rest, context.sql);
  const extras: string[] = [];
  while (!tail.done) {
    if (tail.accept("include")) {
      const included = tail.group();
      if (included) extras.push(`include (${columnList(included, context.sql).join(", ")})`);
    } else if (tail.accept("where")) {
      extras.push(`where ${render(tail.rest(), context.sql)}`);
    } else {
      tail.pos += 1;
    }
  }
  // PostgreSQL's own name for an unnamed index: the table, each column (or the
  // function an expression calls), and `idx`.
  const indexName = name ?? `${table.name}_${splitTopLevel(list).map(indexColumnName).join("_")}_idx`;
  const detail = [
    `${unique ? "unique " : ""}(${columns.join(", ")})`,
    method && method !== "btree" ? `using ${method}` : "",
    ...extras,
  ]
    .filter(Boolean)
    .join(" · ");
  const subject = context.builder.alter("table", table.schema, table.name, context.version);
  addPart(subject, { kind: "index", op: "add", name: indexName, detail }, context.version);
  return true;
}

function indexColumnName(piece: Token[]): string {
  const [first, second] = piece;
  if (first?.kind === "punct" && first.value === "(") {
    const inner = piece[1];
    return inner?.kind === "word" && piece[2]?.kind === "punct" && piece[2].value === "(" ? inner.value : "expr";
  }
  if (first?.kind !== "word" && first?.kind !== "ident") return "expr";
  if (second?.kind === "punct" && second.value === "(") return first.value;
  if (second?.kind === "punct") return "expr";
  return first.value;
}

function createType(c: Cursor, context: Context): boolean {
  const raw = c.qualified();
  if (!raw) return false;
  const { schema, name } = resolve(context, raw);
  if (!c.accept("as")) {
    // A shell type, filled in by a later CREATE TYPE with the same name.
    context.builder.create("type", schema, name, context.version);
    return true;
  }
  if (c.accept("enum")) {
    const values = c.group() ?? [];
    const subject = context.builder.create("enum", schema, name, context.version);
    for (const token of values) {
      if (token.kind === "string") {
        addPart(subject, { kind: "value", op: "add", name: token.value }, context.version);
      }
    }
    return true;
  }
  if (c.accept("range")) {
    const options = c.group() ?? [];
    const subtype = options.findIndex((token) => token.kind === "word" && token.value === "subtype");
    const base = subtype !== -1 ? options[subtype + 2]?.value : undefined;
    context.builder.create("type", schema, name, context.version, {
      detail: base ? `range of ${base}` : "range",
    });
    return true;
  }
  const attributes = c.group();
  const subject = context.builder.create("type", schema, name, context.version, { detail: "composite" });
  for (const piece of attributes ? splitTopLevel(attributes) : []) {
    const column = columnDefinition(c.sub(piece), context, name);
    if (column) addPart(subject, { kind: "column", op: "add", name: column.name, facts: column.facts }, context.version);
  }
  return true;
}

function createDomain(c: Cursor, context: Context): boolean {
  c.accept("if", "not", "exists");
  const raw = c.qualified();
  if (!raw) return false;
  const { schema, name } = resolve(context, raw);
  c.accept("as");
  const column = columnDefinition(
    c.sub([{ kind: "word", value: name, start: 0, end: 0 }, ...c.rest()]),
    context,
    name,
  );
  context.builder.create("domain", schema, name, context.version, {
    detail: column?.facts.map((fact) => fact.text).join(" · ") || undefined,
  });
  return true;
}

/** Words that begin an argument's type rather than naming the argument. */
const TYPE_PREFIX = new Set([
  "double",
  "character",
  "char",
  "bit",
  "timestamp",
  "time",
  "interval",
  "national",
  "setof",
]);

/**
 * The argument types of a routine, which with its name are what identify it:
 * `(p_id uuid, p_qty int default 1)` → `uuid, int`.
 */
function argumentTypes(tokens: Token[], sql: string): string {
  const types: string[] = [];
  for (const piece of splitTopLevel(tokens)) {
    const cursor = new Cursor(piece, sql);
    const mode = cursor.acceptOne(["in", "out", "inout", "variadic"]);
    // OUT arguments are not part of a function's identity.
    if (mode === "out") continue;
    const rest = cursor.until(
      (token) => (token.kind === "word" && token.value === "default") || (token.kind === "punct" && token.value === "="),
    );
    let typeTokens = rest;
    const firstIsName =
      rest.length > 1 &&
      (rest[0].kind === "ident" || (rest[0].kind === "word" && !TYPE_PREFIX.has(rest[0].value))) &&
      !(rest[1].kind === "punct" && (rest[1].value === "(" || rest[1].value === "." || rest[1].value === "["));
    if (firstIsName) typeTokens = rest.slice(1);
    types.push(normalizeType(render(typeTokens, sql)));
  }
  return types.join(", ");
}

/** The name PostgreSQL itself uses for a type written in any of its spellings. */
function normalizeType(type: string): string {
  const aliases: Record<string, string> = {
    int: "integer",
    int4: "integer",
    int8: "bigint",
    int2: "smallint",
    bool: "boolean",
    float8: "double precision",
    float4: "real",
    varchar: "character varying",
    timestamptz: "timestamp with time zone",
    timetz: "time with time zone",
    decimal: "numeric",
  };
  return type.replace(/^[a-z0-9_]+/, (word) => aliases[word] ?? word);
}

function createRoutine(c: Cursor, context: Context, kind: "function" | "procedure", replace: boolean): boolean {
  const raw = c.qualified();
  if (!raw) return false;
  const { schema, name } = resolve(context, raw);
  const args = c.group() ?? [];
  let returns: string | null = null;
  if (c.accept("returns")) {
    if (c.accept("table")) {
      const columns = c.group();
      returns = `table(${columns ? splitTopLevel(columns).map((piece) => render(piece, context.sql)).join(", ") : ""})`;
    } else {
      const tokens = c.until(
        (token) =>
          token.kind === "word" &&
          ["language", "as", "immutable", "stable", "volatile", "security", "strict", "called", "cost", "rows", "set", "parallel", "leakproof", "not", "begin", "return", "window", "support", "transform", "external"].includes(token.value),
      );
      returns = render(tokens, context.sql);
    }
  }
  const argText = splitTopLevel(args)
    .map((piece) => render(piece, context.sql))
    .join(", ");
  context.builder.create(kind, schema, name, context.version, {
    replace,
    signature: argumentTypes(args, context.sql),
    detail: `(${argText})${returns ? ` → ${returns}` : ""}`,
  });
  return true;
}

function createTrigger(c: Cursor, context: Context, constraint: boolean): boolean {
  const name = c.name();
  if (name === null) return false;
  const timing = c.accept("instead", "of") ? "instead of" : c.acceptOne(["before", "after"]);
  const events: string[] = [];
  for (;;) {
    const event = c.acceptOne(["insert", "update", "delete", "truncate"]);
    if (!event) break;
    if (event === "update" && c.accept("of")) {
      const columns: string[] = [];
      do {
        const column = c.name();
        if (column) columns.push(column);
      } while (c.acceptPunct(","));
      events.push(`update of ${columns.join(", ")}`);
    } else {
      events.push(event);
    }
    if (!c.accept("or")) break;
  }
  if (!c.accept("on")) return false;
  const raw = c.qualified();
  if (!raw) return false;
  const table = resolve(context, raw);
  const rest = c.rest();
  const tail = new Cursor(rest, context.sql);
  let perRow = false;
  let target: string | null = null;
  while (!tail.done) {
    if (tail.accept("for", "each", "row") || tail.accept("for", "row")) perRow = true;
    else if (tail.accept("execute", "function") || tail.accept("execute", "procedure")) {
      const fn = tail.qualified();
      if (fn) target = `${qualifiedName(resolve(context, fn).schema, fn.name)}()`;
    } else tail.pos += 1;
  }
  const detail = [
    [timing, events.join(" or ")].filter(Boolean).join(" "),
    perRow ? "each row" : "",
    constraint ? "constraint" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const subject = context.builder.alter("table", table.schema, table.name, context.version);
  addPart(
    subject,
    { kind: "trigger", op: "add", name, detail: target ? `${detail} → ${target}` : detail },
    context.version,
  );
  return true;
}

function createPolicy(c: Cursor, context: Context): boolean {
  const name = c.name();
  if (name === null || !c.accept("on")) return false;
  const raw = c.qualified();
  if (!raw) return false;
  const table = resolve(context, raw);
  const subject = context.builder.alter("table", table.schema, table.name, context.version);
  addPart(subject, { kind: "policy", op: "add", name, detail: policyDetail(c, context.sql) }, context.version);
  return true;
}

/** `for select · to authenticated · using (…)`, leaving out what is the default. */
function policyDetail(c: Cursor, sql: string): string {
  const out: string[] = [];
  while (!c.done) {
    if (c.accept("as")) {
      const kind = c.name();
      if (kind === "restrictive") out.push("restrictive");
    } else if (c.accept("for")) {
      const command = c.name();
      if (command && command !== "all") out.push(`for ${command}`);
    } else if (c.accept("to")) {
      const roles = c.until((token) => token.kind === "word" && ["using", "with"].includes(token.value));
      const text = render(roles, sql);
      if (text !== "public") out.push(`to ${text}`);
    } else if (c.accept("using")) {
      const expression = c.group();
      out.push(`using (${expression ? render(expression, sql) : ""})`);
    } else if (c.accept("with", "check")) {
      const expression = c.group();
      out.push(`check (${expression ? render(expression, sql) : ""})`);
    } else if (c.accept("rename", "to")) {
      out.push(`renamed to ${c.name() ?? ""}`);
    } else {
      c.pos += 1;
    }
  }
  return out.join(" · ");
}

function createSchema(c: Cursor, context: Context): boolean {
  c.accept("if", "not", "exists");
  let name = c.isWord("authorization") ? null : c.name();
  if (c.accept("authorization")) {
    const role = c.name();
    name = name ?? role;
  }
  if (name === null) return false;
  context.builder.create("schema", name, name, context.version);
  return true;
}

function createExtension(c: Cursor, context: Context): boolean {
  c.accept("if", "not", "exists");
  const name = c.name();
  if (name === null) return false;
  c.accept("with");
  let detail: string | undefined;
  if (c.accept("schema")) {
    const schema = c.name();
    if (schema) detail = `in ${schema}`;
  }
  context.builder.create("extension", "", name, context.version, { detail });
  return true;
}

function createSequence(c: Cursor, context: Context, temporary: boolean): boolean {
  c.accept("if", "not", "exists");
  const raw = c.qualified();
  if (!raw) return false;
  if (temporary) return true;
  const { schema, name } = resolve(context, raw);
  const options = render(c.rest(), context.sql);
  context.builder.create("sequence", schema, name, context.version, { detail: options || undefined });
  return true;
}

/* ----------------------------------------------------------------- alter */

function readAlter(c: Cursor, context: Context): boolean {
  c.accept("alter");
  if (c.accept("table") || c.accept("foreign", "table")) return alterRelation(c, context, "table");
  if (c.accept("view")) return alterRelation(c, context, "view");
  if (c.accept("materialized", "view")) return alterRelation(c, context, "materialized-view");
  if (c.accept("type")) return alterType(c, context);
  if (c.accept("domain")) return alterDomain(c, context);
  if (c.accept("function")) return alterRoutine(c, context, "function");
  if (c.accept("procedure") || c.accept("routine")) return alterRoutine(c, context, "procedure");
  if (c.accept("sequence")) return alterSequence(c, context);
  if (c.accept("index")) return alterIndex(c, context);
  if (c.accept("schema")) return alterSchema(c, context);
  if (c.accept("extension")) return alterExtension(c, context);
  if (c.accept("trigger")) return alterTableScoped(c, context, "trigger");
  if (c.accept("policy")) return alterTableScoped(c, context, "policy");
  return false;
}

function alterRelation(c: Cursor, context: Context, kind: "table" | "view" | "materialized-view"): boolean {
  c.accept("if", "exists");
  c.accept("only");
  const raw = c.qualified();
  if (!raw) return false;
  c.acceptPunct("*");
  const at = resolve(context, raw);
  // A table made earlier in this migration keeps its own kind; a view altered with ALTER TABLE is still a view.
  const known = context.builder.find(kind, at.schema, at.name);
  const subjectKind = known?.kind ?? kind;
  const { builder, version } = context;

  if (c.accept("rename", "to")) {
    const next = c.name();
    if (next === null) return false;
    builder.move(subjectKind, at, { schema: at.schema, name: next }, version);
    return true;
  }
  if (c.accept("set", "schema")) {
    const next = c.name();
    if (next === null) return false;
    builder.move(subjectKind, at, { schema: next, name: at.name }, version);
    return true;
  }
  if (c.accept("rename", "constraint")) {
    const from = c.name();
    if (from === null || !c.accept("to")) return false;
    const to = c.name();
    if (to === null) return false;
    addPart(builder.alter(subjectKind, at.schema, at.name, version), { kind: "constraint", op: "rename", name: to, from }, version);
    return true;
  }
  if (c.isWord("rename")) {
    c.accept("rename");
    c.accept("column");
    const from = c.name();
    if (from === null || !c.accept("to")) return false;
    const to = c.name();
    if (to === null) return false;
    addPart(builder.alter(subjectKind, at.schema, at.name, version), { kind: "column", op: "rename", name: to, from }, version);
    return true;
  }

  const subject = builder.alter(subjectKind, at.schema, at.name, version);
  for (const action of splitTopLevel(c.rest())) alterTableAction(c.sub(action), context, subject);
  return true;
}

function alterTableAction(c: Cursor, context: Context, subject: WorkingSubject): void {
  const { version, sql } = { version: context.version, sql: context.sql };
  const table = subject.name;
  const add = (part: Omit<WorkingPart, "versions">) => addPart(subject, part, version);

  if (c.accept("add")) {
    if (isTableConstraintStart(c.peek())) {
      const read = tableConstraint(c.sub(c.rest()), context, table);
      if (read) addConstraint(subject, read, version);
      return;
    }
    c.accept("column");
    c.accept("if", "not", "exists");
    const column = columnDefinition(c, context, table);
    if (column) add({ kind: "column", op: "add", name: column.name, facts: column.facts });
    return;
  }
  if (c.accept("drop")) {
    if (c.accept("constraint")) {
      c.accept("if", "exists");
      const name = c.name();
      if (name) add({ kind: "constraint", op: "drop", name });
      return;
    }
    c.accept("column");
    c.accept("if", "exists");
    const name = c.name();
    if (name) add({ kind: "column", op: "drop", name });
    return;
  }
  if (c.accept("alter")) {
    if (c.accept("constraint")) {
      const name = c.name();
      if (name) add({ kind: "constraint", op: "change", name, detail: render(c.rest(), sql) });
      return;
    }
    c.accept("column");
    const name = c.name();
    if (name === null) return;
    const change = columnChange(c, sql);
    add({ kind: "column", op: "change", name, facts: [{ aspect: change.aspect, text: change.text }] });
    return;
  }
  if (c.accept("validate", "constraint")) {
    const name = c.name();
    if (name) add({ kind: "constraint", op: "change", name, detail: "validated" });
    return;
  }
  const security = /^(enable|disable|force|no force) row level security$/.exec(render(c.tokens, sql));
  if (security) {
    const state = { enable: "enabled", disable: "disabled", force: "forced", "no force": "not forced" }[
      security[1] as "enable" | "disable" | "force" | "no force"
    ];
    add({ kind: "setting", op: "change", name: "row level security", detail: state });
    return;
  }
  const toggle = c.acceptOne(["enable", "disable"]);
  if (toggle) {
    const mode = c.acceptOne(["replica", "always"]);
    if (c.accept("trigger")) {
      const name = c.name() ?? "";
      const state = `${toggle}d${mode ? ` (${mode})` : ""}`;
      if (name === "all" || name === "user") add({ kind: "setting", op: "change", name: `${name} triggers`, detail: state });
      else add({ kind: "trigger", op: "change", name, detail: state });
      return;
    }
    if (c.accept("rule")) {
      add({ kind: "setting", op: "change", name: `rule ${c.name() ?? ""}`, detail: `${toggle}d` });
      return;
    }
  }
  if (c.accept("owner", "to")) {
    add({ kind: "setting", op: "change", name: "owner", detail: render(c.rest(), sql) });
    return;
  }
  if (c.accept("attach", "partition")) {
    const partition = c.qualified();
    add({ kind: "setting", op: "add", name: `partition ${partition?.name ?? ""}`, detail: render(c.rest(), sql) || undefined });
    return;
  }
  if (c.accept("detach", "partition")) {
    const partition = c.qualified();
    add({ kind: "setting", op: "drop", name: `partition ${partition?.name ?? ""}` });
    return;
  }
  // SET (…), SET LOGGED, REPLICA IDENTITY, CLUSTER ON, INHERIT, and friends.
  const text = render(c.tokens, sql);
  if (text) add({ kind: "setting", op: "change", name: text });
}

/** One ALTER COLUMN action, as a change to one aspect of the column. */
function columnChange(c: Cursor, sql: string): ColumnChange {
  if (c.accept("set", "data", "type") || c.accept("type")) {
    const type = c.until((token) => token.kind === "word" && (token.value === "using" || token.value === "collate"));
    const text = render(type, sql);
    return { aspect: "type", value: text, text: `type ${text}` };
  }
  if (c.accept("set", "default")) {
    const text = render(c.rest(), sql);
    return { aspect: "default", value: text, text: `default ${text}` };
  }
  if (c.accept("drop", "default")) return { aspect: "default", value: null, text: "drop default" };
  if (c.accept("set", "not", "null")) return { aspect: "null", value: "not null", text: "set not null" };
  if (c.accept("drop", "not", "null")) return { aspect: "null", value: null, text: "drop not null" };
  if (c.accept("add", "generated")) return { aspect: "identity", value: "identity", text: "identity" };
  if (c.accept("drop", "identity")) return { aspect: "identity", value: null, text: "drop identity" };
  if (c.accept("drop", "expression")) return { aspect: "generated", value: null, text: "drop expression" };
  const text = render(c.rest(), sql);
  return { aspect: "other", value: text, text };
}

function alterType(c: Cursor, context: Context): boolean {
  const raw = c.qualified();
  if (!raw) return false;
  const at = resolve(context, raw);
  const { builder, version, sql } = context;
  const kind = builder.find("type", at.schema, at.name)?.kind ?? (c.isWord("add") && c.isWord("value", 1) ? "enum" : c.isWord("rename") && c.isWord("value", 1) ? "enum" : "type");

  if (c.accept("rename", "to")) {
    const next = c.name();
    if (next === null) return false;
    builder.move(kind, at, { schema: at.schema, name: next }, version);
    return true;
  }
  if (c.accept("set", "schema")) {
    const next = c.name();
    if (next === null) return false;
    builder.move(kind, at, { schema: next, name: at.name }, version);
    return true;
  }
  const subject = builder.alter(kind, at.schema, at.name, version);
  if (c.accept("add", "value")) {
    c.accept("if", "not", "exists");
    const value = c.peek();
    if (value?.kind !== "string") return false;
    c.pos += 1;
    const position = c.acceptOne(["before", "after"]);
    const anchor = c.peek();
    addPart(
      subject,
      {
        kind: "value",
        op: "add",
        name: value.value,
        detail: position && anchor?.kind === "string" ? `${position} '${anchor.value}'` : undefined,
      },
      version,
    );
    return true;
  }
  if (c.accept("rename", "value")) {
    const from = c.peek();
    if (from?.kind !== "string") return false;
    c.pos += 1;
    c.accept("to");
    const to = c.peek();
    if (to?.kind !== "string") return false;
    addPart(subject, { kind: "value", op: "rename", name: to.value, from: from.value }, version);
    return true;
  }
  if (c.accept("rename", "attribute")) {
    const from = c.name();
    c.accept("to");
    const to = c.name();
    if (from === null || to === null) return false;
    addPart(subject, { kind: "column", op: "rename", name: to, from }, version);
    return true;
  }
  for (const action of splitTopLevel(c.rest())) {
    const cursor = c.sub(action);
    if (cursor.accept("add", "attribute")) {
      const column = columnDefinition(cursor, context, at.name);
      if (column) addPart(subject, { kind: "column", op: "add", name: column.name, facts: column.facts }, version);
    } else if (cursor.accept("drop", "attribute")) {
      cursor.accept("if", "exists");
      const name = cursor.name();
      if (name) addPart(subject, { kind: "column", op: "drop", name }, version);
    } else if (cursor.accept("alter", "attribute")) {
      const name = cursor.name();
      if (name) {
        const change = columnChange(cursor, sql);
        addPart(subject, { kind: "column", op: "change", name, facts: [{ aspect: change.aspect, text: change.text }] }, version);
      }
    } else if (cursor.accept("owner", "to")) {
      addPart(subject, { kind: "setting", op: "change", name: "owner", detail: render(cursor.rest(), sql) }, version);
    } else {
      const text = render(action, sql);
      if (text) addPart(subject, { kind: "setting", op: "change", name: text }, version);
    }
  }
  return true;
}

function alterDomain(c: Cursor, context: Context): boolean {
  const raw = c.qualified();
  if (!raw) return false;
  const at = resolve(context, raw);
  const { builder, version, sql } = context;
  if (c.accept("rename", "to")) {
    const next = c.name();
    if (next === null) return false;
    builder.move("domain", at, { schema: at.schema, name: next }, version);
    return true;
  }
  const subject = builder.alter("domain", at.schema, at.name, version);
  if (c.accept("add")) {
    const read = tableConstraint(c.sub(c.rest()), context, at.name);
    if (read) addConstraint(subject, read, version);
    return true;
  }
  if (c.accept("drop", "constraint")) {
    c.accept("if", "exists");
    const name = c.name();
    if (name) addPart(subject, { kind: "constraint", op: "drop", name }, version);
    return true;
  }
  if (c.accept("rename", "constraint")) {
    const from = c.name();
    c.accept("to");
    const to = c.name();
    if (from && to) addPart(subject, { kind: "constraint", op: "rename", name: to, from }, version);
    return true;
  }
  const text = render(c.rest(), sql);
  if (text) addPart(subject, { kind: "setting", op: "change", name: text }, version);
  return true;
}

function alterRoutine(c: Cursor, context: Context, kind: "function" | "procedure"): boolean {
  const raw = c.qualified();
  if (!raw) return false;
  const at = resolve(context, raw);
  const args = c.group();
  const signature = args ? argumentTypes(args, context.sql) : undefined;
  const { builder, version } = context;
  const existingKind = builder.find(kind, at.schema, at.name, signature)?.kind ?? kind;
  if (c.accept("rename", "to")) {
    const next = c.name();
    if (next === null) return false;
    builder.move(existingKind, at, { schema: at.schema, name: next }, version, signature);
    return true;
  }
  if (c.accept("set", "schema")) {
    const next = c.name();
    if (next === null) return false;
    builder.move(existingKind, at, { schema: next, name: at.name }, version, signature);
    return true;
  }
  const subject = builder.alter(existingKind, at.schema, at.name, version, signature);
  if (c.accept("owner", "to")) {
    addPart(subject, { kind: "setting", op: "change", name: "owner", detail: render(c.rest(), context.sql) }, version);
    return true;
  }
  const text = render(c.rest(), context.sql);
  if (text) addPart(subject, { kind: "setting", op: "change", name: text }, version);
  return true;
}

function alterSequence(c: Cursor, context: Context): boolean {
  c.accept("if", "exists");
  const raw = c.qualified();
  if (!raw) return false;
  const at = resolve(context, raw);
  const { builder, version } = context;
  if (c.accept("rename", "to")) {
    const next = c.name();
    if (next === null) return false;
    builder.move("sequence", at, { schema: at.schema, name: next }, version);
    return true;
  }
  if (c.accept("set", "schema")) {
    const next = c.name();
    if (next === null) return false;
    builder.move("sequence", at, { schema: next, name: at.name }, version);
    return true;
  }
  const subject = builder.alter("sequence", at.schema, at.name, version);
  const text = render(c.rest(), context.sql);
  if (text) addPart(subject, { kind: "setting", op: "change", name: text }, version);
  return true;
}

function alterIndex(c: Cursor, context: Context): boolean {
  c.accept("if", "exists");
  const raw = c.qualified();
  if (!raw) return false;
  const at = resolve(context, raw);
  const { builder, version } = context;
  if (c.accept("rename", "to")) {
    const next = c.name();
    if (next === null) return false;
    const found = builder.findPart("index", at.schema, at.name);
    if (found) {
      found.subject.versions.add(version);
      addPart(found.subject, { kind: "index", op: "rename", name: next, from: at.name }, version);
    } else {
      builder.move("index", at, { schema: at.schema, name: next }, version);
    }
    return true;
  }
  const subject = builder.alter("index", at.schema, at.name, version);
  const text = render(c.rest(), context.sql);
  if (text) addPart(subject, { kind: "setting", op: "change", name: text }, version);
  return true;
}

function alterSchema(c: Cursor, context: Context): boolean {
  const name = c.name();
  if (name === null) return false;
  const { builder, version } = context;
  if (c.accept("rename", "to")) {
    const next = c.name();
    if (next === null) return false;
    builder.move("schema", { schema: name, name }, { schema: next, name: next }, version);
    return true;
  }
  const subject = builder.alter("schema", name, name, version);
  if (c.accept("owner", "to")) {
    addPart(subject, { kind: "setting", op: "change", name: "owner", detail: render(c.rest(), context.sql) }, version);
  }
  return true;
}

function alterExtension(c: Cursor, context: Context): boolean {
  const name = c.name();
  if (name === null) return false;
  const subject = context.builder.alter("extension", "", name, context.version);
  if (c.accept("update")) {
    const version = c.accept("to") ? c.peek() : undefined;
    addPart(
      subject,
      { kind: "setting", op: "change", name: "version", detail: version ? version.value : "latest" },
      context.version,
    );
    return true;
  }
  const text = render(c.rest(), context.sql);
  if (text) addPart(subject, { kind: "setting", op: "change", name: text }, context.version);
  return true;
}

/** ALTER TRIGGER / ALTER POLICY: `name ON table …`. */
function alterTableScoped(c: Cursor, context: Context, kind: "trigger" | "policy"): boolean {
  const name = c.name();
  if (name === null || !c.accept("on")) return false;
  const raw = c.qualified();
  if (!raw) return false;
  const table = resolve(context, raw);
  const subject = context.builder.alter("table", table.schema, table.name, context.version);
  if (c.accept("rename", "to")) {
    const next = c.name();
    if (next === null) return false;
    addPart(subject, { kind, op: "rename", name: next, from: name }, context.version);
    return true;
  }
  const detail = kind === "policy" ? policyDetail(c, context.sql) : render(c.rest(), context.sql);
  addPart(subject, { kind, op: "change", name, detail }, context.version);
  return true;
}

/* ------------------------------------------------------------------ drop */

const DROPPABLE: [string[], SubjectKind | "trigger" | "policy"][] = [
  [["table"], "table"],
  [["foreign", "table"], "table"],
  [["materialized", "view"], "materialized-view"],
  [["view"], "view"],
  [["index"], "index"],
  [["sequence"], "sequence"],
  [["type"], "type"],
  [["domain"], "domain"],
  [["function"], "function"],
  [["procedure"], "procedure"],
  [["routine"], "function"],
  [["trigger"], "trigger"],
  [["policy"], "policy"],
  [["schema"], "schema"],
  [["extension"], "extension"],
];

function readDrop(c: Cursor, context: Context): boolean {
  c.accept("drop");
  const match = DROPPABLE.find(([words]) => c.accept(...words));
  if (!match) return false;
  const kind = match[1];
  c.accept("concurrently");
  c.accept("if", "exists");
  const { builder, version, sql } = context;

  if (kind === "trigger" || kind === "policy") {
    const name = c.name();
    if (name === null || !c.accept("on")) return false;
    const raw = c.qualified();
    if (!raw) return false;
    const table = resolve(context, raw);
    addPart(builder.alter("table", table.schema, table.name, version), { kind, op: "drop", name }, version);
    return true;
  }

  const targets = splitTopLevel(
    c.until((token) => token.kind === "word" && (token.value === "cascade" || token.value === "restrict")),
  );
  for (const target of targets) {
    const cursor = c.sub(target);
    if (kind === "schema" || kind === "extension") {
      const name = cursor.name();
      if (name) builder.drop(kind, kind === "schema" ? name : "", name, version);
      continue;
    }
    const raw = cursor.qualified();
    if (!raw) continue;
    const at = resolve(context, raw);
    if (kind === "index") {
      // An index belongs to a table, but DROP INDEX names only the index.
      const found = builder.findPart("index", at.schema, at.name);
      if (found) {
        found.subject.versions.add(version);
        addPart(found.subject, { kind: "index", op: "drop", name: at.name }, version);
      } else {
        builder.drop("index", at.schema, at.name, version);
      }
      continue;
    }
    if (kind === "function" || kind === "procedure") {
      const args = cursor.group();
      const known = builder.find(kind, at.schema, at.name, args ? argumentTypes(args, sql) : undefined, true);
      builder.drop(known?.kind ?? kind, at.schema, at.name, version, known?.signature ?? (args ? argumentTypes(args, sql) : undefined));
      continue;
    }
    const known = builder.find(kind, at.schema, at.name);
    builder.drop(known && familyOf(known.kind) === familyOf(kind) ? known.kind : kind, at.schema, at.name, version);
  }
  return true;
}

/* ----------------------------------------------------- comment and grant */

function readComment(c: Cursor, context: Context): boolean {
  if (!c.accept("comment", "on")) return false;
  const { builder, version } = context;
  const kindWords: [string[], SubjectKind | "column" | "constraint" | "trigger" | "policy"][] = [
    [["table"], "table"],
    [["foreign", "table"], "table"],
    [["materialized", "view"], "materialized-view"],
    [["view"], "view"],
    [["column"], "column"],
    [["constraint"], "constraint"],
    [["trigger"], "trigger"],
    [["policy"], "policy"],
    [["index"], "index"],
    [["sequence"], "sequence"],
    [["type"], "type"],
    [["domain"], "domain"],
    [["function"], "function"],
    [["procedure"], "procedure"],
    [["schema"], "schema"],
    [["extension"], "extension"],
  ];
  const match = kindWords.find(([words]) => c.accept(...words));
  if (!match) return false;
  const kind = match[1];
  const describe = () => {
    const rest = c.rest();
    const isAt = rest.findIndex((token) => token.kind === "word" && token.value === "is");
    const value = rest[isAt + 1];
    return value?.kind === "string" ? { op: "add" as const, detail: value.value } : { op: "drop" as const, detail: "removed" };
  };

  if (kind === "column") {
    const parts: string[] = [];
    do {
      const name = c.name();
      if (name === null) return false;
      parts.push(name);
    } while (c.acceptPunct("."));
    if (parts.length < 2) return false;
    const column = parts[parts.length - 1];
    const table = parts[parts.length - 2];
    const schema = parts.length > 2 ? parts[parts.length - 3] : context.schema;
    const known = builder.find("table", schema, table);
    const subject = builder.alter(known?.kind ?? "table", schema, table, version);
    addPart(subject, { kind: "comment", name: column, ...describe() }, version);
    return true;
  }
  if (kind === "constraint" || kind === "trigger" || kind === "policy") {
    const name = c.name();
    if (name === null || !c.accept("on")) return false;
    if (kind === "constraint") c.accept("domain");
    const raw = c.qualified();
    if (!raw) return false;
    const at = resolve(context, raw);
    const known = builder.find("table", at.schema, at.name);
    addPart(builder.alter(known?.kind ?? "table", at.schema, at.name, version), { kind: "comment", name, ...describe() }, version);
    return true;
  }
  if (kind === "schema" || kind === "extension") {
    const name = c.name();
    if (name === null) return false;
    const subject = builder.alter(kind, kind === "schema" ? name : "", name, version);
    addPart(subject, { kind: "comment", name: "", ...describe() }, version);
    return true;
  }
  const raw = c.qualified();
  if (!raw) return false;
  const at = resolve(context, raw);
  let signature: string | undefined;
  if (kind === "function" || kind === "procedure") {
    const args = c.group();
    signature = args ? argumentTypes(args, context.sql) : undefined;
  }
  if (kind === "index") {
    const found = builder.findPart("index", at.schema, at.name);
    if (found) {
      addPart(found.subject, { kind: "comment", name: at.name, ...describe() }, version);
      return true;
    }
  }
  const known = builder.find(kind, at.schema, at.name, signature);
  const subject = builder.alter(known?.kind ?? kind, at.schema, at.name, version, known?.signature ?? signature);
  addPart(subject, { kind: "comment", name: "", ...describe() }, version);
  return true;
}

function readGrant(c: Cursor, context: Context): boolean {
  const grant = c.accept("grant");
  if (!grant) c.accept("revoke");
  if (!grant) c.accept("grant", "option", "for");
  const privileges = render(c.until((token) => token.kind === "word" && token.value === "on"), context.sql);
  // GRANT role TO role: membership, not about any object here.
  if (!c.accept("on")) return false;
  const { builder, version } = context;
  const roles = (tokens: Token[]) => {
    const cursor = c.sub(tokens);
    cursor.acceptOne(["to", "from"]);
    return render(
      cursor.until((token) => token.kind === "word" && ["with", "granted", "cascade", "restrict"].includes(token.value)),
      context.sql,
    );
  };

  if (c.accept("all")) {
    const what = c.name();
    if (!c.accept("in", "schema")) return false;
    const names = splitTopLevel(c.until((token) => token.kind === "word" && (token.value === "to" || token.value === "from")));
    const who = roles(c.rest());
    for (const piece of names) {
      const schema = piece[0]?.value;
      if (!schema) continue;
      addPart(
        builder.alter("schema", schema, schema, version),
        { kind: "grant", op: grant ? "add" : "drop", name: who, detail: `${privileges} on all ${what ?? ""}` },
        version,
      );
    }
    return true;
  }

  const objectKind = c.acceptOne(["table", "sequence", "function", "procedure", "routine", "schema", "type", "domain", "database", "language", "tablespace", "foreign"]);
  if (objectKind === "database" || objectKind === "language" || objectKind === "tablespace" || objectKind === "foreign") {
    return false;
  }
  const targets = splitTopLevel(c.until((token) => token.kind === "word" && (token.value === "to" || token.value === "from")));
  const who = roles(c.rest());
  for (const target of targets) {
    const cursor = c.sub(target);
    let subject: WorkingSubject;
    if (objectKind === "schema") {
      const name = cursor.name();
      if (!name) continue;
      subject = builder.alter("schema", name, name, version);
    } else {
      const raw = cursor.qualified();
      if (!raw) continue;
      const at = resolve(context, raw);
      const kind: SubjectKind =
        objectKind === "sequence"
          ? "sequence"
          : objectKind === "function" || objectKind === "routine"
            ? "function"
            : objectKind === "procedure"
              ? "procedure"
              : objectKind === "type" || objectKind === "domain"
                ? "type"
                : "table";
      const args = familyOf(kind) === "routine" ? cursor.group() : null;
      const signature = args ? argumentTypes(args, context.sql) : undefined;
      const known = builder.find(kind, at.schema, at.name, signature);
      subject = builder.alter(known?.kind ?? kind, at.schema, at.name, version, known?.signature ?? signature);
    }
    addPart(subject, { kind: "grant", op: grant ? "add" : "drop", name: who, detail: privileges }, version);
  }
  return true;
}

/* ------------------------------------------------------------------ data */

function readData(c: Cursor, context: Context): boolean {
  if (c.accept("with")) {
    c.accept("recursive");
    // Past each `name [(cols)] AS [NOT] [MATERIALIZED] (…)` to the statement they feed.
    for (;;) {
      c.name();
      c.group();
      if (!c.accept("as")) return false;
      c.accept("not");
      c.accept("materialized");
      if (!c.group()) return false;
      if (!c.acceptPunct(",")) break;
    }
  }
  const verb = c.acceptOne(["insert", "update", "delete", "merge", "truncate", "copy", "select"]);
  if (!verb) return false;
  const { builder, version } = context;
  const touch = (raw: { schema: string | null; name: string } | null, what: string) => {
    if (!raw) return false;
    const at = resolve(context, raw);
    const known = builder.find("table", at.schema, at.name);
    addPart(builder.alter(known?.kind ?? "table", at.schema, at.name, version), { kind: "rows", op: "change", name: what }, version);
    return true;
  };
  switch (verb) {
    case "insert":
      c.accept("into");
      return touch(c.qualified(), "insert");
    case "update":
      c.accept("only");
      return touch(c.qualified(), "update");
    case "delete":
      c.accept("from");
      c.accept("only");
      return touch(c.qualified(), "delete");
    case "merge":
      c.accept("into");
      c.accept("only");
      return touch(c.qualified(), "merge");
    case "truncate": {
      c.accept("table");
      const targets = splitTopLevel(
        c.until((token) => token.kind === "word" && ["restart", "continue", "cascade", "restrict"].includes(token.value)),
      );
      for (const target of targets) {
        const cursor = c.sub(target);
        cursor.accept("only");
        touch(cursor.qualified(), "truncate");
      }
      return targets.length > 0;
    }
    case "copy": {
      const raw = c.qualified();
      c.group();
      if (!c.accept("from")) return false;
      return touch(raw, "copy");
    }
    case "select":
      return readSelect(c, context);
  }
  return false;
}

/**
 * A SELECT changes nothing unless a function it calls does. `setval` moves a
 * sequence and `set_config` is the search path (as pg_dump writes it); others
 * are reported as they are.
 */
function readSelect(c: Cursor, context: Context): boolean {
  if (c.accept("pg_catalog")) c.acceptPunct(".");
  if (c.isWord("set_config")) return true;
  if (!c.isWord("setval")) return false;
  c.pos += 1;
  const args = c.group();
  if (!args) return false;
  const [target, value] = splitTopLevel(args);
  const nameToken = target?.find((token) => token.kind === "string");
  if (!nameToken) return false;
  const cursor = new Cursor(tokenize(nameToken.value), nameToken.value);
  const raw = cursor.qualified();
  if (!raw) return false;
  const at = resolve(context, raw);
  addPart(
    context.builder.alter("sequence", at.schema, at.name, context.version),
    { kind: "setting", op: "change", name: "value", detail: value ? render(value, context.sql) : undefined },
    context.version,
  );
  return true;
}

function readRefresh(c: Cursor, context: Context): boolean {
  if (!c.accept("refresh", "materialized", "view")) return false;
  c.accept("concurrently");
  const raw = c.qualified();
  if (!raw) return false;
  const at = resolve(context, raw);
  addPart(
    context.builder.alter("materialized-view", at.schema, at.name, context.version),
    { kind: "rows", op: "change", name: "refresh" },
    context.version,
  );
  return true;
}

/* -------------------------------------------------------------------- do */

/** Control words a PL/pgSQL statement can start with before the SQL it runs. */
const BLOCK_OPENERS = new Set(["begin", "else", "loop", "declare"]);
const CONDITION_OPENERS = new Set(["if", "elsif", "elseif", "when", "exception", "for", "foreach", "while", "case"]);
/** PL/pgSQL statements that are not SQL and change nothing. */
const PLPGSQL_ONLY = new Set(["perform", "raise", "return", "null", "end", "get", "exit", "continue", "assert", "open", "close", "fetch", "move", "call"]);

/**
 * A DO block's body, read statement by statement for the SQL inside its
 * control flow — `IF NOT EXISTS (…) THEN CREATE TYPE …` counts as creating the
 * type — and inside `EXECUTE '…'` when the string is written out in full.
 */
function readDo(c: Cursor, context: Context): boolean {
  c.accept("do");
  if (c.accept("language")) c.name();
  const body = c.peek();
  if (body?.kind !== "string") return false;
  const code = body.value;
  const inner: Context = { ...context, sql: code };
  const before = fingerprint(context.builder);
  for (const tokens of splitStatements(tokenize(code))) readProcedural(tokens, inner);
  // A DO block that did nothing recognisable is still something that ran.
  if (fingerprint(context.builder) === before) return false;
  return true;
}

function fingerprint(builder: Builder): string {
  return JSON.stringify(builder.result());
}

/** One statement of a PL/pgSQL body; its tokens index into `context.sql`, the body. */
function readProcedural(tokens: Token[], context: Context): void {
  let start = 0;
  for (;;) {
    const token = tokens[start];
    if (!token || token.kind !== "word") break;
    if (BLOCK_OPENERS.has(token.value)) {
      start += 1;
      continue;
    }
    if (CONDITION_OPENERS.has(token.value)) {
      // Past the condition to what runs when it holds.
      let depth = 0;
      let found = -1;
      for (let i = start + 1; i < tokens.length; i += 1) {
        const t = tokens[i];
        if (t.kind === "punct" && t.value === "(") depth += 1;
        else if (t.kind === "punct" && t.value === ")") depth -= 1;
        else if (depth === 0 && t.kind === "word" && (t.value === "then" || t.value === "loop")) {
          found = i;
          break;
        }
      }
      if (found === -1) return;
      start = found + 1;
      continue;
    }
    // `name := value`, an assignment; the tokenizer leaves `:` and `=` apart.
    if (tokens[start + 1]?.value === ":" && tokens[start + 2]?.value === "=") return;
    break;
  }
  const first = tokens[start];
  if (!first || first.kind !== "word") return;
  if (PLPGSQL_ONLY.has(first.value)) return;
  if (first.value === "execute") {
    const literal = tokens[start + 1];
    const after = tokens[start + 2];
    const whole = !after || (after.kind === "word" && after.value === "using");
    if (literal?.kind === "string" && whole) {
      const code = literal.value;
      for (const statement of splitStatements(tokenize(code))) {
        readStatement(statement, { ...context, sql: code }, true);
      }
    }
    return;
  }
  readStatement(tokens.slice(start), context, true);
}
