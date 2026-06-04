import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Lightweight keep-alive endpoint. An external uptime pinger (UptimeRobot,
// cron-job.org, etc.) hits this every ~10 minutes to keep the Render free
// instance from spinning down. Intentionally unauthenticated and does no data
// work, so it's cheap and never touches the access-key gate or upstream APIs.
export function GET() {
  return NextResponse.json(
    { ok: true, time: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
