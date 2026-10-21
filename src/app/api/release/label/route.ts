import { setReleaseLabel } from "@/lib/releases/read";
import type { ReleaseLabelRequest } from "@/lib/releases/types";
import { jsonHandler, requireString } from "../../_lib";

/** Marks an open pull request as going out with the next release on GitHub, or unmarks it. */
export const POST = jsonHandler<Partial<ReleaseLabelRequest>>("release.label", async (body) =>
  setReleaseLabel({
    root: requireString(body.root, "root"),
    number: Number(body.number),
    label: requireString(body.label, "label"),
    add: body.add === true,
  }),
);
