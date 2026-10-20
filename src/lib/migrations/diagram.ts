/**
 * What a migration does to the schema, as a picture: the tables it creates,
 * changes and drops, the foreign keys between them, and — dimmed — the tables
 * already in the database that those keys reach, so the new ones are seen
 * where they attach rather than floating on their own.
 *
 * Built from the migration's SQL (its net effect) and the live tables of the
 * connection it runs against. The live tables may or may not have the
 * migration applied already; either way the SQL decides what is new.
 */

import type { TableInfo } from "../types";
import type { Part, SchemaChanges, Subject } from "./changes";

export type ColumnStatus = "added" | "dropped" | "changed" | "renamed" | "same";
export type TableStatus = "created" | "altered" | "dropped" | "context";
export type EdgeStatus = "added" | "dropped" | "same";

export type DiagramColumn = {
  name: string;
  /** The type and constraints, one short line. */
  detail?: string;
  status: ColumnStatus;
  /** The old name, for a rename. */
  from?: string;
  primaryKey: boolean;
  /** Part of a foreign key drawn on the diagram. */
  linked: boolean;
  /** Touched by one of the migrations in focus. */
  focused: boolean;
};

export type DiagramTable = {
  id: string;
  schema: string;
  name: string;
  kind: "table" | "view";
  status: TableStatus;
  /** Where it was before a rename or a move. */
  from?: { schema: string; name: string };
  columns: DiagramColumn[];
  /** Columns left out because nothing here is about them; shown when the table is opened. */
  hidden: DiagramColumn[];
  /** Neither the SQL nor the database says what columns it has. */
  unknownColumns: boolean;
  focused: boolean;
  versions: string[];
};

export type DiagramEdge = {
  id: string;
  from: string;
  to: string;
  columns: string[];
  targetColumns: string[];
  status: EdgeStatus;
  focused: boolean;
};

export type DiagramSchema = { name: string; status: "created" | "dropped" | "same" };

export type Diagram = {
  schemas: DiagramSchema[];
  tables: DiagramTable[];
  edges: DiagramEdge[];
  /** Changes that are not tables — functions, types, indexes on their own — counted for a caption. */
  otherCount: number;
};

const RELATION_KINDS = new Set<Subject["kind"]>(["table", "view", "materialized-view"]);

export function tableId(schema: string, name: string): string {
  return `${schema}.${name}`;
}

