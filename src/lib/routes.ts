import type { TableRef } from "./types";

/** A view of one migration other than its files, each its own page so back and forward reach it. */
export type MigrationView = "schema" | "timeline";

/** Where in the app a pathname points. */
export type Route =
  | { kind: "home" }
  | { kind: "connection"; connectionId: string }
  | { kind: "query"; connectionId: string }
  | { kind: "diff"; connectionId: string }
  | { kind: "migrations"; connectionId: string; view?: "timeline" }
  | { kind: "migration"; connectionId: string; setId: string; view?: MigrationView }
  | { kind: "table"; connectionId: string; table: TableRef };

export function parseRoute(pathname: string): Route {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) return { kind: "home" };
  const [connectionId, second, third, fourth] = parts;
  if (parts.length === 1) return { kind: "connection", connectionId };
  if (parts.length === 2) {
    if (second === "query") return { kind: "query", connectionId };
    if (second === "diff") return { kind: "diff", connectionId };
    if (second === "migrations") return { kind: "migrations", connectionId };
  }
  if (parts.length === 3) {
    if (second === "migrations") {
      if (third === "timeline") return { kind: "migrations", connectionId, view: "timeline" };
      return { kind: "migration", connectionId, setId: third };
    }
    return { kind: "table", connectionId, table: { schema: second, name: third } };
  }
  if (parts.length === 4 && second === "migrations" && (fourth === "schema" || fourth === "timeline")) {
    return { kind: "migration", connectionId, setId: third, view: fourth };
  }
  return { kind: "connection", connectionId };
}

export function routeHref(route: Route): string {
  const enc = encodeURIComponent;
  switch (route.kind) {
    case "home":
      return "/";
    case "connection":
      return `/${enc(route.connectionId)}`;
    case "query":
    case "diff":
      return `/${enc(route.connectionId)}/${route.kind}`;
    case "migrations":
      return `/${enc(route.connectionId)}/migrations${route.view ? `/${route.view}` : ""}`;
    case "migration":
      return `/${enc(route.connectionId)}/migrations/${enc(route.setId)}${route.view ? `/${route.view}` : ""}`;
    case "table":
      return `/${enc(route.connectionId)}/${enc(route.table.schema)}/${enc(route.table.name)}`;
  }
}

/**
 * The same place on another connection. Migration sets and the SQL editor are
 * workspace-wide, so they carry over as they are; a table carries over when the
 * caller says it exists there.
 */
export function equivalentHref(
  pathname: string,
  nextConnectionId: string,
  { tableExists = true }: { tableExists?: boolean } = {},
): string {
  const route = parseRoute(pathname);
  if (route.kind === "home") return routeHref({ kind: "connection", connectionId: nextConnectionId });
  if (route.kind === "table" && !tableExists) {
    return routeHref({ kind: "connection", connectionId: nextConnectionId });
  }
  return routeHref({ ...route, connectionId: nextConnectionId });
}
