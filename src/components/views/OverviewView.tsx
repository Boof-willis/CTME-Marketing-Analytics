"use client";

import {
  ShoppingCart,
  DollarSign,
  Undo2,
  Megaphone,
  Sprout,
  ChevronDown,
} from "lucide-react";
import { useState } from "react";
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
        <RevenueCard revenue={o.railRevenue} />
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

// Overview revenue headline with an in-card rail toggle. Values are the
// range-scoped rail revenue (data.overview.railRevenue): date-responsive for a
// dated window, all-in GHL aggregates at Lifetime.
const REV_RAILS = [
  { key: "all", label: "All" },
  { key: "card", label: "Stripe" },
  { key: "crypto", label: "Crypto" },
] as const;

function RevenueCard({ revenue }: { revenue: { all: number; card: number; crypto: number } }) {
  const [rail, setRail] = useState<"all" | "card" | "crypto">("all");
  const value = revenue[rail];
  const color = rail === "card" ? "#635bff" : rail === "crypto" ? "#f7931a" : "#8b5cf6";
  const sublabel =
    rail === "all"
      ? `${formatCurrency(revenue.card, { compact: true })} card + ${formatCurrency(revenue.crypto, {
          compact: true,
        })} crypto`
      : rail === "card"
        ? "card revenue"
        : "crypto revenue";

  return (
    <div className="card overflow-hidden p-4">
      <div className="flex items-start gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors"
          style={{ backgroundColor: `${color}1f`, color }}
        >
          <DollarSign size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="label truncate">Revenue</p>
            <div className="relative shrink-0">
              <select
                value={rail}
                onChange={(e) => setRail(e.target.value as "all" | "card" | "crypto")}
                style={{ colorScheme: "dark" }}
                aria-label="Revenue payment type"
                className="cursor-pointer appearance-none rounded-md border border-line bg-surface/60 py-1 pl-2 pr-6 text-[11px] font-medium text-ink-muted transition-colors hover:text-ink focus:border-brand-gold/40 focus:outline-none"
              >
                {REV_RAILS.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={12}
                className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-faint"
              />
            </div>
          </div>
          <p className="mt-0.5 truncate text-2xl font-bold leading-tight text-ink">
            {formatCurrency(value, { compact: true })}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-ink-faint">{sublabel}</p>
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
