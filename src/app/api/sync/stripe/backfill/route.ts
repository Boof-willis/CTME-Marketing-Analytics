import { NextRequest, NextResponse } from "next/server";
import { config, hasGhlWrite, hasStripe } from "@/lib/config";
import { backfillAll } from "@/lib/sync/stripeSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A full-account backfill can take minutes; give it room on platforms that honor it.
export const maxDuration = 300;

// Full retroactive Stripe -> GHL sync. Bulk overwrite, so it DEFAULTS TO DRY RUN:
// pass { "dryRun": false } to actually write. A live run snapshots every touched
// contact first (revert via the snapshot run id). Auth: X-Sync-Secret header.
export async function POST(req: NextRequest) {
  if (!config.sync.secret) {
    return NextResponse.json({ ok: false, error: "sync not configured (SYNC_SECRET unset)" }, { status: 503 });
  }
  if (req.headers.get("x-sync-secret") !== config.sync.secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!hasStripe() || !hasGhlWrite()) {
    return NextResponse.json({ ok: false, error: "Stripe key or GHL write token not configured" }, { status: 503 });
  }

  let body: { dryRun?: boolean } = {};
  try {
    body = req.headers.get("content-length") ? ((await req.json()) as { dryRun?: boolean }) : {};
  } catch {
    body = {};
  }
  const dryRun = body.dryRun !== false; // must explicitly pass false to write
  const runId = dryRun ? undefined : `bf_${Date.now()}`;

  try {
    const summary = await backfillAll({ dryRun, runId });
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error("[sync/stripe/backfill] failed:", err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
