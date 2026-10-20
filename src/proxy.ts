import { NextRequest, NextResponse } from "next/server";
import { resolveTrustedUiOrigins } from "../ytdb.config.mjs";

// Resolved per request so the origin the CLI passes through the environment is
// read at runtime rather than baked into the build.
function isTrustedUiOrigin(origin: string): boolean {
  return resolveTrustedUiOrigins().has(origin);
}

// A DNS-rebound attacker domain reaches this server under its own Host name. Answering only
// loopback names keeps the bridge to pages served from this machine or the trusted UI.
function isLoopbackHost(host: string | null): boolean {
  if (!host) return false;
  try {
    const { hostname } = new URL(`http://${host}`);
    return ["127.0.0.1", "localhost", "[::1]", "local.ytdb", "local.dbstudio"].includes(hostname);
  } catch {
    return false;
  }
}

function corsHeaders(origin: string | null, request: NextRequest): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  });
  if (origin && isTrustedUiOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  if (request.headers.get("access-control-request-private-network") === "true") {
    headers.set("Access-Control-Allow-Private-Network", "true");
  }
  return headers;
}

export function proxy(request: NextRequest): NextResponse {
  if (!request.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();

  // Vercel serves only the UI. Database access must always happen in the local CLI process.
  if (process.env.VERCEL === "1") {
    return NextResponse.json({ error: "Database API is local-only" }, { status: 404 });
  }

  if (!isLoopbackHost(request.headers.get("host"))) {
    return NextResponse.json({ error: "Host not allowed" }, { status: 403 });
  }

  const origin = request.headers.get("origin");
  const sameOrigin = origin === request.nextUrl.origin;
  if (origin && !sameOrigin && !isTrustedUiOrigin(origin)) {
    return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
  }

  const headers = corsHeaders(origin, request);
  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers });
  }

  const response = NextResponse.next();
  for (const [key, value] of headers) response.headers.set(key, value);
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
