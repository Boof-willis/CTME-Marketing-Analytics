import { NextRequest, NextResponse } from "next/server";
import { config, hasGhlWrite } from "@/lib/config";
import { syncCryptoTotals, type CryptoTotals } from "@/lib/sync/cryptoSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Crypto-payments sheet webhook. The sheet's Apps Script sums a contact's crypto
// rows and POSTs the totals here; we match the contact (email -> phone -> name)
// and overwrite the *_crypto_* fields. Auth: shared secret in X-Sync-Secret.
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

  let body: CryptoTotals & { dryRun?: boolean };
  try {
    body = (await req.json()) as CryptoTotals & { dryRun?: boolean };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  try {
    const result = await syncCryptoTotals(body, { dryRun: body.dryRun });
    const status = result.matched ? 200 : 422; // 422 so the sheet can flag unmatched rows
    return NextResponse.json({ ok: result.matched, result }, { status });
  } catch (err) {
    console.error("[sync/crypto] failed:", err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