export function buildDiagram(
  changes: SchemaChanges,
  live: TableInfo[] | null,
  /** Migrations to bring forward; the rest of what changed is shown, but quieter. */
  focus: ReadonlySet<string> | null = null,
): Diagram {
  const liveById = new Map((live ?? []).map((table) => [tableId(table.schema, table.name), table]));
  const inFocus = (versions: string[]) => focus === null || versions.some((version) => focus.has(version));

  const tables = new Map<string, DiagramTable>();
  const edges = new Map<string, DiagramEdge>();
  let otherCount = 0;
  const schemaStatus = new Map<string, DiagramSchema["status"]>();

  const addEdge = (edge: Omit<DiagramEdge, "id">) => {
    const id = `${edge.from}(${edge.columns.join(",")})->${edge.to}`;
    const existing = edges.get(id);
    // What the SQL says about a key outranks what the database already has.
    if (existing && existing.status !== "same") return;
    edges.set(id, { ...edge, id });
  };

  for (const subject of changes.subjects) {
    if (subject.kind === "schema") {
      schemaStatus.set(subject.name, subject.effect === "dropped" ? "dropped" : subject.effect === "created" ? "created" : "same");
      continue;
    }
    if (!RELATION_KINDS.has(subject.kind)) {
      otherCount += 1;
      continue;
    }
    const id = tableId(subject.schema, subject.name);
    const before = liveById.get(id) ?? (subject.from ? liveById.get(tableId(subject.from.schema, subject.from.name)) : undefined);
    const status: TableStatus =
      subject.effect === "dropped" ? "dropped" : subject.effect === "altered" ? "altered" : "created";
    const table: DiagramTable = {
      id,
      schema: subject.schema,
      name: subject.name,
      kind: subject.kind === "table" ? "table" : "view",
      status,
      ...(subject.from ? { from: subject.from } : {}),
      columns: [],
      hidden: [],
      unknownColumns: false,
      focused: inFocus(subject.versions),
      versions: subject.versions,
    };
    tables.set(id, table);

    const columns = subjectColumns(subject, before, status, inFocus);
    table.columns = columns;
    table.unknownColumns = columns.length === 0 && !before && subject.kind === "table" && status !== "created";

    // Keys the SQL adds, and the ones it takes away.
    const droppedNames = new Set<string>();
    const droppedColumns = new Set<string>();
    for (const part of subject.parts) {
      if (part.ref && part.op !== "drop") {
        addEdge({
          from: id,
          to: tableId(part.ref.schema, part.ref.table),
          columns: part.ref.columns,
          targetColumns: part.ref.targetColumns,
          status: status === "dropped" ? "dropped" : "added",
          focused: inFocus(part.versions),
        });
      }
      if (part.op === "drop" && part.kind === "constraint") droppedNames.add(part.name);
      if (part.op === "drop" && part.kind === "column") droppedColumns.add(part.name);
    }
    for (const key of before?.foreignKeys ?? []) {
      const gone =
        status === "dropped" ||
        droppedNames.has(key.name) ||
        key.columns.some((column) => droppedColumns.has(column));
      addEdge({
        from: id,
        to: tableId(key.referencedTable.schema, key.referencedTable.name),
        columns: key.columns,
        targetColumns: key.referencedColumns,
        status: gone ? "dropped" : "same",
        focused: gone ? inFocus(subject.versions) : false,
      });
    }
    // Keys elsewhere that point here: they go when this table does.
    for (const key of before?.referencedBy ?? []) {
      addEdge({
        from: tableId(key.table.schema, key.table.name),
        to: id,
        columns: key.columns,
        targetColumns: key.referencedColumns,
        status: status === "dropped" ? "dropped" : "same",
        focused: false,
      });
    }
  }

  // Tables the keys reach that this migration leaves alone.
  for (const edge of edges.values()) {
    for (const id of [edge.from, edge.to]) {
      if (tables.has(id)) continue;
      const found = liveById.get(id);
      const [schema, ...rest] = id.split(".");
      tables.set(id, {
        id,
        schema: found?.schema ?? schema,
        name: found?.name ?? rest.join("."),
        kind: found?.kind ?? "table",
        status: "context",
        columns: (found?.columns ?? []).map((column) => ({
          name: column.name,
          detail: column.type,
          status: "same",
          primaryKey: column.isPrimaryKey,
          linked: false,
          focused: false,
        })),
        hidden: [],
        unknownColumns: !found,
        focused: false,
        versions: [],
      });
    }
  }

  // Mark the columns the drawn keys run between; a key naming no target columns means the primary key.
  for (const edge of edges.values()) {
    markLinked(tables.get(edge.from), edge.columns);
    const target = tables.get(edge.to);
    if (edge.targetColumns.length > 0) markLinked(target, edge.targetColumns);
    else markLinked(target, target?.columns.filter((column) => column.primaryKey).map((column) => column.name) ?? []);
  }

  // Unknown targets still get the columns the keys name, so the lines have somewhere to land.
  for (const edge of edges.values()) {
    const target = tables.get(edge.to);
    if (!target?.unknownColumns) continue;
    for (const name of edge.targetColumns) {
      if (target.columns.some((column) => column.name === name)) continue;
      target.columns.push({ name, status: "same", primaryKey: false, linked: true, focused: false });
    }
  }

  // A table shows what the migration is about; the rest of its columns wait behind a count.
  for (const table of tables.values()) {
    if (table.status === "created") continue;
    const shown: DiagramColumn[] = [];
    const hidden: DiagramColumn[] = [];
    // A dropped table's columns all go with it, so only its keys are worth a line.
    const changed = (column: DiagramColumn) => table.status !== "dropped" && column.status !== "same";
    for (const column of table.columns) {
      if (changed(column) || column.primaryKey || column.linked) shown.push(column);
      else hidden.push(column);
    }
    table.columns = shown;
    table.hidden = hidden;
  }

  const schemaNames = new Set<string>();
  for (const table of tables.values()) schemaNames.add(table.schema);
  for (const name of schemaStatus.keys()) schemaNames.add(name);
  const schemas = [...schemaNames]
    .sort((a, b) => (a === "public" ? -1 : b === "public" ? 1 : a.localeCompare(b)))
    .map((name) => ({ name, status: schemaStatus.get(name) ?? "same" }));

  return { schemas, tables: [...tables.values()], edges: [...edges.values()], otherCount };
}

