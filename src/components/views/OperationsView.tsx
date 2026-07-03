"use client";

import { useState } from "react";
import {
  Users,
  Wallet,
  TrendingUp,
  Receipt,
  Coins,
  CreditCard,
  CalendarClock,
  RefreshCw,
} from "lucide-react";
import type { DashboardData, MoneyMetrics } from "@/lib/types";
import { KpiCard, StatTile } from "@/components/KpiCard";
import { ComboChart, Donut } from "@/components/Charts";
import { ContactsTrigger } from "@/components/ContactsModal";
import { SectionTitle } from "@/components/ui";
import { formatCurrency, formatNumber } from "@/lib/format";

const STRIPE_COLOR = "#635bff";
const CRYPTO_COLOR = "#f7931a";

type YearScope = number | "lifetime";

/** Resolve the money figures for the selected scope (a single year or lifetime). */
function scopeOf(money: MoneyMetrics, scope: YearScope) {
  if (scope === "lifetime") {
    return {
      stripeRevenue: money.grossRevenue,
      cryptoRevenue: money.grossCryptoRevenue,
      totalRevenue: money.totalRevenue,
      refund: money.grossRefund,
      purchases: money.totalPurchases,
      aov: money.averageOrderValue,
    };
  }
  const y = money.byYear.find((x) => x.year === scope);
  const stripeRevenue = y?.revenue ?? 0;
  const cryptoRevenue = y?.cryptoRevenue ?? 0;
  const totalRevenue = stripeRevenue + cryptoRevenue;
  const purchases = (y?.purchases ?? 0) + (y?.cryptoPurchases ?? 0);
  return {
    stripeRevenue,
    cryptoRevenue,
    totalRevenue,
    refund: y?.refund ?? 0,
    purchases,
    aov: purchases ? totalRevenue / purchases : 0,
  };
}

