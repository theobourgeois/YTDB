import { columnDefinition, sameSql } from "./schema-ddl";
import type {
  RelationKind,
  SchemaSnapshot,
  SnapshotColumn,
  SnapshotEnum,
  SnapshotExtension,
  SnapshotFunction,
  SnapshotNamedSql,
  SnapshotRelation,
} from "./types";

/**
 * A difference is always described from the source database's point of view:
 * `added` exists in source and not in target, so applying the migration creates it.
 */
export type DiffStatus = "added" | "removed" | "modified";

export type DiffCategory = "extension" | "schema" | "enum" | "relation" | "function";

export type DetailGroup =
  | "column"
  | "constraint"
  | "index"
  | "trigger"
  | "definition"
  | "property"
  | "value";

export type DiffDetail = {
  id: string;
  group: DetailGroup;
  name: string;
  status: DiffStatus;
  /** How the object reads on that side, or null when it is absent there. */
  source: string | null;
  target: string | null;
};

type DiffBase = {
  id: string;
  schema: string | null;
  name: string;
  /** Qualified name as shown in the UI. */
  label: string;
  status: DiffStatus;
  details: DiffDetail[];
};

export type DiffObject =
  | (DiffBase & {
      category: "extension";
      source?: SnapshotExtension;
      target?: SnapshotExtension;
    })
  | (DiffBase & { category: "schema" })
  | (DiffBase & { category: "enum"; source?: SnapshotEnum; target?: SnapshotEnum })
  | (DiffBase & {
      category: "relation";
      kind: RelationKind;
      source?: SnapshotRelation;
      target?: SnapshotRelation;
    })
  | (DiffBase & { category: "function"; source?: SnapshotFunction; target?: SnapshotFunction });

export type SchemaDiff = {
  objects: DiffObject[];
  counts: { added: number; removed: number; modified: number; total: number };
};

const CATEGORY_ORDER: Record<DiffCategory, number> = {
  extension: 0,
  schema: 1,
  enum: 2,
  relation: 3,
  function: 4,
};

/** Compares two snapshots, listing what the target is missing or has extra. */
export function diffSnapshots(source: SchemaSnapshot, target: SchemaSnapshot): SchemaDiff {
  const objects: DiffObject[] = [
    ...diffExtensions(source.extensions, target.extensions),
    ...diffSchemas(source.schemas, target.schemas),
    ...diffEnums(source.enums, target.enums),
    ...diffRelations(source.relations, target.relations),
    ...diffFunctions(source.functions, target.functions),
  ];

  objects.sort(
    (left, right) =>
      CATEGORY_ORDER[left.category] - CATEGORY_ORDER[right.category] ||
      (left.schema ?? "").localeCompare(right.schema ?? "") ||
      left.name.localeCompare(right.name),
  );

  const counts = { added: 0, removed: 0, modified: 0, total: objects.length };
  for (const object of objects) counts[object.status] += 1;
  return { objects, counts };
}

