"use client";

import { Globe } from "lucide-react";
import type { CountryCount } from "@/lib/types";
import { SectionTitle } from "@/components/ui";
import { formatNumber } from "@/lib/format";

// Resolve a human country name from an ISO 3166-1 alpha-2 code. Uses the
// platform's built-in locale data (no dependency / no hard-coded list).
const regionNames =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

function countryName(code: string): string {
  if (code === "OTHER" || code === "??" || !code) return "Other / Unknown";
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

// Turn an ISO-2 code into its flag emoji via regional-indicator symbols.
function flag(code: string): string {
  if (!code || code === "??" || code === "OTHER" || code.length !== 2) return "🌐";
  const base = 0x1f1e6;
  const cp = [...code.toUpperCase()].map((ch) => base + (ch.charCodeAt(0) - 65));
  if (cp.some((c) => c < base || c > base + 25)) return "🌐";
  return String.fromCodePoint(...cp);
}

export function LeadsByCountry({
  countries,
  accent = "#3b82f6",
  title = "Leads by Country",
}: {
  countries: CountryCount[];
  accent?: string;
  title?: string;
}) {
  const total = countries.reduce((a, c) => a + c.value, 0);
  const max = countries.reduce((a, c) => Math.max(a, c.value), 0) || 1;

  return (
    <div className="card p-5">
      <SectionTitle icon={Globe} className="mb-4">
        {title}
      </SectionTitle>
      {total ? (
        <div className="space-y-3">
          {countries.map((c) => {
            const pct = total ? Math.round((c.value / total) * 100) : 0;
            const barPct = Math.max(4, (c.value / max) * 100);
            return (
              <div key={c.code} className="flex items-center gap-3">
                <span className="w-6 shrink-0 text-center text-lg leading-none" aria-hidden>
                  {flag(c.code)}
                </span>
                <span className="w-36 shrink-0 truncate text-sm text-ink">{countryName(c.code)}</span>
                <div className="h-2 flex-1 rounded-full bg-panel">
                  <div className="h-2 rounded-full" style={{ width: `${barPct}%`, backgroundColor: accent }} />
                </div>
                <span className="w-12 shrink-0 text-right text-sm font-semibold text-ink">{formatNumber(c.value)}</span>
                <span className="w-10 shrink-0 text-right text-[11px] text-ink-faint">{pct}%</span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-ink-faint">No leads in this period.</p>
      )}
    </div>
  );
}
