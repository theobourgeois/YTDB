import { scanStatements } from "./sql";

/**
 * Working out whether a migration has already run against a database without a
 * ledger to say so. The file is read for what it creates, drops, or renames, and
 * each of those is checked against the database's catalog. Data changes, grants,
 * and anything else that leaves no structural trace produce no evidence.
 */

export type Expectation = "present" | "absent";

export type Evidence =
  | { kind: "schema"; name: string; expect: Expectation }
  | { kind: "relation"; schema: string; name: string; expect: Expectation }
  | { kind: "column"; schema: string; table: string; column: string; expect: Expectation }
  | { kind: "not-null"; schema: string; table: string; column: string; expect: Expectation }
  | { kind: "constraint"; schema: string; table: string; name: string; expect: Expectation }
  | { kind: "index"; schema: string; name: string; expect: Expectation }
  | { kind: "enum"; schema: string; name: string; expect: Expectation }
  | { kind: "enum-value"; schema: string; type: string; value: string; expect: Expectation }
  | { kind: "function"; schema: string; name: string; expect: Expectation }
  | { kind: "policy"; schema: string; table: string; name: string; expect: Expectation }
  | { kind: "trigger"; schema: string; table: string; name: string; expect: Expectation }
  | { kind: "extension"; name: string; expect: Expectation };

export type Verdict = "applied" | "pending" | "partial" | "unknown";

export type EvidenceResult = {
  evidence: Evidence;
  description: string;
  satisfied: boolean;
  /** Set when the thing was found, but not where the file said — a table since moved to another schema. */
  note?: string;
};

export type DetectionResult = {
  setName: string;
  version: string;
  verdict: Verdict;
  evidence: EvidenceResult[];
};

/** What the checks are run against: the database's catalog, indexed for lookup. */
export type Catalog = {
  schemas: Set<string>;
  /** `schema.name` of every table, view, and materialized view. */
  relations: Set<string>;
  /** `schema.table.column` → whether it is NOT NULL. */
  columns: Map<string, { notNull: boolean }>;
  /** `schema.table.constraint` */
  constraints: Set<string>;
  /** `schema.index` */
  indexes: Set<string>;
  /** `schema.enum` → its labels */
  enums: Map<string, Set<string>>;
  /** `schema.function` */
  functions: Set<string>;
  /** `schema.table.policy` */
  policies: Set<string>;
  /** `schema.table.trigger` */
  triggers: Set<string>;
  extensions: Set<string>;
};

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const QUALIFIED = `(${IDENT}(?:\\s*\\.\\s*${IDENT})?)`;
const SINGLE = `(${IDENT})`;

function rx(source: string): RegExp {
  return new RegExp(source, "i");
}

function unquote(part: string): string {
  const trimmed = part.trim();
  if (trimmed.startsWith('"')) return trimmed.slice(1, -1).replace(/""/g, '"');
  return trimmed.toLowerCase();
}