function freshness(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "unknown";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function Financials({ money }: { money: MoneyMetrics }) {
  const years = money.byYear.map((y) => y.year);
  const [scope, setScope] = useState<YearScope>("lifetime");
  const s = scopeOf(money, scope);
  const cryptoShare = s.totalRevenue ? (s.cryptoRevenue / s.totalRevenue) * 100 : 0;
  // Year bars, plus a "Legacy" bucket for lifetime revenue not attributed to any
  // tracked year — undated/imported gross_revenue on contacts with no dated
  // transaction (mostly pre-2023 customers) + a few undated crypto rows. Surfacing
  // it makes the bars reconcile with the lifetime total instead of looking short.
  const yearRows: { label: string; revenue: number; cryptoRevenue: number }[] = money.byYear.map((y) => ({
    label: String(y.year),
    revenue: y.revenue,
    cryptoRevenue: y.cryptoRevenue,
  }));
  const legacyStripe = Math.max(0, money.grossRevenue - money.byYear.reduce((a, y) => a + y.revenue, 0));
  const legacyCrypto = Math.max(0, money.grossCryptoRevenue - money.byYear.reduce((a, y) => a + y.cryptoRevenue, 0));
  if (legacyStripe + legacyCrypto >= 1) {
    yearRows.push({ label: "Legacy", revenue: legacyStripe, cryptoRevenue: legacyCrypto });
  }
  const maxYearTotal = Math.max(1, ...yearRows.map((y) => y.revenue + y.cryptoRevenue));
  const scopeLabel = scope === "lifetime" ? "Lifetime" : String(scope);

  const dailyData = money.dailyRevenue.map((p) => ({ date: p.date, revenue: p.value }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle icon={Wallet}>Financials</SectionTitle>
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-1 text-[11px] text-ink-faint sm:flex">
            <RefreshCw size={11} /> synced {freshness(money.lastSyncedAt)}
          </span>
          {/* Year / Lifetime scope — money is sourced from GHL annual + lifetime
              fields, so it has its own selector independent of the date picker. */}
          <div className="flex rounded-lg border border-line bg-surface/60 p-0.5 text-xs">
            {(["lifetime", ...years.slice().sort((a, b) => b - a)] as YearScope[]).map((y) => {
              const active = y === scope;
              return (
                <button
                  key={String(y)}
                  onClick={() => setScope(y)}
                  className={
                    "rounded-md px-2.5 py-1 font-medium transition-colors " +
                    (active ? "bg-brand-gold/20 text-ink" : "text-ink-faint hover:text-ink")
                  }
                >
                  {y === "lifetime" ? "Lifetime" : y}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Money KPI row (scope-aware) */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label={`Revenue · ${scopeLabel}`}
          value={formatCurrency(s.totalRevenue, { compact: true })}
          color="#22c55e"
          hint="Stripe + crypto, all-in"
        />
        <StatTile
          label={`Crypto Revenue · ${scopeLabel}`}
          value={formatCurrency(s.cryptoRevenue, { compact: true })}
          color={CRYPTO_COLOR}
          hint={`${cryptoShare.toFixed(1)}% of revenue · ${formatNumber(money.cryptoClients)} clients`}
          fillPct={cryptoShare}
        />
        <StatTile
          label={`Avg Order Value · ${scopeLabel}`}
          value={s.aov ? formatCurrency(s.aov, { compact: true }) : "—"}
          color="#3b82f6"
          hint={`${formatNumber(s.purchases)} purchases`}
        />
        <StatTile
          label="Pending Invoices"
          value={formatCurrency(money.pendingInvoiceValue, { compact: true })}
          color="#f59e0b"
          hint={`${formatNumber(money.pendingInvoices)} open`}
        />
      </div>

      {/* Charts: daily trend + revenue-by-year + payment split */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-2">
            <SectionTitle icon={TrendingUp}>Daily Revenue</SectionTitle>
            <span className="text-[11px] text-ink-faint">Stripe card · this period</span>
          </div>
          {dailyData.length ? (
            <ComboChart
              data={dailyData}
              series={[{ key: "revenue", label: "Card Revenue", color: "#22c55e", type: "area" }]}
            />
          ) : (
            <div className="flex h-[200px] items-center justify-center text-xs text-ink-faint">
              Connect Stripe to see the daily revenue trend.
            </div>
          )}
        </div>

        <div className="card flex flex-col p-4">
          <SectionTitle icon={Coins}>Payment Method · {scopeLabel}</SectionTitle>
          <div className="mt-2">
            <Donut
              slices={[
                { label: "Stripe", value: Math.round(s.stripeRevenue), color: STRIPE_COLOR },
                { label: "Crypto", value: Math.round(s.cryptoRevenue), color: CRYPTO_COLOR },
              ].filter((x) => x.value > 0)}
              centerLabel="revenue"
              centerValue={formatCurrency(s.totalRevenue, { compact: true })}
            />
          </div>
        </div>
      </div>

      {/* Revenue by year — stacked Stripe vs crypto */}
      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <SectionTitle icon={CalendarClock}>Revenue by Year</SectionTitle>
          <div className="flex items-center gap-3 text-[11px] text-ink-faint">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: STRIPE_COLOR }} /> Stripe
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: CRYPTO_COLOR }} /> Crypto
            </span>
          </div>
        </div>
        <div className="space-y-2.5">
          {yearRows.map((y) => {
            const total = y.revenue + y.cryptoRevenue;
            const width = (total / maxYearTotal) * 100;
            const stripePct = total ? (y.revenue / total) * 100 : 0;
            return (
              <div key={y.label} className="flex items-center gap-3">
                <span
                  className="w-14 shrink-0 text-xs font-medium text-ink-faint"
                  title={
                    y.label === "Legacy"
                      ? "Revenue recorded with no dated transaction — imported / pre-2023 customers"
                      : undefined
                  }
                >
                  {y.label}
                </span>
                <div className="flex h-5 flex-1 overflow-hidden rounded bg-surface/60">
                  <div className="flex h-full" style={{ width: `${Math.max(width, 1)}%` }}>
                    <div className="h-full" style={{ width: `${stripePct}%`, background: STRIPE_COLOR }} />
                    <div className="h-full" style={{ width: `${100 - stripePct}%`, background: CRYPTO_COLOR }} />
                  </div>
                </div>
                <span className="w-20 shrink-0 text-right text-xs font-semibold text-ink">
                  {formatCurrency(total, { compact: true })}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function OperationsView({ data }: { data: DashboardData }) {
  const o = data.overview;
  const money = data.money;

  const repeatPurchaseRate = o.uniquePurchasers.value
    ? Math.max(0, (1 - o.uniquePurchasers.value / Math.max(o.purchases.value, 1)) * 100)
    : null;
  const refundRate = o.purchases.value
    ? (o.refunds.value / o.purchases.value) * 100
    : null;

  return (
    <div className="space-y-6">
      <Financials money={money} />

      {/* Operational KPIs (range-driven, from the funnel/CRM) */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Unique Purchasers"
          metric={o.uniquePurchasers}
          display={formatNumber(o.uniquePurchasers.value)}
          icon={Users}
          color="#3b82f6"
        />
        <KpiCard
          label="Net Revenue"
          metric={{ ...o.revenue, value: o.netRevenue }}
          display={formatCurrency(o.netRevenue, { compact: true })}
          icon={CreditCard}
          color="#22d3ee"
          sublabel="rev − refunds"
        />
        <StatTile
          label="Repeat Purchase Rate"
          value={repeatPurchaseRate === null ? "—" : `${Math.round(repeatPurchaseRate)}%`}
          color="#22c55e"
          hint="Share of purchases beyond first-time buyers"
          fillPct={repeatPurchaseRate}
          contacts={o.repeatPurchaserContacts}
          contactsTitle="Repeat Purchasers"
        />
        <StatTile
          label="Refund Rate"
          value={refundRate === null ? "—" : `${refundRate.toFixed(1)}%`}
          color="#ef4444"
          hint="# refunds ÷ # purchases"
          good={refundRate === null ? null : refundRate < 5}
          fillPct={refundRate}
          contacts={o.refunds.contacts}
          contactsTitle="Refunds"
          contactsTotal={o.refunds.value}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-2">
            <SectionTitle icon={TrendingUp}>Revenue vs Purchases</SectionTitle>
            <div className="flex items-center gap-2">
              <ContactsTrigger
                title="Purchasers"
                contacts={o.revenue.contacts}
                total={o.uniquePurchasers.value}
              />
              <span className="hidden text-xs text-ink-faint sm:inline">{data.meta.rangeLabel}</span>
            </div>
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
          <div className="mb-3 flex items-center justify-between gap-2">
            <SectionTitle icon={Receipt}>Refund Reasons</SectionTitle>
            <ContactsTrigger title="Refunds" contacts={o.refunds.contacts} total={o.refunds.value} />
          </div>
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
    </div>
  );
}
