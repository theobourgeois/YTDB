import { syncPullRequest } from "@/lib/releases/read";
import type { ReleasePullRequestAction } from "@/lib/releases/types";
import { jsonHandler, requireString } from "../../_lib";

/** Brings an open pull request's branch up to date with its base on GitHub. */
export const POST = jsonHandler<Partial<ReleasePullRequestAction>>("release.sync", async (body) =>
  syncPullRequest({
    root: requireString(body.root, "root"),
    number: Number(body.number),
    sha: requireString(body.sha, "sha"),
  }),
);
