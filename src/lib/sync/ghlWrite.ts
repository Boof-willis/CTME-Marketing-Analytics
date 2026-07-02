import { config } from "../config";
import { resolveCustomFieldIds, normFieldKey } from "../sources/ghl";

// -----------------------------------------------------------------------------
// GHL write layer — the single place the merged app mutates contacts.
//
// Two responsibilities, shared by both write sources (Stripe + crypto sheet):
//   1. matchContact(): resolve a payment identity to a GHL contact by
//      email -> phone -> name (first hit wins).
//   2. writeFields(): overwrite money custom fields by KEY (resolved to ids at
//      runtime), using the confirmed GHL payload shape { id, value }.
//
// Everything here uses config.ghl.writeToken (a write-capable Private
// Integration token), keeping the dashboard's read token untouched.
// -----------------------------------------------------------------------------

const BASE = config.ghl.base;
const MAX_RETRIES = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function headers() {
  return {
    Authorization: `Bearer ${config.ghl.writeToken}`,
    Version: "2021-07-28",
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function ghlW<T>(path: string, init?: RequestInit, attempt = 0): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, { ...init, headers: headers(), cache: "no-store" });
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      await sleep(300 * 2 ** attempt + Math.random() * 200);
      return ghlW<T>(path, init, attempt + 1);
    }
    throw err;
  }
  if (!res.ok) {
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(retryAfter ? retryAfter * 1000 : 300 * 2 ** attempt + Math.random() * 200);
      return ghlW<T>(path, init, attempt + 1);
    }
    throw new Error(`GHL ${path} -> ${res.status} ${await res.text()}`);
  }
  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

export interface GhlContact {
  id: string;
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  contactName?: string | null;
  customFields?: { id: string; value?: unknown }[];
}

export interface MatchInput {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
}

/** Phone formats to try against GHL (which stores E.164): as-entered, +digits,
 *  US +1XXXXXXXXXX, and bare digits. */
function phoneVariants(phone?: string | null): string[] {
  const raw = String(phone ?? "").trim();
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return [];
  const out: string[] = [];
  const add = (v: string) => {
    if (v && !out.includes(v)) out.push(v);
  };
  add(raw);
  add("+" + digits);
  if (digits.length === 10) add("+1" + digits);
  add(digits);
  return out;
}

async function searchDuplicate(param: "email" | "number" | "phone", value: string): Promise<GhlContact | null> {
  try {
    const r = await ghlW<{ contact?: GhlContact }>(
      `/contacts/search/duplicate?locationId=${config.ghl.locationId}&${param}=${encodeURIComponent(value)}`,
    );
    return r.contact && r.contact.id ? r.contact : null;
  } catch {
    return null;
  }
}

/** Resolve a payment identity to a GHL contact: email -> phone -> name. */
export async function matchContact(input: MatchInput): Promise<GhlContact | null> {
  const email = String(input.email ?? "").toLowerCase().trim();
  const name = String(input.name ?? "").trim();

  // 1) Email (exact).
  if (email) {
    const hit = await searchDuplicate("email", email);
    if (hit) return hit;
  }

  // 2) Phone — try each format and both param names GHL has used.
  for (const variant of phoneVariants(input.phone)) {
    for (const param of ["number", "phone"] as const) {
      const hit = await searchDuplicate(param, variant);
      if (hit) return hit;
    }
  }

  // 3) Name (last resort), disambiguated by email / last-10 phone digits.
  if (name) {
    try {
      const r = await ghlW<{ contacts?: GhlContact[] }>("/contacts/search", {
        method: "POST",
        body: JSON.stringify({ locationId: config.ghl.locationId, pageLimit: 10, query: name }),
      });
      const arr = r.contacts || [];
      if (arr.length === 1) return arr[0];
      if (arr.length > 1) {
        const pdigits = String(input.phone ?? "").replace(/[^0-9]/g, "").slice(-10);
        const hit = arr.find((c) => {
          const ce = String(c.email ?? "").toLowerCase().trim();
          const cp = String(c.phone ?? "").replace(/[^0-9]/g, "").slice(-10);
          return (email && ce === email) || (pdigits && cp && cp === pdigits);
        });
        if (hit) return hit;
        console.warn(`[sync] ambiguous name match for "${name}" (${arr.length} hits) — skipping to avoid a wrong write`);
        return null; // don't guess on money — safer to skip than mis-attribute
      }
    } catch {
      // fall through to no-match
    }
  }
  return null;
}

