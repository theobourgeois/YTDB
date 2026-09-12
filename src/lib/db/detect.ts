import "server-only";
import { extractEvidence, judge, type Catalog, type DetectionResult } from "../migrations/detect";
import { getPool } from "./pool";
import { getSchemaSnapshot } from "./schema-snapshot";

const POLICIES_SQL = `
  SELECT schemaname AS schema, tablename AS table, policyname AS name
  FROM pg_policies
`;

type PolicyRow = { schema: string; table: string; name: string };

/** The database's catalog, indexed the way the evidence checks look things up. */
export async function readCatalog(connectionString: string): Promise<Catalog> {
  const pool = getPool(connectionString);
  const [snapshot, policies] = await Promise.all([
    getSchemaSnapshot(connectionString),
    pool.query<PolicyRow>(POLICIES_SQL),
  ]);

  const catalog: Catalog = {
    schemas: new Set(snapshot.schemas),
    relations: new Set(),
    columns: new Map(),
    constraints: new Set(),
    indexes: new Set(),
    enums: new Map(),
    functions: new Set(),
    policies: new Set(),
    triggers: new Set(),
    extensions: new Set(snapshot.extensions.map((item) => item.name)),
  };

  for (const relation of snapshot.relations) {
    const key = `${relation.schema}.${relation.name}`;
    catalog.relations.add(key);
    for (const column of relation.columns) {
      catalog.columns.set(`${key}.${column.name}`, { notNull: !column.nullable });
    }
    for (const constraint of relation.constraints) catalog.constraints.add(`${key}.${constraint.name}`);
    for (const index of relation.indexes) catalog.indexes.add(`${relation.schema}.${index.name}`);
    for (const trigger of relation.triggers) catalog.triggers.add(`${key}.${trigger.name}`);
  }
  for (const item of snapshot.enums) {
    catalog.enums.set(`${item.schema}.${item.name}`, new Set(item.labels));
  }
  for (const item of snapshot.functions) catalog.functions.add(`${item.schema}.${item.name}`);
  for (const row of policies.rows) catalog.policies.add(`${row.schema}.${row.table}.${row.name}`);

  return catalog;
}

export type DetectInput = { setName: string; version: string; sql: string };

/**
 * Reads the catalog once and judges every migration against it, so a whole
 * folder is checked in the time it takes to read one database's structure.
 */
export async function detectApplied(
  connectionString: string,
  migrations: DetectInput[],
): Promise<DetectionResult[]> {
  const catalog = await readCatalog(connectionString);
  return migrations.map((migration) => ({
    setName: migration.setName,
    version: migration.version,
    ...judge(extractEvidence(migration.sql), catalog),
  }));
}
