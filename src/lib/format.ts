// Display formatting helpers shared across the UI.

export function formatCurrency(n: number, opts: { compact?: boolean } = {}): string {
  if (opts.compact && Math.abs(n) >= 1000) {
    return (
      "$" +
      new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(n)
    );
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatNumber(n: number, opts: { compact?: boolean } = {}): string {
  if (opts.compact && Math.abs(n) >= 1000) {
    return new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  }
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

export function formatPercent(n: number | null, digits = 1): string {
  if (n === null || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function formatDelta(n: number | null): string {
  if (n === null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

/** Short month/day label for chart axes, e.g. "05/14". */
export function shortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

/** Capitalize the first letter of each word in a contact name (e.g.
 *  "tobias dahlberg" → "Tobias Dahlberg"). The rest of each word is left as-is
 *  so intentional casing like "McIntyre" survives, and email-style fallback
 *  names (no real name on the record) are returned untouched. */
export function titleCaseName(name: string): string {
  if (!name || name.includes("@")) return name;
  return name.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}

/** Format a full ISO timestamp as a compact, readable date (e.g. "Jul 9, 2026").
 *  Returns "—" for missing/unparseable values. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}
