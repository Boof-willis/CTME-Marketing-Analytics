import Stripe from "stripe";
import { config } from "../config";
import { getFxRate } from "./fx";
import { matchContact, writeFields, readContactFieldValues, fieldValueNumber, type WriteResult } from "./ghlWrite";
import { snapshotContact, saveSnapshot, type SnapshotRow } from "./snapshot";
import { renderHistory, type HistoryRow } from "./history";

// -----------------------------------------------------------------------------
// Stripe -> GHL money sync (the "card rail").
//
// Source of truth for card money. Aggregates succeeded charges by email into
// per-year + lifetime GROSS revenue, REFUNDS (accrual basis: a refund reduces
// the original charge's year), and PURCHASE COUNTS, plus open-invoice pending
// totals. Writes them onto the matched GHL contact by field KEY.
//
// Single-rail rule: this writes ONLY the non-crypto money fields. Crypto money
// lives in the *_crypto_* fields, written from the sheet (see crypto route).
// -----------------------------------------------------------------------------

const stripe = new Stripe(config.stripe.secretKey, { apiVersion: "2024-06-20" });
const REPORT = config.sync.reportingCurrency; // e.g. "usd"

type YearMap = Record<number, number>;

interface Entry {
  displayEmail: string;
  name: string | null;
  phone: string | null;
  grossCentsByYear: YearMap;
  refundCentsByYear: YearMap;
  countByYear: YearMap;
  grossCents: number;
  refundCents: number;
  count: number;
  pendingCount: number;
  pendingValueCents: number;
  customerIds: Set<string>;
  /** Dated line-items for the card_payment_history log. */
  items: { ts: number; grossCents: number; refundedCents: number }[];
}

function newEntry(displayEmail: string): Entry {
  return {
    displayEmail,
    name: null,
    phone: null,
    grossCentsByYear: {},
    refundCentsByYear: {},
    countByYear: {},
    grossCents: 0,
    refundCents: 0,
    count: 0,
    pendingCount: 0,
    pendingValueCents: 0,
    customerIds: new Set(),
    items: [],
  };
}

function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

/** Convert a charge's presentment amounts to reporting-currency cents. */
async function chargeToReport(charge: Stripe.Charge): Promise<{ gross: number; refunded: number }> {
  const cur = charge.currency;
  const rate = cur === REPORT ? 1 : await getFxRate(cur, REPORT, charge.created);
  return {
    gross: Math.round((charge.amount || 0) * rate),
    refunded: Math.round((charge.amount_refunded || 0) * rate),
  };
}

function custOf(obj: Stripe.Charge["customer"] | Stripe.Invoice["customer"]) {
  return obj && typeof obj === "object" && !("deleted" in obj) ? (obj as Stripe.Customer) : null;
}

async function applyCharge(entry: Entry, charge: Stripe.Charge): Promise<void> {
  if (charge.status !== "succeeded" || !charge.paid) return;
  const { gross, refunded } = await chargeToReport(charge);
  const year = new Date(charge.created * 1000).getUTCFullYear();
  entry.grossCents += gross;
  entry.refundCents += refunded;
  entry.count += 1;
  entry.grossCentsByYear[year] = (entry.grossCentsByYear[year] || 0) + gross;
  entry.refundCentsByYear[year] = (entry.refundCentsByYear[year] || 0) + refunded;
  entry.countByYear[year] = (entry.countByYear[year] || 0) + 1;
  entry.items.push({ ts: charge.created, grossCents: gross, refundedCents: refunded });
  const c = custOf(charge.customer);
  if (c) {
    entry.customerIds.add(c.id);
    if (!entry.name) entry.name = c.name || null;
    if (!entry.phone) entry.phone = c.phone || null;
  } else if (typeof charge.customer === "string") {
    entry.customerIds.add(charge.customer);
  }
  if (!entry.name) entry.name = charge.billing_details?.name || null;
  if (!entry.phone) entry.phone = charge.billing_details?.phone || null;
}

async function invoiceRemainingCents(inv: Stripe.Invoice): Promise<number> {
  const cur = inv.currency;
  const rate = cur === REPORT ? 1 : await getFxRate(cur, REPORT, inv.created);
  return Math.round((inv.amount_remaining || 0) * rate);
}

