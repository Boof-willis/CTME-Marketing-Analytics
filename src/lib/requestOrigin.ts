import type { NextRequest } from "next/server";

// Resolve the app's PUBLIC origin (scheme + host) for building OAuth redirect
// URIs. Behind a proxy (Render, Vercel, etc.) the server binds to an internal
// host like localhost:10000, so req.nextUrl.origin is wrong. We prefer the
// X-Forwarded-* headers the proxy sets, then fall back to the Host header, then
// to nextUrl.origin. Values can be comma-separated lists — take the first.
export function publicOrigin(req: NextRequest): string {
  const first = (v: string | null): string => (v || "").split(",")[0].trim();

  const host = first(req.headers.get("x-forwarded-host")) || first(req.headers.get("host"));
  const proto = first(req.headers.get("x-forwarded-proto")) || "https";

  if (host) return `${proto}://${host}`;
  return req.nextUrl.origin;
}
