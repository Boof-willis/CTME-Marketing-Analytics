import { NextRequest, NextResponse } from "next/server";
import { config, hasGhlWrite } from "@/lib/config";
import { ensureFields } from "@/lib/sync/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Provision any missing custom fields the app needs. Schema mutation, so it
// DEFAULTS TO DRY RUN: pass { "dryRun": false } to actually create. Idempotent —
// existing fields are left untouched. Auth: X-Sync-Secret header. Note: creating
// fields requires the write token to hold customFields.write.
export async function POST(req: NextRequest) {
  if (!config.sync.secret) {
    return NextResponse.json({ ok: false, error: "sync not configured (SYNC_SECRET unset)" }, { status: 503 });
  }
  if (req.headers.get("x-sync-secret") !== config.sync.secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!hasGhlWrite()) {
    return NextResponse.json({ ok: false, error: "GHL write token not configured" }, { status: 503 });
  }

  let body: { dryRun?: boolean } = {};
  try {
    body = req.headers.get("content-length") ? ((await req.json()) as { dryRun?: boolean }) : {};
  } catch {
    body = {};
  }
  const dryRun = body.dryRun !== false; // must explicitly pass false to create

  try {
    const report = await ensureFields({ dryRun });
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    console.error("[sync/ensure-fields] failed:", err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