// ---- Field payload (single-rail: only non-crypto money fields) --------------
export function fieldsForEntry(entry: Entry): Record<string, number | string> {
  const mf = config.ghl.moneyFields;
  const tpl = config.ghl.moneyFieldTemplates;
  const out: Record<string, number | string> = {};
  out[mf.grossRevenue] = centsToDollars(entry.grossCents);
  out[mf.grossRefund] = centsToDollars(entry.refundCents);
  out[mf.grossPurchases] = entry.count;
  out[mf.lifetimeValue] = centsToDollars(entry.grossCents - entry.refundCents); // net LTV
  out[mf.pendingInvoices] = entry.pendingCount;
  out[mf.pendingInvoiceValue] = centsToDollars(entry.pendingValueCents);
  out[mf.lastSyncedAt] = new Date().toISOString();
  for (const y of config.ghl.moneyYears) {
    out[tpl.revenue.replace("{year}", String(y))] = centsToDollars(entry.grossCentsByYear[y] || 0);
    out[tpl.refund.replace("{year}", String(y))] = centsToDollars(entry.refundCentsByYear[y] || 0);
    out[tpl.purchases.replace("{year}", String(y))] = entry.countByYear[y] || 0;
  }
  const cardRows: HistoryRow[] = entry.items.map((it) => ({
    date: new Date(it.ts * 1000).toISOString().slice(0, 10),
    amount: centsToDollars(it.grossCents),
    refunded: it.refundedCents ? centsToDollars(it.refundedCents) : undefined,
  }));
  out[mf.cardPaymentHistory] = renderHistory(cardRows, "card");
  return out;
}

// Fill the three cross-rail fields on a card-side write: combine this entry's
// card figures with the crypto figures already stored on the contact (read from
// `byId`). Overrides lifetime_value (fieldsForEntry set it card-only) so LTV
// reflects both rails.
async function applyCombined(
  fields: Record<string, number | string>,
  entry: Entry,
  byId: Record<string, unknown>,
): Promise<Record<string, number | string>> {
  const mf = config.ghl.moneyFields;
  const storedCryptoRev = await fieldValueNumber(byId, mf.grossCryptoRevenue);
  const storedCryptoCnt = await fieldValueNumber(byId, mf.grossCryptoPurchases);
  const cardGross = centsToDollars(entry.grossCents);
  const cardNet = centsToDollars(entry.grossCents - entry.refundCents);
  fields[mf.totalTransactions] = entry.count + storedCryptoCnt;
  fields[mf.totalRevenue] = cardGross + storedCryptoRev;
  fields[mf.lifetimeValue] = cardNet + storedCryptoRev; // net card + crypto
  return fields;
}

// ---- Full backfill: single pass over ALL charges + open invoices ------------
export interface SyncSummary {
  matched: number;
  written: number;
  unmatched: { email: string; name: string | null; lifetime: number }[];
  errors: { email: string; error: string }[];
  totalEmails: number;
  runId: string | null;
  dryRun: boolean;
}

async function aggregateAll(): Promise<Map<string, Entry>> {
  const byEmail = new Map<string, Entry>();
  const keyFor = (raw: string) => raw.toLowerCase().trim();

  for await (const charge of stripe.charges.list({ limit: 100, expand: ["data.customer"] })) {
    const c = custOf(charge.customer);
    const rawEmail = c?.email || charge.billing_details?.email || charge.receipt_email;
    if (!rawEmail) continue;
    const key = keyFor(rawEmail);
    let entry = byEmail.get(key);
    if (!entry) {
      entry = newEntry(rawEmail);
      byEmail.set(key, entry);
    }
    await applyCharge(entry, charge);
  }

  for await (const inv of stripe.invoices.list({ status: "open", limit: 100, expand: ["data.customer"] })) {
    const c = custOf(inv.customer);
    const rawEmail = c?.email || inv.customer_email;
    if (!rawEmail) continue;
    const key = keyFor(rawEmail);
    let entry = byEmail.get(key);
    if (!entry) {
      entry = newEntry(rawEmail);
      byEmail.set(key, entry);
    }
    entry.pendingCount += 1;
    entry.pendingValueCents += await invoiceRemainingCents(inv);
    if (c && !entry.phone) entry.phone = c.phone || null;
    if (c && !entry.name) entry.name = c.name || null;
  }

  return byEmail;
}

