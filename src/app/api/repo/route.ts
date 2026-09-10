import { readRepo } from "@/lib/migrations/repo";
import { jsonHandler, requireString } from "../_lib";

type Body = { root?: string };

/** Reads a migrations folder off this machine's disk. No database is touched. */
export const POST = jsonHandler<Body>("repo", async (body) => {
  const root = requireString(body.root, "root");
  return readRepo(root);
});
