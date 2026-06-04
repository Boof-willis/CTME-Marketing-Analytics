import { NextRequest, NextResponse } from "next/server";
import { config, gaConfigured } from "@/lib/config";

export const dynamic = "force-dynamic";

// Kicks off the GA4 OAuth consent flow. Whoever completes it becomes the owner
// of the stored refresh token, so the connection survives a change of agency.
export function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  if (config.accessKey) {
    const provided = params.get("k") || req.headers.get("x-dashboard-key");
    if (provided !== config.accessKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!gaConfigured()) {
    return NextResponse.json(
      { error: "GA4 OAuth client is not configured (set GA4_OAUTH_CLIENT_ID / SECRET / GA4_PROPERTY_ID)." },
      { status: 400 },
    );
  }

  const origin = req.nextUrl.origin;
  const redirectUri = config.ga4.redirectUri || `${origin}/api/ga/callback`;

  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", config.ga4.oauthClientId);
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", "https://www.googleapis.com/auth/analytics.readonly");
  // offline + consent guarantees a refresh token is returned every time.
  auth.searchParams.set("access_type", "offline");
  auth.searchParams.set("prompt", "consent");
  auth.searchParams.set("include_granted_scopes", "true");
  // Round-trip the access key so the callback can bounce back into the embed.
  if (config.accessKey) auth.searchParams.set("state", params.get("k") || "");

  return NextResponse.redirect(auth.toString());
}
