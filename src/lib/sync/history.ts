// Renders a contact's dated payment line-items into the text block stored in a
// GHL large-text field (one field per rail). Recompute-safe: the sync rebuilds
// the whole block each run, so it never duplicates.

export interface HistoryRow {
  /** ISO date (yyyy-MM-dd) of the payment. */
  date: string;
  /** Amount paid, in USD. */
  amount: number;
  /** Amount refunded on this payment, in USD (optional). */
  refunded?: number;
  /** Extra note, e.g. the crypto currency ("ETH") or tx reference. */
  note?: string;
}

const MAX_LINES = 100; // keep the field well under GHL's text limits

function money(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Build the payment-log text for one rail, newest first. */
export function renderHistory(rows: HistoryRow[], rail: "card" | "crypto"): string {
  const sorted = [...rows]
    .filter((r) => r && r.date)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const lines = sorted.slice(0, MAX_LINES).map((r) => {
    let line = `${r.date} · $${money(r.amount)} · ${rail}`;
    if (r.note) line += ` (${r.note})`;
    if (r.refunded && r.refunded > 0) line += ` · refunded $${money(r.refunded)}`;
    return line;
  });

  if (sorted.length > MAX_LINES) {
    lines.push(`… and ${sorted.length - MAX_LINES} older payment(s)`);
  }
  return lines.join("\n");
}
