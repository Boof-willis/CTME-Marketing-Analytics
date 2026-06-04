"use client";

import type { CampaignRow } from "@/lib/types";
import { formatCurrency, formatNumber } from "@/lib/format";
import { DeltaBadge } from "./ui";

export function CampaignTable({
  rows,
  accent,
  resultLabel = "Results",
}: {
  rows: CampaignRow[];
  accent: string;
  resultLabel?: string;
}) {
  const maxSpend = Math.max(...rows.map((r) => r.spend), 1);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-ink-faint">
            <th className="px-3 py-2 font-medium">Campaign</th>
            <th className="px-3 py-2 text-right font-medium">Spend</th>
            <th className="px-3 py-2 text-right font-medium">{resultLabel}</th>
            <th className="px-3 py-2 text-right font-medium">Δ</th>
            <th className="px-3 py-2 text-right font-medium">CPA</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.name}
              className="border-t border-panel-border/60 transition-colors hover:bg-panel-light/40"
            >
              <td className="max-w-[220px] px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-ink-faint">{i + 1}.</span>
                  <span className="truncate text-ink">{r.name}</span>
                </div>
              </td>
              <td className="px-3 py-2.5 text-right">
                <div className="relative">
                  <span className="relative z-10 text-ink">{formatCurrency(r.spend)}</span>
                  <span
                    className="absolute inset-y-0 right-0 -my-1 rounded"
                    style={{
                      width: `${(r.spend / maxSpend) * 100}%`,
                      maxWidth: "100%",
                      background: `${accent}22`,
                    }}
                  />
                </div>
              </td>
              <td className="px-3 py-2.5 text-right font-medium text-ink">
                {formatNumber(r.results)}
              </td>
              <td className="px-3 py-2.5 text-right">
                <DeltaBadge value={r.resultDeltaPct} />
              </td>
              <td className="px-3 py-2.5 text-right text-ink-muted">
                {r.results ? formatCurrency(r.cpa) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
