"use client";

import {
  DollarSign,
  Target,
  TrendingUp,
  MousePointerClick,
  Eye,
  Gauge,
  Filter,
  UserCheck,
} from "lucide-react";
import type { AdPlatformMetrics } from "@/lib/types";
import { KpiCard } from "@/components/KpiCard";
import { ComboChart } from "@/components/Charts";
import { Funnel } from "@/components/Funnel";
import { CampaignTable } from "@/components/CampaignTable";
import { SectionTitle } from "@/components/ui";
import { formatCurrency, formatNumber } from "@/lib/format";

export function AdPlatformView({ p }: { p: AdPlatformMetrics }) {
  const isMeta = p.platform === "meta";
  const accent = isMeta ? "#1d8cff" : "#34a853";
  const resultLabel = p.resultLabel || (isMeta ? "Results" : "Conversions");
  // Lead-gen accounts have no purchase revenue from the pixel; show cost-per-
  // result + CTR instead of the misleading $0 Revenue / 0x ROAS.
  const hasRevenue = p.revenue.value > 0;
  const costPerResultMetric = { ...p.results, value: p.costPerResult };
  const cacMetric = { ...p.purchases, value: p.costToAcquireCustomer };
  const hasCac = p.costToAcquireCustomer > 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <KpiCard label="Investment" metric={p.investment} display={formatCurrency(p.investment.value, { compact: true })} icon={DollarSign} color={accent} higherIsBetter={false} />
        <KpiCard label={resultLabel} metric={p.results} display={formatNumber(p.results.value)} icon={Target} color="#22c55e" />
        {hasRevenue ? (
          <>
            <KpiCard label="Revenue" metric={p.revenue} display={formatCurrency(p.revenue.value, { compact: true })} icon={TrendingUp} color="#8b5cf6" />
            <KpiCard label="ROAS" metric={p.roas} display={`${p.roas.value.toFixed(2)}x`} icon={Gauge} color="#22d3ee" />
          </>
        ) : (
          <>
            <KpiCard label={`Cost / ${resultLabel.replace(/s$/, "")}`} metric={costPerResultMetric} display={formatCurrency(p.costPerResult)} icon={Gauge} color="#8b5cf6" higherIsBetter={false} />
            <KpiCard label="CTR" metric={{ ...p.clicks, value: p.ctr }} display={`${p.ctr.toFixed(2)}%`} icon={TrendingUp} color="#22d3ee" />
          </>
        )}
        <KpiCard label="CAC" metric={cacMetric} display={hasCac ? formatCurrency(p.costToAcquireCustomer) : "—"} icon={UserCheck} color="#f43f5e" higherIsBetter={false} sublabel={hasCac ? `${formatNumber(p.purchases.value)} customers` : "needs CRM data"} />
        <KpiCard label="Clicks" metric={p.clicks} display={formatNumber(p.clicks.value)} icon={MousePointerClick} color="#f59e0b" />
      </div>

      {/* Efficiency strip */}
      <div className="card grid grid-cols-2 gap-px overflow-hidden bg-panel-border lg:grid-cols-6">
        <Cell label="Cost / Result" value={formatCurrency(p.costPerResult)} />
        <Cell label="CAC" value={hasCac ? formatCurrency(p.costToAcquireCustomer) : "—"} />
        <Cell label="CPC" value={formatCurrency(p.cpc)} />
        <Cell label="CPM" value={formatCurrency(p.cpm)} />
        <Cell label="CTR" value={`${p.ctr.toFixed(2)}%`} />
        <Cell label="Impressions" value={formatNumber(p.impressions.value, { compact: true })} icon={Eye} />
      </div>

      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle icon={TrendingUp}>Investment vs {resultLabel}</SectionTitle>
        </div>
        <ComboChart
          data={p.resultsByDay}
          series={[
            { key: "investment", label: "Investment", color: accent, type: "area" },
            { key: "results", label: resultLabel, color: "#22c55e", type: "line", yAxis: "right" },
          ]}
        />
      </div>
      <div className="card p-5">
        <SectionTitle icon={Filter} className="mb-4">
          Traffic Funnel
        </SectionTitle>
        <Funnel stages={p.funnel} accent={accent} />
      </div>

      <div className="card p-4">
        <SectionTitle className="mb-3">Campaigns</SectionTitle>
        <CampaignTable rows={p.campaigns} accent={accent} resultLabel={resultLabel} />
      </div>
    </div>
  );
}

function Cell({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon?: typeof Eye;
}) {
  return (
    <div className="bg-panel p-4">
      <p className="label flex items-center gap-1">
        {Icon ? <Icon size={12} /> : null}
        {label}
      </p>
      <p className="mt-1 text-xl font-bold text-ink">{value}</p>
    </div>
  );
}