/** Full retroactive sync of every paying/pending email to GHL. */
export async function backfillAll(opts: { dryRun?: boolean; runId?: string } = {}): Promise<SyncSummary> {
  const dryRun = opts.dryRun ?? config.sync.dryRunDefault;
  const byEmail = await aggregateAll();
  const summary: SyncSummary = {
    matched: 0,
    written: 0,
    unmatched: [],
    errors: [],
    totalEmails: byEmail.size,
    runId: opts.runId || null,
    dryRun,
  };
  const snapshots: SnapshotRow[] = [];

  for (const entry of byEmail.values()) {
    try {
      const contact = await matchContact({ email: entry.displayEmail, phone: entry.phone, name: entry.name });
      if (!contact) {
        summary.unmatched.push({
          email: entry.displayEmail,
          name: entry.name,
          lifetime: centsToDollars(entry.grossCents - entry.refundCents),
        });
        continue;
      }
      summary.matched += 1;
      if (!dryRun) {
        const snap = await snapshotContact(contact.id);
        snapshots.push(snap);
        // Combine with the crypto figures already stored on the contact (read
        // from the snapshot we just took — no extra API call).
        const fields = await applyCombined(fieldsForEntry(entry), entry, snap.byId);
        const res: WriteResult = await writeFields(contact.id, fields);
        if (res.written) summary.written += 1;
      }
    } catch (err) {
      summary.errors.push({ email: entry.displayEmail, error: (err as Error).message });
    }
  }

  if (!dryRun && opts.runId && snapshots.length) {
    await saveSnapshot(opts.runId, snapshots);
  }
  return summary;
}

// ---- Scoped recompute for one email (webhook path) --------------------------
export interface RecomputeResult {
  email: string;
  matched: boolean;
  written: boolean;
  reason?: string;
  contactId?: string;
  lifetime?: number;
}

/** Recompute one email's card totals from Stripe (across ALL customer records
 *  sharing that email) and write to GHL. Idempotent. */
export async function recomputeForEmail(email: string, opts: { dryRun?: boolean } = {}): Promise<RecomputeResult> {
  const dryRun = opts.dryRun ?? config.sync.dryRunDefault;
  const lowered = email.toLowerCase().trim();
  if (!lowered) return { email, matched: false, written: false, reason: "no_email" };

  const entry = newEntry(email);
  // An email can map to multiple Stripe customers — sum them all.
  const search = await stripe.customers.search({ query: `email:'${lowered}'`, limit: 100 });
  if (search.data.length === 0) return { email, matched: false, written: false, reason: "no_stripe_customer" };

  for (const cust of search.data) {
    entry.customerIds.add(cust.id);
    if (!entry.name) entry.name = cust.name || null;
    if (!entry.phone) entry.phone = cust.phone || null;
    for await (const charge of stripe.charges.list({ customer: cust.id, limit: 100 })) {
      await applyCharge(entry, charge);
    }
    for await (const inv of stripe.invoices.list({ customer: cust.id, status: "open", limit: 100 })) {
      entry.pendingCount += 1;
      entry.pendingValueCents += await invoiceRemainingCents(inv);
    }
  }

  const contact = await matchContact({ email: entry.displayEmail, phone: entry.phone, name: entry.name });
  if (!contact) return { email, matched: false, written: false, reason: "no_ghl_contact" };

  if (!dryRun) {
    const { byId } = await readContactFieldValues(contact.id);
    const fields = await applyCombined(fieldsForEntry(entry), entry, byId);
    await writeFields(contact.id, fields);
  }
  return {
    email,
    matched: true,
    written: !dryRun,
    contactId: contact.id,
    lifetime: centsToDollars(entry.grossCents - entry.refundCents),
  };
}

/** Resolve a Stripe customer id to its email (for the webhook). */
export async function emailForCustomer(customerId: string): Promise<string | null> {
  try {
    const cust = await stripe.customers.retrieve(customerId);
    if (cust && !("deleted" in cust)) return cust.email ?? null;
  } catch (err) {
    console.warn("[sync] emailForCustomer failed:", (err as Error).message);
  }
  return null;
}

export { stripe };
