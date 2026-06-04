import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { setRefreshToken } from "@/lib/tokenStore";
import { publicOrigin } from "@/lib/requestOrigin";

export const dynamic = "force-dynamic";

// Receives the OAuth code, exchanges it for a refresh token and stores it, then
// bounces back to the Web Analytics view.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const origin = publicOrigin(req);
  const state = params.get("state") || "";
  const back = (status: string) => {
    const u = new URL("/", origin);
    u.searchParams.set("view", "analytics");
    u.searchParams.set("ga", status);
    if (state) u.searchParams.set("k", state);
    return NextResponse.redirect(u.toString());
  };

  const error = params.get("error");
  if (error) return back("error");
  const code = params.get("code");
  if (!code) return back("error");

  try {
    const redirectUri = config.ga4.redirectUri || `${origin}/api/ga/callback`;
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.ga4.oauthClientId,
        client_secret: config.ga4.oauthClientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("[api/ga/callback] token exchange failed:", await res.text());
      return back("error");
    }
    const json = (await res.json()) as { refresh_token?: string };
    if (!json.refresh_token) {
      // No refresh token (e.g. user previously consented). Ask them to retry —
      // prompt=consent on /connect should normally force one.
      return back("noref");
    }
    await setRefreshToken(json.refresh_token);
    return back("connected");
  } catch (err) {
    console.error("[api/ga/callback] error:", err);
    return back("error");
  }
}
