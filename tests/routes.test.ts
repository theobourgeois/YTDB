import { test } from "node:test";
import assert from "node:assert/strict";
import { equivalentHref, parseRoute, routeHref, type Route } from "../src/lib/routes";

test("each migration view is its own path, and reads back as the same route", () => {
  const cases: [string, Route][] = [
    ["/c/migrations", { kind: "migrations", connectionId: "c" }],
    ["/c/migrations/timeline", { kind: "migrations", connectionId: "c", view: "timeline" }],
    ["/c/migrations/repo%3Aapp", { kind: "migration", connectionId: "c", setId: "repo:app" }],
    ["/c/migrations/repo%3Aapp/schema", { kind: "migration", connectionId: "c", setId: "repo:app", view: "schema" }],
    ["/c/migrations/repo%3Aapp/timeline", { kind: "migration", connectionId: "c", setId: "repo:app", view: "timeline" }],
    ["/c/public/users", { kind: "table", connectionId: "c", table: { schema: "public", name: "users" } }],
  ];
  for (const [href, route] of cases) {
    assert.deepEqual(parseRoute(href), route, href);
    assert.equal(routeHref(route), href);
  }
});

test("switching connection keeps the view", () => {
  assert.equal(equivalentHref("/a/migrations/s1/schema", "b"), "/b/migrations/s1/schema");
  assert.equal(equivalentHref("/a/migrations/timeline", "b"), "/b/migrations/timeline");
});