/** `public.orders` or `orders` → the schema and name the catalog will know them by. */
function splitQualified(raw: string, defaultSchema = "public"): { schema: string; name: string } {
  const parts = raw.split(/\s*\.\s*(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  if (parts.length === 2) return { schema: unquote(parts[0]), name: unquote(parts[1]) };
  return { schema: defaultSchema, name: unquote(parts[0]) };
}

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** The text of a `DO $$ … $$` block's body, so what it does conditionally still counts. */
function doBody(statement: string): string | null {
  const match = /^\s*do\s+(?:language\s+\w+\s+)?(\$[A-Za-z_]*\$)([\s\S]*)\1/i.exec(statement);
  return match ? match[2] : null;
}

const CREATE_TABLE = rx(
  String.raw`^\s*create\s+(?:or\s+replace\s+)?(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${QUALIFIED}`,
);
const CREATE_TEMP_TABLE = rx(String.raw`^\s*create\s+(?:temp|temporary)\s+table`);
const CREATE_VIEW = rx(
  String.raw`^\s*create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?${QUALIFIED}`,
);
const DROP_RELATION = rx(
  String.raw`^\s*drop\s+(?:table|view|materialized\s+view)\s+(?:if\s+exists\s+)?${QUALIFIED}`,
);
const ALTER_TABLE = rx(String.raw`^\s*alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${QUALIFIED}\s+([\s\S]*)$`);
const ADD_COLUMN = rx(String.raw`\badd\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?(?!constraint\b)${SINGLE}`);
const ADD_CONSTRAINT = rx(String.raw`\badd\s+constraint\s+${SINGLE}`);
const DROP_COLUMN = rx(String.raw`\bdrop\s+(?:column\s+)?(?:if\s+exists\s+)?(?!constraint\b|not\b)${SINGLE}`);
const DROP_CONSTRAINT = rx(String.raw`\bdrop\s+constraint\s+(?:if\s+exists\s+)?${SINGLE}`);
const RENAME_COLUMN = rx(String.raw`\brename\s+(?:column\s+)?${SINGLE}\s+to\s+${SINGLE}`);
const RENAME_TABLE = rx(String.raw`\brename\s+to\s+${SINGLE}`);
const SET_NOT_NULL = rx(String.raw`\balter\s+(?:column\s+)?${SINGLE}\s+set\s+not\s+null`);
const DROP_NOT_NULL = rx(String.raw`\balter\s+(?:column\s+)?${SINGLE}\s+drop\s+not\s+null`);
const CREATE_INDEX = rx(
  String.raw`^\s*create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?${SINGLE}\s+on\s+(?:only\s+)?${QUALIFIED}`,
);
const DROP_INDEX = rx(String.raw`^\s*drop\s+index\s+(?:concurrently\s+)?(?:if\s+exists\s+)?${QUALIFIED}`);
const CREATE_ENUM = rx(String.raw`^\s*create\s+type\s+${QUALIFIED}\s+as\s+enum`);
const DROP_TYPE = rx(String.raw`^\s*drop\s+type\s+(?:if\s+exists\s+)?${QUALIFIED}`);
const ADD_VALUE = rx(String.raw`^\s*alter\s+type\s+${QUALIFIED}\s+add\s+value\s+(?:if\s+not\s+exists\s+)?'((?:[^']|'')*)'`);
const RENAME_VALUE = rx(String.raw`^\s*alter\s+type\s+${QUALIFIED}\s+rename\s+value\s+'(?:[^']|'')*'\s+to\s+'((?:[^']|'')*)'`);
const CREATE_FUNCTION = rx(String.raw`^\s*create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+${QUALIFIED}`);
const DROP_FUNCTION = rx(String.raw`^\s*drop\s+(?:function|procedure)\s+(?:if\s+exists\s+)?${QUALIFIED}`);
const CREATE_POLICY = rx(String.raw`^\s*create\s+policy\s+${SINGLE}\s+on\s+${QUALIFIED}`);
const DROP_POLICY = rx(String.raw`^\s*drop\s+policy\s+(?:if\s+exists\s+)?${SINGLE}\s+on\s+${QUALIFIED}`);
const CREATE_TRIGGER = rx(
  String.raw`^\s*create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+${SINGLE}\s+[\s\S]*?\bon\s+${QUALIFIED}`,
);
const DROP_TRIGGER = rx(String.raw`^\s*drop\s+trigger\s+(?:if\s+exists\s+)?${SINGLE}\s+on\s+${QUALIFIED}`);
const CREATE_SCHEMA = rx(String.raw`^\s*create\s+schema\s+(?:if\s+not\s+exists\s+)?${SINGLE}`);
const DROP_SCHEMA = rx(String.raw`^\s*drop\s+schema\s+(?:if\s+exists\s+)?${SINGLE}`);
const CREATE_EXTENSION = rx(String.raw`^\s*create\s+extension\s+(?:if\s+not\s+exists\s+)?${SINGLE}`);

function fromStatement(text: string, into: Evidence[]): void {
  let match: RegExpExecArray | null;

  const body = doBody(text);
  if (body !== null) {
    for (const inner of scanStatements(body)) fromStatement(body.slice(inner.at, inner.end), into);
    return;
  }

  if (CREATE_TEMP_TABLE.test(text)) return;

  if ((match = CREATE_TABLE.exec(text)) || (match = CREATE_VIEW.exec(text))) {
    into.push({ kind: "relation", ...splitQualified(match[1]), expect: "present" });
    return;
  }
  if ((match = DROP_RELATION.exec(text))) {
    into.push({ kind: "relation", ...splitQualified(match[1]), expect: "absent" });
    return;
  }
  if ((match = ALTER_TABLE.exec(text))) {
    const table = splitQualified(match[1]);
    const rest = match[2];
    const at = { schema: table.schema, table: table.name };
    // Each action is looked for separately; one statement can carry several.
    for (const action of rest.split(/,(?=(?:[^()]*\([^()]*\))*[^()]*$)/)) {
      let inner: RegExpExecArray | null;
      if ((inner = ADD_CONSTRAINT.exec(action))) {
        into.push({ kind: "constraint", ...at, name: unquote(inner[1]), expect: "present" });
      } else if ((inner = DROP_CONSTRAINT.exec(action))) {
        into.push({ kind: "constraint", ...at, name: unquote(inner[1]), expect: "absent" });
      } else if ((inner = ADD_COLUMN.exec(action))) {
        into.push({ kind: "column", ...at, column: unquote(inner[1]), expect: "present" });
      } else if ((inner = RENAME_COLUMN.exec(action))) {
        into.push({ kind: "column", ...at, column: unquote(inner[2]), expect: "present" });
        into.push({ kind: "column", ...at, column: unquote(inner[1]), expect: "absent" });
      } else if ((inner = RENAME_TABLE.exec(action))) {
        into.push({ kind: "relation", schema: table.schema, name: unquote(inner[1]), expect: "present" });
      } else if ((inner = SET_NOT_NULL.exec(action))) {
        into.push({ kind: "not-null", ...at, column: unquote(inner[1]), expect: "present" });
      } else if ((inner = DROP_NOT_NULL.exec(action))) {
        into.push({ kind: "not-null", ...at, column: unquote(inner[1]), expect: "absent" });
      } else if ((inner = DROP_COLUMN.exec(action))) {
        into.push({ kind: "column", ...at, column: unquote(inner[1]), expect: "absent" });
      }
    }
    return;
  }
  if ((match = CREATE_INDEX.exec(text))) {
    const table = splitQualified(match[2]);
    into.push({ kind: "index", schema: table.schema, name: unquote(match[1]), expect: "present" });
    return;
  }
  if ((match = DROP_INDEX.exec(text))) {
    into.push({ kind: "index", ...splitQualified(match[1]), expect: "absent" });
    return;
  }
  if ((match = CREATE_ENUM.exec(text))) {
    into.push({ kind: "enum", ...splitQualified(match[1]), expect: "present" });
    return;
  }
  if ((match = DROP_TYPE.exec(text))) {
    into.push({ kind: "enum", ...splitQualified(match[1]), expect: "absent" });
    return;
  }
  if ((match = ADD_VALUE.exec(text)) || (match = RENAME_VALUE.exec(text))) {
    const type = splitQualified(match[1]);
    into.push({ kind: "enum-value", schema: type.schema, type: type.name, value: match[2].replace(/''/g, "'"), expect: "present" });
    return;
  }
  if ((match = CREATE_FUNCTION.exec(text))) {
    into.push({ kind: "function", ...splitQualified(match[1]), expect: "present" });
    return;
  }
  if ((match = DROP_FUNCTION.exec(text))) {
    into.push({ kind: "function", ...splitQualified(match[1]), expect: "absent" });
    return;
  }
  if ((match = CREATE_POLICY.exec(text))) {
    const table = splitQualified(match[2]);
    into.push({ kind: "policy", schema: table.schema, table: table.name, name: unquote(match[1]), expect: "present" });
    return;
  }
  if ((match = DROP_POLICY.exec(text))) {
    const table = splitQualified(match[2]);
    into.push({ kind: "policy", schema: table.schema, table: table.name, name: unquote(match[1]), expect: "absent" });
    return;
  }
  if ((match = CREATE_TRIGGER.exec(text))) {
    const table = splitQualified(match[2]);
    into.push({ kind: "trigger", schema: table.schema, table: table.name, name: unquote(match[1]), expect: "present" });
    return;
  }
  if ((match = DROP_TRIGGER.exec(text))) {
    const table = splitQualified(match[2]);
    into.push({ kind: "trigger", schema: table.schema, table: table.name, name: unquote(match[1]), expect: "absent" });
    return;
  }
  if ((match = CREATE_SCHEMA.exec(text))) {
    into.push({ kind: "schema", name: unquote(match[1]), expect: "present" });
    return;
  }
  if ((match = DROP_SCHEMA.exec(text))) {
    into.push({ kind: "schema", name: unquote(match[1]), expect: "absent" });
    return;
  }
  if ((match = CREATE_EXTENSION.exec(text))) {
    into.push({ kind: "extension", name: unquote(match[1]), expect: "present" });
  }
}

/**
 * Everything a migration would leave behind in the catalog, in file order. A
 * migration that only moves data, or only grants, yields nothing — there is no
 * way to see from the schema whether it ran.
 */
export function extractEvidence(sql: string): Evidence[] {
  const clean = stripComments(sql);
  const evidence: Evidence[] = [];
  for (const statement of scanStatements(clean)) {
    fromStatement(clean.slice(statement.at, statement.end), evidence);
  }
  // Later statements in the same file win over earlier ones about the same thing:
  // a table created and then renamed is expected under its final name only.
  const seen = new Map<string, Evidence>();
  for (const item of evidence) seen.set(evidenceKey(item), item);
  return [...seen.values()];
}

function evidenceKey(item: Evidence): string {
  switch (item.kind) {
    case "schema":
    case "extension":
      return `${item.kind}:${item.name}`;
    case "relation":
    case "index":
    case "enum":
    case "function":
      return `${item.kind}:${item.schema}.${item.name}`;
    case "column":
    case "not-null":
      return `${item.kind}:${item.schema}.${item.table}.${item.column}`;
    case "constraint":
    case "policy":
    case "trigger":
      return `${item.kind}:${item.schema}.${item.table}.${item.name}`;
    case "enum-value":
      return `${item.kind}:${item.schema}.${item.type}=${item.value}`;
  }
}

export function describeEvidence(item: Evidence): string {
  const want = item.expect === "present" ? "" : "no ";
  switch (item.kind) {
    case "schema":
      return `${want}schema ${item.name}`;
    case "extension":
      return `${want}extension ${item.name}`;
    case "relation":
      return `${want}table ${item.schema}.${item.name}`;
    case "index":
      return `${want}index ${item.schema}.${item.name}`;
    case "enum":
      return `${want}type ${item.schema}.${item.name}`;
    case "function":
      return `${want}function ${item.schema}.${item.name}`;
    case "column":
      return `${want}column ${item.schema}.${item.table}.${item.column}`;
    case "not-null":
      return `${item.schema}.${item.table}.${item.column} ${item.expect === "present" ? "NOT NULL" : "nullable"}`;
    case "constraint":
      return `${want}constraint ${item.name} on ${item.schema}.${item.table}`;
    case "policy":
      return `${want}policy ${item.name} on ${item.schema}.${item.table}`;
    case "trigger":
      return `${want}trigger ${item.name} on ${item.schema}.${item.table}`;
    case "enum-value":
      return `${want}value '${item.value}' in ${item.schema}.${item.type}`;
  }
}

/**
 * Where a table with this name lives when it is not in the schema the file
 * named: exactly one other schema, or nowhere. A table moved after its migration
 * ran still counts as that migration having run.
 */
function relocated(catalog: Catalog, schema: string, table: string): string | null {
  const suffix = `.${table}`;
  const homes: string[] = [];
  for (const key of catalog.relations) {
    if (!key.endsWith(suffix)) continue;
    const at = key.slice(0, -suffix.length);
    if (at !== schema && !at.includes(".")) homes.push(at);
  }
  return homes.length === 1 ? homes[0] : null;
}

/** The schema to look in for a table-scoped thing: the stated one, or where the table went. */
function locate(
  catalog: Catalog,
  schema: string,
  table: string,
): { schema: string; note?: string } {
  if (catalog.relations.has(`${schema}.${table}`)) return { schema };
  const elsewhere = relocated(catalog, schema, table);
  if (!elsewhere) return { schema };
  return { schema: elsewhere, note: `${table} is in ${elsewhere}, not ${schema}` };
}

function exists(item: Evidence, catalog: Catalog): { found: boolean; note?: string } {
  const plain = (found: boolean) => ({ found });
  switch (item.kind) {
    case "schema":
      return plain(catalog.schemas.has(item.name));
    case "extension":
      return plain(catalog.extensions.has(item.name));
    case "relation": {
      if (catalog.relations.has(`${item.schema}.${item.name}`)) return plain(true);
      // Only a table expected to be there can have moved; one expected gone is simply gone.
      if (item.expect !== "present") return plain(false);
      const elsewhere = relocated(catalog, item.schema, item.name);
      return elsewhere
        ? { found: true, note: `${item.name} is in ${elsewhere}, not ${item.schema}` }
        : plain(false);
    }
    case "index":
      return plain(catalog.indexes.has(`${item.schema}.${item.name}`) || indexElsewhere(catalog, item.name));
    case "enum":
      return plain(catalog.enums.has(`${item.schema}.${item.name}`));
    case "function":
      return plain(catalog.functions.has(`${item.schema}.${item.name}`));
    case "column": {
      const home = locate(catalog, item.schema, item.table);
      return { found: catalog.columns.has(`${home.schema}.${item.table}.${item.column}`), note: home.note };
    }
    case "not-null": {
      const home = locate(catalog, item.schema, item.table);
      return {
        found: catalog.columns.get(`${home.schema}.${item.table}.${item.column}`)?.notNull ?? false,
        note: home.note,
      };
    }
    case "constraint": {
      const home = locate(catalog, item.schema, item.table);
      return { found: catalog.constraints.has(`${home.schema}.${item.table}.${item.name}`), note: home.note };
    }
    case "policy": {
      const home = locate(catalog, item.schema, item.table);
      return { found: catalog.policies.has(`${home.schema}.${item.table}.${item.name}`), note: home.note };
    }
    case "trigger": {
      const home = locate(catalog, item.schema, item.table);
      return { found: catalog.triggers.has(`${home.schema}.${item.table}.${item.name}`), note: home.note };
    }
    case "enum-value":
      return plain(catalog.enums.get(`${item.schema}.${item.type}`)?.has(item.value) ?? false);
  }
}

/** Index names are schema-scoped, so an index that moved with its table is found by name alone. */
function indexElsewhere(catalog: Catalog, name: string): boolean {
  const suffix = `.${name}`;
  for (const key of catalog.indexes) if (key.endsWith(suffix)) return true;
  return false;
}

export function judge(evidence: Evidence[], catalog: Catalog): { verdict: Verdict; evidence: EvidenceResult[] } {
  const results = evidence.map((item): EvidenceResult => {
    const { found, note } = exists(item, catalog);
    return {
      evidence: item,
      description: describeEvidence(item),
      satisfied: found === (item.expect === "present"),
      ...(note ? { note } : {}),
    };
  });
  if (results.length === 0) return { verdict: "unknown", evidence: results };
  const satisfied = results.filter((item) => item.satisfied).length;
  const verdict: Verdict =
    satisfied === results.length ? "applied" : satisfied === 0 ? "pending" : "partial";
  return { verdict, evidence: results };
}
