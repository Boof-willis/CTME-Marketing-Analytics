import { config } from "../config";
import { readContactFieldValues } from "./ghlWrite";

// -----------------------------------------------------------------------------
// Pre-write snapshots for revert safety, stored in Upstash (Render's filesystem
// is ephemeral, so the standalone app's local-CSV snapshots don't survive here).
//
// A backfill run captures each touched contact's PRIOR custom-field values under
// a run id; the revert endpoint restores them. Best-effort: if Upstash isn't
// configured the snapshot is skipped (logged), and the caller can still dry-run
// first for safety.
// -----------------------------------------------------------------------------

function kvConfigured(): boolean {
  return Boolean(config.kv.upstashUrl && config.kv.upstashToken);
}

async function upstash(command: (string | number)[]): Promise<unknown> {
  const res = await fetch(config.kv.upstashUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.kv.upstashToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Upstash ${command[0]} failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { result: unknown }).result;
}

export interface SnapshotRow {
  contactId: string;
  email: string | null;
  /** Prior custom-field values keyed by field id. */
  byId: Record<string, unknown>;
}

const keyOf = (runId: string) => `sync:snapshot:${runId}`;
const TTL_SECONDS = 30 * 24 * 60 * 60; // keep snapshots 30 days

/** Capture prior values for a contact so a run can be reverted. */
export async function snapshotContact(contactId: string): Promise<SnapshotRow> {
  const { email, byId } = await readContactFieldValues(contactId);
  return { contactId, email, byId };
}

/** Persist a run's snapshot rows (best-effort; no-op without Upstash). */
export async function saveSnapshot(runId: string, rows: SnapshotRow[]): Promise<boolean> {
  if (!kvConfigured() || rows.length === 0) return false;
  try {
    await upstash(["SET", keyOf(runId), JSON.stringify(rows)]);
    await upstash(["EXPIRE", keyOf(runId), TTL_SECONDS]);
    return true;
  } catch (err) {
    console.warn("[sync] snapshot save failed:", (err as Error).message);
    return false;
  }
}

export async function getSnapshot(runId: string): Promise<SnapshotRow[] | null> {
  if (!kvConfigured()) return null;
  try {
    const raw = await upstash(["GET", keyOf(runId)]);
    return typeof raw === "string" ? (JSON.parse(raw) as SnapshotRow[]) : null;
  } catch (err) {
    console.warn("[sync] snapshot get failed:", (err as Error).message);
    return null;
  }
}
