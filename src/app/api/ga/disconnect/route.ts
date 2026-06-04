import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { clearRefreshToken } from "@/lib/tokenStore";

export const dynamic = "force-dynamic";

// Clears the stored GA4 token (e.g. at handoff, before the new owner connects).
export async function POST(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  if (config.accessKey) {
    const provided = params.get("k") || req.headers.get("x-dashboard-key");
    if (provided !== config.accessKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  await clearRefreshToken();
  return NextResponse.json({ ok: true });
}
