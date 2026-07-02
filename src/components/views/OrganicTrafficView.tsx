"use client";

import {
  UserPlus,
  CalendarCheck,
  PhoneCall,
  ShoppingCart,
  UserX,
  DollarSign,
  Filter,
  Globe,
  TrendingUp,
} from "lucide-react";
import type { DashboardData } from "@/lib/types";
import { KpiCard, StatTile } from "@/components/KpiCard";
import { Funnel } from "@/components/Funnel";
import { Donut } from "@/components/Charts";
import { LeadsByCountry } from "@/components/LeadsByCountry";
import { SectionTitle } from "@/components/ui";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";

const ACCENT = "#22c55e";

export function OrganicTrafficView({ data }: { data: DashboardData }) {
  const o = data.organic;
  const totalLeads = o.sources.reduce((a, s) => a + s.value, 0) || o.leads.value;
  // Of the warm leads, how many became customers (lifetime, tag-scoped).
  const leadToCustomer = o.leads.value ? (o.purchases.value / o.leads.value) * 100 : 0;
  // How the warm-leads KPI is being counted (see the sent-to-sales workflow field).
  const wt = o.warmTracking;
  const warmSublabel = !wt
    ? "tagged warm traffic"
    : wt.mode === "period"
      ? "tagged this period"
      : wt.mode === "pipeline"
        ? wt.coverage > 0
          ? `in pipeline · ${wt.coverage}% date-tracked`
          : "in pipeline · all tagged"
        : "new this period";

  return (
    <div className="space-y-5">
      {/* Volume KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KpiCard label="Warm Traffic Leads" metric={o.leads} display={formatNumber(o.leads.value)} icon={UserPlus} color="#22d3ee" sublabel={warmSublabel} />
        <KpiCard label="Meetings Scheduled" metric={o.appointments} display={formatNumber(o.appointments.value)} icon={CalendarCheck} color="#8b5cf6" sublabel="per warm lead" />
        <KpiCard label="Meetings Held" metric={o.callsCompleted} display={formatNumber(o.callsCompleted.value)} icon={PhoneCall} color="#22c55e" sublabel="per warm lead" />
        <KpiCard label="No-Shows" metric={o.noShows} display={formatNumber(o.noShows.value)} icon={UserX} color="#ef4444" higherIsBetter={false} />
        <KpiCard label="Sold" metric={o.purchases} display={formatNumber(o.purchases.value)} icon={ShoppingCart} color="#3b82f6" sublabel="warm customers · all-time" />
        <KpiCard label="Revenue" metric={o.revenue} display={formatCurrency(o.revenue.value, { compact: true })} icon={DollarSign} color="#22c55e" sublabel="warm leads · all-time" />
      </div>

      {/* Traffic source breakdown — donut + detailed list in one widget */}
      <div className="card p-5">
        <SectionTitle icon={Globe} className="mb-4">
          Organic Channels
        </SectionTitle>
        <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <Donut
              slices={o.sources}
              centerLabel="organic leads"
              centerValue={formatNumber(totalLeads)}
              showLegend={false}
            />
            {/* These leads came through organic channels before being handed to sales. */}
          </div>
          <div className="lg:col-span-2">
          {o.sources.length ? (
            <div className="space-y-3">
              {o.sources.map((s) => {
                const pct = totalLeads ? Math.round((s.value / totalLeads) * 100) : 0;
                return (
                  <div key={s.label} className="flex items-center gap-3">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                    <span className="w-40 shrink-0 truncate text-sm text-ink">{s.label}</span>
                    <div className="h-2 flex-1 rounded-full bg-panel">
                      <div className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: s.color }} />
                    </div>
                    <span className="w-12 shrink-0 text-right text-sm font-semibold text-ink">{formatNumber(s.value)}</span>
                    <span className="w-10 shrink-0 text-right text-[11px] text-ink-faint">{pct}%</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-ink-faint">No warm leads in this period.</p>
          )}
          </div>
        </div>
      </div>

      {/* Booking funnel + Leads by country, side by side on desktop */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <div className="mb-1 flex items-center justify-between">
            <SectionTitle icon={Filter}>Warm Sales Funnel</SectionTitle>
          </div>
          <p className="mb-4 text-[11px] text-ink-faint">
            Distinct warm-tagged leads with a meeting this period — one per lead, so
            reschedules don&apos;t inflate it. Sold &amp; revenue are all-time outcomes below.
          </p>
          <Funnel stages={o.funnel} accent={ACCENT} />
        </div>
        <LeadsByCountry countries={o.countries} accent={ACCENT} title="Warm Leads by Country" />
      </div>

      {/* Sales conversion rates (meeting-anchored, so they don't invert) */}
      <div>
        <p className="label mb-2 px-1">Sales conversion rates</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatTile
            label="Meeting Held Rate"
            value={formatPercent(o.callCompletedRate)}
            color="#22c55e"
            hint="Meetings held ÷ scheduled"
            good={o.callCompletedRate >= 60}
            fillPct={o.callCompletedRate}
          />
          <StatTile
            label="Lead → Customer"
            value={formatPercent(leadToCustomer)}
            color="#3b82f6"
            hint="Warm leads who became customers (all-time)"
            fillPct={leadToCustomer}
          />
          <StatTile
            label="No-Show Rate"
            value={formatPercent(o.noShowRate)}
            color="#ef4444"
            hint="No-shows ÷ meetings scheduled"
            good={o.noShowRate <= 20}
            fillPct={o.noShowRate}
          />
        </div>
      </div>

      {/* Summary strip */}
      <div className="card flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex items-center gap-2">
          <TrendingUp size={18} className="text-good" />
          <div>
            <p className="label">Revenue / Lead</p>
            <p className="text-xl font-bold text-ink">
              {o.leads.value ? formatCurrency(o.revenue.value / o.leads.value) : "—"}
            </p>
          </div>
        </div>
        <div>
          <p className="label">Avg. Order Value</p>
          <p className="text-xl font-bold text-ink">
            {o.purchases.value ? formatCurrency(o.revenue.value / o.purchases.value) : "—"}
          </p>
        </div>
        <div>
          <p className="label">Top Source</p>
          <p className="text-xl font-bold text-ink">{o.sources[0]?.label ?? "—"}</p>
        </div>
      </div>
    </div>
  );
}
