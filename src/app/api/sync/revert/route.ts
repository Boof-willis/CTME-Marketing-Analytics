import { NextRequest, NextResponse } from "next/server";
import { config, hasGhlWrite } from "@/lib/config";
import { getSnapshot } from "@/lib/sync/snapshot";
import { writeRawFields } from "@/lib/sync/ghlWrite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Restore every touched contact's custom fields to the values captured before a
// backfill run. Pass { "runId": "bf_..." } (the id a live backfill returns).
// Auth: X-Sync-Secret header.
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

  let runId = "";
  try {
    runId = ((await req.json()) as { runId?: string }).runId || "";
  } catch {
    /* ignore */
  }
  if (!runId) return NextResponse.json({ ok: false, error: "runId required" }, { status: 400 });

  const rows = await getSnapshot(runId);
  if (!rows) return NextResponse.json({ ok: false, error: `no snapshot for ${runId}` }, { status: 404 });

  let restored = 0;
  const errors: { contactId: string; error: string }[] = [];
  for (const row of rows) {
    try {
      const customFields = Object.entries(row.byId).map(([id, value]) => ({ id, value: value ?? "" }));
      await writeRawFields(row.contactId, customFields);
      restored += 1;
    } catch (err) {
      errors.push({ contactId: row.contactId, error: (err as Error).message });
    }
  }
  return NextResponse.json({ ok: true, runId, restored, total: rows.length, errors });
}
