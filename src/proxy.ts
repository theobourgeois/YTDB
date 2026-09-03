import { NextRequest, NextResponse } from "next/server";

const OFFICIAL_UI_ORIGIN = "https://ytdb.theobourgeois.com";

function corsHeaders(origin: string | null, request: NextRequest): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  });
  if (origin === OFFICIAL_UI_ORIGIN) {
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

  const origin = request.headers.get("origin");
  const sameOrigin = origin === request.nextUrl.origin;
  if (origin && !sameOrigin && origin !== OFFICIAL_UI_ORIGIN) {
    return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
  }

  const headers = corsHeaders(origin, request);
  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers });
  }

  const token = process.env.YTDB_BRIDGE_TOKEN;
  if (token && request.headers.get("authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Invalid bridge session" }, { status: 401, headers });
  }

  const response = NextResponse.next();
  for (const [key, value] of headers) response.headers.set(key, value);
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
