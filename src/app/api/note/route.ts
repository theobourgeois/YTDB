import { writeNote } from "@/lib/migrations/repo";
import { jsonHandler, requireString } from "../_lib";

type Body = { root?: string; path?: string; note?: unknown };

/** Writes a folder migration's note beside its SQL. No database is touched. */
export const POST = jsonHandler<Body>("note", async (body) => {
  const root = requireString(body.root, "root");
  const path = requireString(body.path, "path");
  if (typeof body.note !== "string") throw new Error("Missing note");
  return writeNote(root, path, body.note);
});