/** Every schema mentioned by the diff, for the schema filter. */
export function diffSchemaNames(diff: SchemaDiff): string[] {
  const names = new Set<string>();
  for (const object of diff.objects) {
    if (object.schema) names.add(object.schema);
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

export function filterDiff(
  diff: SchemaDiff,
  { search, schemas }: { search: string; schemas: string[] | null },
): DiffObject[] {
  const needle = search.trim().toLocaleLowerCase();
  return diff.objects.filter((object) => {
    if (schemas !== null && object.schema !== null && !schemas.includes(object.schema)) {
      return false;
    }
    if (!needle) return true;
    if (object.label.toLocaleLowerCase().includes(needle)) return true;
    return object.details.some((detail) => detail.name.toLocaleLowerCase().includes(needle));
  });
}

type Pair<T> = { key: string; source?: T; target?: T };

function pairBy<T>(source: T[], target: T[], key: (item: T) => string): Pair<T>[] {
  const pairs = new Map<string, Pair<T>>();
  for (const item of source) {
    pairs.set(key(item), { key: key(item), source: item });
  }
  for (const item of target) {
    const existing = pairs.get(key(item));
    if (existing) existing.target = item;
    else pairs.set(key(item), { key: key(item), target: item });
  }
  return [...pairs.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function diffExtensions(source: SnapshotExtension[], target: SnapshotExtension[]): DiffObject[] {
  return pairBy(source, target, (item) => item.name).flatMap((pair) => {
    const details: DiffDetail[] = [];
    if (pair.source && pair.target) {
      if (pair.source.version !== pair.target.version) {
        details.push({
          id: `${pair.key}:version`,
          group: "property",
          name: "version",
          status: "modified",
          source: pair.source.version,
          target: pair.target.version,
        });
      }
      if (pair.source.schema !== pair.target.schema) {
        details.push({
          id: `${pair.key}:schema`,
          group: "property",
          name: "schema",
          status: "modified",
          source: pair.source.schema,
          target: pair.target.schema,
        });
      }
      if (details.length === 0) return [];
    }
    return [
      {
        id: `extension:${pair.key}`,
        category: "extension" as const,
        schema: null,
        name: pair.key,
        label: pair.key,
        status: statusOf(pair),
        details,
        source: pair.source,
        target: pair.target,
      },
    ];
  });
}

function diffSchemas(source: string[], target: string[]): DiffObject[] {
  return pairBy(
    source.map((name) => ({ name })),
    target.map((name) => ({ name })),
    (item) => item.name,
  ).flatMap((pair) => {
    if (pair.source && pair.target) return [];
    return [
      {
        id: `schema:${pair.key}`,
        category: "schema" as const,
        schema: pair.key,
        name: pair.key,
        label: pair.key,
        status: statusOf(pair),
        details: [],
      },
    ];
  });
}

function diffEnums(source: SnapshotEnum[], target: SnapshotEnum[]): DiffObject[] {
  return pairBy(source, target, (item) => `${item.schema}.${item.name}`).flatMap((pair) => {
    const details: DiffDetail[] = [];
    if (pair.source && pair.target) {
      for (const label of pair.source.labels) {
        if (!pair.target.labels.includes(label)) {
          details.push(valueDetail(pair.key, label, "added"));
        }
      }
      for (const label of pair.target.labels) {
        if (!pair.source.labels.includes(label)) {
          details.push(valueDetail(pair.key, label, "removed"));
        }
      }
      if (details.length === 0) return [];
    }
    const object = pair.source ?? pair.target;
    if (!object) return [];
    return [
      {
        id: `enum:${pair.key}`,
        category: "enum" as const,
        schema: object.schema,
        name: object.name,
        label: pair.key,
        status: statusOf(pair),
        details,
        source: pair.source,
        target: pair.target,
      },
    ];
  });
}

function valueDetail(key: string, label: string, status: DiffStatus): DiffDetail {
  return {
    id: `${key}:value:${label}`,
    group: "value",
    name: label,
    status,
    source: status === "added" ? label : null,
    target: status === "removed" ? label : null,
  };
}

function diffRelations(source: SnapshotRelation[], target: SnapshotRelation[]): DiffObject[] {
  return pairBy(source, target, (item) => `${item.schema}.${item.name}`).flatMap((pair) => {
    const details = pair.source && pair.target ? relationDetails(pair.source, pair.target) : [];
    if (pair.source && pair.target && details.length === 0) return [];
    const object = pair.source ?? pair.target;
    if (!object) return [];
    return [
      {
        id: `relation:${pair.key}`,
        category: "relation" as const,
        kind: object.kind,
        schema: object.schema,
        name: object.name,
        label: pair.key,
        status: statusOf(pair),
        details,
        source: pair.source,
        target: pair.target,
      },
    ];
  });
}

function relationDetails(source: SnapshotRelation, target: SnapshotRelation): DiffDetail[] {
  const key = `${source.schema}.${source.name}`;
  const details: DiffDetail[] = [];

  if (source.kind !== target.kind) {
    details.push(property(key, "kind", source.kind, target.kind));
  }
  if (source.unlogged !== target.unlogged) {
    details.push(
      property(key, "persistence", source.unlogged ? "unlogged" : "logged", target.unlogged ? "unlogged" : "logged"),
    );
  }
  if ((source.partitionBy ?? "") !== (target.partitionBy ?? "")) {
    details.push(property(key, "partition by", source.partitionBy ?? "none", target.partitionBy ?? "none"));
  }
  if (!sameSql(source.viewSql, target.viewSql)) {
    details.push({
      id: `${key}:definition`,
      group: "definition",
      name: source.kind === "materialized view" ? "materialized view body" : "view body",
      status: "modified",
      source: source.viewSql ?? null,
      target: target.viewSql ?? null,
    });
  }

  for (const pair of pairBy(source.columns, target.columns, (column) => column.name)) {
    const detail = columnDetail(key, pair, source.name, target.name);
    if (detail) details.push(detail);
  }
  details.push(...namedSqlDetails(key, "constraint", source.constraints, target.constraints));
  details.push(...namedSqlDetails(key, "index", source.indexes, target.indexes));
  details.push(...namedSqlDetails(key, "trigger", source.triggers, target.triggers));

  return details;
}

function columnDetail(
  key: string,
  pair: Pair<SnapshotColumn>,
  sourceRelation: string,
  targetRelation: string,
): DiffDetail | null {
  const source = pair.source ? columnDefinition(pair.source, sourceRelation) : null;
  const target = pair.target ? columnDefinition(pair.target, targetRelation) : null;
  if (source !== null && target !== null && source === target) return null;
  return {
    id: `${key}:column:${pair.key}`,
    group: "column",
    name: pair.key,
    status: statusOf(pair),
    source,
    target,
  };
}

function namedSqlDetails(
  key: string,
  group: Extract<DetailGroup, "constraint" | "index" | "trigger">,
  source: SnapshotNamedSql[],
  target: SnapshotNamedSql[],
): DiffDetail[] {
  return pairBy(source, target, (item) => item.name).flatMap((pair) => {
    if (pair.source && pair.target && sameSql(pair.source.sql, pair.target.sql)) return [];
    return [
      {
        id: `${key}:${group}:${pair.key}`,
        group,
        name: pair.key,
        status: statusOf(pair),
        source: pair.source?.sql ?? null,
        target: pair.target?.sql ?? null,
      },
    ];
  });
}

function diffFunctions(source: SnapshotFunction[], target: SnapshotFunction[]): DiffObject[] {
  return pairBy(source, target, (item) => `${item.schema}.${item.name}(${item.args})`).flatMap(
    (pair) => {
      const details: DiffDetail[] = [];
      if (pair.source && pair.target) {
        if (sameSql(pair.source.sql, pair.target.sql)) return [];
        details.push({
          id: `${pair.key}:definition`,
          group: "definition",
          name: "body",
          status: "modified",
          source: pair.source.sql,
          target: pair.target.sql,
        });
      }
      const object = pair.source ?? pair.target;
      if (!object) return [];
      return [
        {
          id: `function:${pair.key}`,
          category: "function" as const,
          schema: object.schema,
          name: `${object.name}(${object.args})`,
          label: pair.key,
          status: statusOf(pair),
          details,
          source: pair.source,
          target: pair.target,
        },
      ];
    },
  );
}

function property(key: string, name: string, source: string, target: string): DiffDetail {
  return {
    id: `${key}:property:${name}`,
    group: "property",
    name,
    status: "modified",
    source,
    target,
  };
}

function statusOf<T>(pair: Pair<T>): DiffStatus {
  if (pair.source && pair.target) return "modified";
  return pair.source ? "added" : "removed";
}