/** Read one numeric custom-field value (by key) out of an already-fetched
 *  id->value map. Used to read the OTHER rail's stored count when computing a
 *  combined total, without an extra API call. */
export async function fieldValueNumber(byId: Record<string, unknown>, key: string): Promise<number> {
  const ids = await resolveCustomFieldIds();
  const id = ids.get(normFieldKey(key));
  if (!id) return 0;
  const n = parseFloat(String(byId[id] ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Read a contact's current custom-field values keyed by field id (for snapshots). */
export async function readContactFieldValues(contactId: string): Promise<{ email: string | null; byId: Record<string, unknown> }> {
  const r = await ghlW<{ contact?: GhlContact }>(`/contacts/${contactId}`);
  const c = r.contact;
  const byId: Record<string, unknown> = {};
  for (const f of c?.customFields || []) if (f && f.id != null) byId[String(f.id)] = f.value;
  return { email: c?.email ?? null, byId };
}

export interface WriteResult {
  contactId: string;
  written: boolean;
  fields: { key: string; value: number | string }[];
  missingKeys: string[];
}

/** Overwrite the given money fields (by KEY) on a contact. Resolves keys->ids,
 *  drops any key not present in this location (reported in missingKeys), and
 *  PUTs { customFields: [{ id, value }] }. dryRun returns the payload unwritten. */
export async function writeFields(
  contactId: string,
  fieldsByKey: Record<string, number | string>,
  opts: { dryRun?: boolean } = {},
): Promise<WriteResult> {
  const ids = await resolveCustomFieldIds();
  const customFields: { id: string; value: number | string }[] = [];
  const applied: { key: string; value: number | string }[] = [];
  const missingKeys: string[] = [];

  for (const [key, value] of Object.entries(fieldsByKey)) {
    const id = ids.get(normFieldKey(key));
    if (id) {
      customFields.push({ id, value });
      applied.push({ key, value });
    } else {
      missingKeys.push(key);
    }
  }
  if (missingKeys.length) {
    console.warn(`[sync] contact ${contactId}: unresolved field keys ${missingKeys.join(", ")}`);
  }

  if (!opts.dryRun && customFields.length) {
    await ghlW(`/contacts/${contactId}`, { method: "PUT", body: JSON.stringify({ customFields }) });
  }
  return { contactId, written: !opts.dryRun && customFields.length > 0, fields: applied, missingKeys };
}

/** Create a custom field on the contact object. Returns the GHL-generated key
 *  (without the "contact." prefix) so the caller can verify it matches. Requires
 *  the write token to hold customFields.write. */
export async function createCustomField(input: {
  name: string;
  dataType: string;
  parentId?: string;
}): Promise<{ id: string; fieldKey: string }> {
  const r = await ghlW<{ customField?: { id: string; fieldKey?: string } }>(
    `/locations/${config.ghl.locationId}/customFields`,
    {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        dataType: input.dataType,
        model: "contact",
        ...(input.parentId ? { parentId: input.parentId } : {}),
      }),
    },
  );
  const f = r.customField || (r as { id?: string; fieldKey?: string });
  return {
    id: String((f as { id?: string }).id || ""),
    fieldKey: String((f as { fieldKey?: string }).fieldKey || "").replace(/^contact\./i, ""),
  };
}

/** Write raw { id, value } custom-field entries (used by revert to restore a
 *  snapshot by field id rather than key). */
export async function writeRawFields(
  contactId: string,
  customFields: { id: string; value: unknown }[],
): Promise<void> {
  if (!customFields.length) return;
  await ghlW(`/contacts/${contactId}`, { method: "PUT", body: JSON.stringify({ customFields }) });
}
