"use client";

import {
  ShoppingCart,
  DollarSign,
  Undo2,
  Megaphone,
  Sprout,
} from "lucide-react";
import type { DashboardData } from "@/lib/types";
import { KpiCard, StatTile } from "@/components/KpiCard";
import { Donut } from "@/components/Charts";
import { SectionTitle } from "@/components/ui";
import { formatCurrency, formatNumber } from "@/lib/format";

export function OverviewView({ data }: { data: DashboardData }) {
  const o = data.overview;
  // Money KPIs are sourced from GHL fields at "current year" scope, so label them
  // with the year rather than letting them read as date-range figures.
  // Overview money is the "this period" view: revenue / purchases / refunds /
  // AOV respond to the date-range picker, sourced from Stripe card payments
  // (the only per-transaction source that can slice an arbitrary range). The
  // authoritative all-in annual/lifetime totals (incl. crypto) live in the
  // Operations → Financials section, sourced from GHL custom fields. LTV is the
  // exception — it's the lifetime GHL field, not a per-period figure.
  const paidTotal = o.paidChannels.reduce((a, s) => a + s.value, 0);
  const organicTotal = o.organicChannels.reduce((a, s) => a + s.value, 0);
  const leadTotal = paidTotal + organicTotal;
  const leadSlices = [
    { label: "Paid", value: paidTotal, color: "#3b82f6" },
    { label: "Organic", value: organicTotal, color: "#22c55e" },
  ].filter((s) => s.value > 0);

  return (
    <div className="space-y-5">
      {/* Headline KPI row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KpiCard
          label="Purchases"
          metric={o.purchases}
          display={formatNumber(o.purchases.value)}
          icon={ShoppingCart}
          color="#22c55e"
          sublabel="this period"
        />
        <KpiCard
          label="Total Revenue"
          metric={o.revenue}
          display={formatCurrency(o.revenue.value, { compact: true })}
          icon={DollarSign}
          color="#8b5cf6"
          sublabel="this period · card"
        />
        <KpiCard
          label="Refunds"
          metric={o.refunds}
          display={formatNumber(o.refunds.value)}
          icon={Undo2}
          color="#ef4444"
          higherIsBetter={false}
          sublabel={formatCurrency(o.refundAmount.value, { compact: true })}
          clickableWhenEmpty
        />
      </div>

      {/* KPI tiles: AOV + LTV */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-2">
        <StatTile
          label="Average Order Value"
          value={o.averageOrderValue ? formatCurrency(o.averageOrderValue) : "—"}
          color="#8b5cf6"
          hint="Total revenue ÷ # purchases (this period)"
        />
        <StatTile
          label="Lifetime Value (LTV)"
          value={formatCurrency(o.lifetimeValue)}
          color="#3b82f6"
          hint="Avg. of GHL Lifetime Value field (all-time)"
        />
      </div>

      {/* Leads by source — paid channels vs organic channels */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card p-4">
          <SectionTitle className="mb-3">Leads by Traffic Source</SectionTitle>
          <Donut
            slices={leadSlices}
            centerLabel="total leads"
            centerValue={formatNumber(leadTotal)}
          />
        </div>
        <div className="card grid grid-cols-1 gap-x-8 gap-y-4 p-5 lg:col-span-2 sm:grid-cols-2">
          <ChannelList
            icon={Megaphone}
            title="Paid channels"
            accent="#3b82f6"
            channels={o.paidChannels}
            total={paidTotal}
          />
          <ChannelList
            icon={Sprout}
            title="Organic channels"
            accent="#22c55e"
            channels={o.organicChannels}
            total={organicTotal}
          />
        </div>
      </div>
    </div>
  );
}

function ChannelList({
  icon: Icon,
  title,
  accent,
  channels,
  total,
}: {
  icon: React.ElementType;
  title: string;
  accent: string;
  channels: { label: string; value: number; color: string }[];
  total: number;
}) {
  const max = channels.reduce((a, c) => Math.max(a, c.value), 0) || 1;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={16} style={{ color: accent }} />
          <span className="text-sm font-semibold text-ink">{title}</span>
        </div>
        <span className="text-xs text-ink-faint">{formatNumber(total)} leads</span>
      </div>
      {channels.length ? (
        <div className="space-y-2.5">
          {channels.map((c) => {
            const pct = total ? Math.round((c.value / total) * 100) : 0;
            const barPct = Math.max(4, (c.value / max) * 100);
            return (
              <div key={c.label} className="flex items-center gap-3">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                <span className="w-28 shrink-0 truncate text-sm text-ink">{c.label}</span>
                <div className="h-2 flex-1 rounded-full bg-panel">
                  <div className="h-2 rounded-full" style={{ width: `${barPct}%`, backgroundColor: c.color }} />
                </div>
                <span className="w-10 shrink-0 text-right text-sm font-semibold text-ink">{formatNumber(c.value)}</span>
                <span className="w-9 shrink-0 text-right text-[11px] text-ink-faint">{pct}%</span>
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
