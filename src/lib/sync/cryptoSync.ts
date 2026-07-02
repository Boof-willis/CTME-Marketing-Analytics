import { config } from "../config";
import { matchContact, writeFields, readContactFieldValues, fieldValueNumber } from "./ghlWrite";
import { renderHistory, type HistoryRow } from "./history";

// -----------------------------------------------------------------------------
// Crypto -> GHL money sync (the "crypto rail").
//
// The Google Sheet (manual entry) is the source of truth for crypto payments. A
// thin Apps Script sums a contact's crypto rows and POSTs the totals here; this
// matches the contact (email -> phone -> name) and overwrites ONLY the
// *_crypto_* fields. Recompute/idempotent: the sheet always sends full totals.
// -----------------------------------------------------------------------------

export interface CryptoTotals {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  grossRevenue: number;
  grossPurchases: number;
  /** Per-year totals keyed by year string, e.g. { "2024": { revenue, purchases } }. */
  byYear?: Record<string, { revenue?: number; purchases?: number }>;
  /** Dated line-items for the crypto_payment_history log (from the sheet rows). */
  items?: { date: string; amount: number; currency?: string }[];
}

export interface CryptoResult {
  matched: boolean;
  written: boolean;
  reason?: string;
  contactId?: string;
  grossRevenue: number;
  grossPurchases: number;
}

function fieldsForCrypto(t: CryptoTotals): Record<string, number | string> {
  const mf = config.ghl.moneyFields;
  const tpl = config.ghl.moneyFieldTemplates;
  const out: Record<string, number | string> = {};
  out[mf.grossCryptoRevenue] = Number(t.grossRevenue) || 0;
  out[mf.grossCryptoPurchases] = Number(t.grossPurchases) || 0;
  for (const y of config.ghl.moneyYears) {
    const cell = t.byYear?.[String(y)] || {};
    out[tpl.cryptoRevenue.replace("{year}", String(y))] = Number(cell.revenue) || 0;
    out[tpl.cryptoPurchases.replace("{year}", String(y))] = Number(cell.purchases) || 0;
  }
  if (t.items && t.items.length) {
    const rows: HistoryRow[] = t.items.map((it) => ({
      date: String(it.date || "").slice(0, 10),
      amount: Number(it.amount) || 0,
      note: it.currency ? String(it.currency) : undefined,
    }));
    out[mf.cryptoPaymentHistory] = renderHistory(rows, "crypto");
  }
  return out;
}

export async function syncCryptoTotals(t: CryptoTotals, opts: { dryRun?: boolean } = {}): Promise<CryptoResult> {
  const dryRun = opts.dryRun ?? config.sync.dryRunDefault;
  const base = {
    grossRevenue: Number(t.grossRevenue) || 0,
    grossPurchases: Number(t.grossPurchases) || 0,
  };
  if (!t.email && !t.phone && !t.name) {
    return { matched: false, written: false, reason: "no_identity", ...base };
  }
  const contact = await matchContact({ email: t.email, phone: t.phone, name: t.name });
  if (!contact) return { matched: false, written: false, reason: "no_ghl_contact", ...base };

  if (!dryRun) {
    const mf = config.ghl.moneyFields;
    const { byId } = await readContactFieldValues(contact.id);
    const fields = fieldsForCrypto(t);
    // Combine this rail's crypto figures with the card figures already stored on
    // the contact. (Crypto has no refund field, so crypto net = crypto gross.)
    const storedCardGross = await fieldValueNumber(byId, mf.grossRevenue);
    const storedCardRefund = await fieldValueNumber(byId, mf.grossRefund);
    const storedCardCnt = await fieldValueNumber(byId, mf.grossPurchases);
    fields[mf.totalTransactions] = base.grossPurchases + storedCardCnt;
    fields[mf.totalRevenue] = base.grossRevenue + storedCardGross;
    fields[mf.lifetimeValue] = base.grossRevenue + (storedCardGross - storedCardRefund);
    await writeFields(contact.id, fields);
  }
  return { matched: true, written: !dryRun, contactId: contact.id, ...base };
}
