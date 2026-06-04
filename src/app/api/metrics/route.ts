import { NextRequest, NextResponse } from "next/server";
import { getDashboardData } from "@/lib/sources";
import { parseRange } from "@/lib/dates";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  // Optional shared-secret gate for the embedded iframe.
  if (config.accessKey) {
    const provided = params.get("k") || req.headers.get("x-dashboard-key");
    if (provided !== config.accessKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const range = parseRange(params);
    const data = await getDashboardData(range);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err) {
    console.error("[api/metrics] error:", err);
    return NextResponse.json(
      { error: "Failed to build dashboard data" },
      { status: 500 },
    );
  }
}