/** The columns of a changed table: the database's, with what the SQL does laid over them. */
function subjectColumns(
  subject: Subject,
  before: TableInfo | undefined,
  status: TableStatus,
  inFocus: (versions: string[]) => boolean,
): DiagramColumn[] {
  const columnParts = subject.parts.filter((part) => part.kind === "column");
  const primary = primaryKeyColumns(subject.parts);

  if (status === "created") {
    // Made here: what the SQL defines is the whole of it.
    return columnParts
      .filter((part) => part.op !== "drop")
      .map((part) => ({
        name: part.name,
        detail: part.detail,
        status: "added" as const,
        primaryKey: primary.has(part.name) || /\bprimary key\b/.test(part.detail ?? ""),
        linked: false,
        focused: inFocus(part.versions),
      }));
  }

  const columns: DiagramColumn[] = (before?.columns ?? []).map((column) => ({
    name: column.name,
    detail: column.type,
    status: status === "dropped" ? ("dropped" as const) : ("same" as const),
    primaryKey: column.isPrimaryKey,
    linked: false,
    focused: false,
  }));
  if (status === "dropped") return columns;

  for (const part of columnParts) {
    const overlay = columnOverlay(part, inFocus);
    // Already applied, the database has the new name; not yet, the old one.
    const index = columns.findIndex((column) => column.name === part.name || (part.from && column.name === part.from));
    if (index === -1) {
      columns.push({ ...overlay, primaryKey: primary.has(part.name) });
      continue;
    }
    const existing = columns[index];
    columns[index] = {
      ...overlay,
      detail: overlay.status === "dropped" ? existing.detail : (overlay.detail ?? existing.detail),
      primaryKey: existing.primaryKey || primary.has(part.name),
    };
  }
  return columns;
}

function columnOverlay(part: Part, inFocus: (versions: string[]) => boolean): DiagramColumn {
  const status: ColumnStatus =
    part.op === "add" ? "added" : part.op === "drop" ? "dropped" : part.op === "rename" ? "renamed" : "changed";
  return {
    name: part.name,
    detail: part.op === "drop" ? undefined : part.detail,
    status,
    ...(part.from !== undefined ? { from: part.from } : {}),
    primaryKey: /\bprimary key\b/.test(part.detail ?? ""),
    linked: false,
    focused: inFocus(part.versions),
  };
}

/** Columns named by a table-level PRIMARY KEY (…) the SQL adds. */
function primaryKeyColumns(parts: Part[]): Set<string> {
  const names = new Set<string>();
  for (const part of parts) {
    if (part.kind !== "constraint" || part.op === "drop") continue;
    const match = /^primary key \(([^)]*)\)/.exec(part.detail ?? "");
    if (match) for (const name of match[1].split(",")) names.add(name.trim().replace(/^"|"$/g, ""));
  }
  return names;
}

function markLinked(table: DiagramTable | undefined, names: string[]): void {
  if (!table) return;
  for (const name of names) {
    const column = table.columns.find((item) => item.name === name);
    if (column) column.linked = true;
  }
}
