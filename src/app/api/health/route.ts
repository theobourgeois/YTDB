export function GET(): Response {
  if (process.env.VERCEL === "1") return Response.json({ error: "Database API is local-only" }, { status: 404 });
  return Response.json({ ok: true, name: "YTDB" });
}
