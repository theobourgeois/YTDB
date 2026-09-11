import { readRepo } from "@/lib/migrations/repo";
import { jsonHandler, requireString } from "../_lib";

type Body = { root?: string; checkout?: string | null };

/**
 * Reads a migrations folder off this machine's disk — from another worktree of
 * the same repository, when `checkout` names one. No database is touched.
 */
export const POST = jsonHandler<Body>("repo", async (body) => {
  const root = requireString(body.root, "root");
  return readRepo(root, typeof body.checkout === "string" ? body.checkout : null);
});
