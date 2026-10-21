import { mergePullRequest } from "@/lib/releases/read";
import type { ReleasePullRequestAction } from "@/lib/releases/types";
import { jsonHandler, requireString } from "../../_lib";

/** Merges an open pull request on GitHub, at the commit the release page showed. */
export const POST = jsonHandler<Partial<ReleasePullRequestAction>>("release.merge", async (body) =>
  mergePullRequest({
    root: requireString(body.root, "root"),
    number: Number(body.number),
    sha: requireString(body.sha, "sha"),
  }),
);
