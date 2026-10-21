import { readRelease } from "@/lib/releases/read";
import type { ReleaseRequest } from "@/lib/releases/types";
import { jsonHandler, requireString } from "../_lib";

/**
 * Compares two branches of the repository a migrations folder is in, with the
 * pull requests GitHub has for them. Reads git and the GitHub CLI on this
 * machine; no database is touched.
 */
export const POST = jsonHandler<Partial<ReleaseRequest>>("release", async (body) =>
  readRelease({
    root: requireString(body.root, "root"),
    base: requireString(body.base, "base"),
    head: requireString(body.head, "head"),
    label: typeof body.label === "string" ? body.label : "",
    pinned: Array.isArray(body.pinned) ? body.pinned : [],
    migrations: body.migrations !== false,
  }),
);
