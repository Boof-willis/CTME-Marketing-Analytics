"use client";

import {
  Users,
  ShoppingCart,
  DollarSign,
  Undo2,
  TrendingUp,
  Receipt,
  Wallet,
  Megaphone,
  Sprout,
} from "lucide-react";
import type { DashboardData } from "@/lib/types";
import { KpiCard, StatTile } from "@/components/KpiCard";
import { ComboChart, Donut } from "@/components/Charts";
import { SectionTitle } from "@/components/ui";
import { formatCurrency, formatNumber } from "@/lib/format";

export function OverviewView({ data }: { data: DashboardData }) {
  const o = data.overview;
  const paidTotal = o.paidChannels.reduce((a, s) => a + s.value, 0);
  const organicTotal = o.organicChannels.reduce((a, s) => a + s.value, 0);
  const leadTotal = paidTotal + organicTotal;
  const leadSlices = [
    { label: "Paid", value: paidTotal, color: "#3b82f6" },
    { label: "Organic", value: organicTotal, color: "#22c55e" },
  ].filter((s) => s.value > 0);

  const repeatPurchaseRate = o.uniquePurchasers.value
    ? Math.max(0, (1 - o.uniquePurchasers.value / Math.max(o.purchases.value, 1)) * 100)
    : null;
  const refundRate = o.purchases.value
    ? (o.refunds.value / o.purchases.value) * 100
    : null;

  return (
    <div className="space-y-5">
      {/* Headline KPI row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard
          label="Unique Purchasers"
          metric={o.uniquePurchasers}
          display={formatNumber(o.uniquePurchasers.value)}
          icon={Users}
          color="#3b82f6"
        />
        <KpiCard
          label="Purchases"
          metric={o.purchases}
          display={formatNumber(o.purchases.value)}
          icon={ShoppingCart}
          color="#22c55e"
          sublabel="all payments"
        />
        <KpiCard
          label="Total Revenue"
          metric={o.revenue}
          display={formatCurrency(o.revenue.value, { compact: true })}
          icon={DollarSign}
          color="#8b5cf6"
        />
        <KpiCard
          label="Refunds"
          metric={o.refunds}
          display={formatNumber(o.refunds.value)}
          icon={Undo2}
          color="#ef4444"
          higherIsBetter={false}
          sublabel={formatCurrency(o.refundAmount.value, { compact: true })}
        />
        <KpiCard
          label="Net Revenue"
          metric={{ ...o.revenue, value: o.netRevenue }}
          display={formatCurrency(o.netRevenue, { compact: true })}
          icon={Wallet}
          color="#22d3ee"
          sublabel="rev − refunds"
        />
      </div>

      {/* KPI tiles: AOV + LTV */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Average Order Value"
          value={formatCurrency(o.averageOrderValue)}
          color="#8b5cf6"
          hint="Total revenue ÷ # purchases"
        />
        <StatTile
          label="Lifetime Value (LTV)"
          value={formatCurrency(o.lifetimeValue)}
          color="#3b82f6"
          hint="Avg. of GHL Lifetime Value field (contacts with a real value)"
        />
        <StatTile
          label="Repeat Purchase Rate"
          value={repeatPurchaseRate === null ? "—" : `${Math.round(repeatPurchaseRate)}%`}
          color="#22c55e"
          hint="Share of purchases beyond first-time buyers"
          fillPct={repeatPurchaseRate}
        />
        <StatTile
          label="Refund Rate"
          value={refundRate === null ? "—" : `${refundRate.toFixed(1)}%`}
          color="#ef4444"
          hint="# refunds ÷ # purchases"
          good={refundRate === null ? null : refundRate < 5}
          fillPct={refundRate}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <SectionTitle icon={TrendingUp}>Revenue vs Purchases</SectionTitle>
            <span className="text-xs text-ink-faint">{data.meta.rangeLabel}</span>
          </div>
          <ComboChart
            data={o.revenueVsPurchasesSeries}
            series={[
              { key: "revenue", label: "Revenue", color: "#22c55e", type: "area" },
              { key: "purchases", label: "Purchases", color: "#3b82f6", type: "line", yAxis: "right" },
            ]}
          />
        </div>

        <div className="card flex flex-col p-4">
          <SectionTitle icon={Receipt} className="mb-3">
            Refund Reasons
          </SectionTitle>
          {o.refundReasons.length ? (
            <Donut
              slices={o.refundReasons}
              centerLabel="refunds"
              centerValue={formatNumber(o.refunds.value)}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
              <span className="text-3xl font-bold text-ink">{formatNumber(o.refunds.value)}</span>
              <span className="text-xs text-ink-faint">refunds in this period</span>
              <p className="mt-2 max-w-[15rem] text-[11px] leading-snug text-ink-faint">
                Reason breakdown isn&apos;t tracked yet. Add a &ldquo;Refund reason&rdquo; dropdown
                field in GHL and it&apos;ll populate here.
              </p>
            </div>
          )}
        </div>
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
