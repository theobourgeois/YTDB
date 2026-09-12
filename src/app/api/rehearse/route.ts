import { rehearseMigrations } from "@/lib/db/migrate";
import type { RehearsalStep } from "@/lib/migrations/types";
import { jsonHandler, requireString } from "../_lib";

type Body = { connectionUrl?: string; rehearsal?: { steps?: unknown } };

const MAX_STEPS = 500;

function toStep(value: unknown, index: number): RehearsalStep {
  if (!value || typeof value !== "object") throw new Error(`steps[${index}] is not an object`);
  const step = value as Partial<RehearsalStep>;
  return {
    version: requireString(step.version, `steps[${index}].version`),
    name: typeof step.name === "string" ? step.name : "",
    sql: requireString(step.sql, `steps[${index}].sql`),
  };
}

/** Runs the steps in one transaction and rolls it back, so nothing changes. */
export const POST = jsonHandler<Body>("rehearse", async (body) => {
  const url = requireString(body.connectionUrl, "connectionUrl");
  const steps = body.rehearsal?.steps;
  if (!Array.isArray(steps) || steps.length === 0) throw new Error("rehearsal.steps must be a non-empty array");
  if (steps.length > MAX_STEPS) throw new Error(`rehearsal.steps is over ${MAX_STEPS}`);
  return rehearseMigrations(url, { steps: steps.map(toStep) });
});
