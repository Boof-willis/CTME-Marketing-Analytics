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
  const leadToApptRate = o.leads.value ? (o.appointments.value / o.leads.value) * 100 : 0;
  const leadToPurchaseRate = o.leads.value ? (o.purchases.value / o.leads.value) * 100 : 0;

  return (
    <div className="space-y-5">
      {/* Volume KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KpiCard label="Organic Leads" metric={o.leads} display={formatNumber(o.leads.value)} icon={UserPlus} color="#22d3ee" sublabel="non-paid contacts" />
        <KpiCard label="Appointments" metric={o.appointments} display={formatNumber(o.appointments.value)} icon={CalendarCheck} color="#8b5cf6" />
        <KpiCard label="Calls Completed" metric={o.callsCompleted} display={formatNumber(o.callsCompleted.value)} icon={PhoneCall} color="#22c55e" />
        <KpiCard label="No-Shows" metric={o.noShows} display={formatNumber(o.noShows.value)} icon={UserX} color="#ef4444" higherIsBetter={false} />
        <KpiCard label="Purchases" metric={o.purchases} display={formatNumber(o.purchases.value)} icon={ShoppingCart} color="#3b82f6" />
        <KpiCard label="Organic Revenue" metric={o.revenue} display={formatCurrency(o.revenue.value, { compact: true })} icon={DollarSign} color="#22c55e" sublabel="from organic leads" />
      </div>

      {/* Traffic source breakdown — donut + detailed list in one widget */}
      <div className="card p-5">
        <SectionTitle icon={Globe} className="mb-4">
          Leads by Source
        </SectionTitle>
        <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <Donut
              slices={o.sources}
              centerLabel="organic leads"
              centerValue={formatNumber(totalLeads)}
              showLegend={false}
            />
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
            <p className="text-sm text-ink-faint">No organic leads in this period.</p>
          )}
          </div>
        </div>
      </div>

      {/* Booking funnel + Leads by country, side by side on desktop */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <div className="mb-1 flex items-center justify-between">
            <SectionTitle icon={Filter}>Organic Booking Funnel</SectionTitle>
          </div>
          <p className="mb-4 text-[11px] text-ink-faint">
            Leads → appointments → calls completed. Organic buyers often purchase without
            booking a call, so purchases are shown as a separate outcome below.
          </p>
          <Funnel stages={o.funnel} accent={ACCENT} />
        </div>
        <LeadsByCountry countries={o.countries} accent={ACCENT} title="Organic Leads by Country" />
      </div>

      {/* Booking conversion rates */}
      <div>
        <p className="label mb-2 px-1">Booking conversion rates</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatTile
            label="Lead → Appointment"
            value={formatPercent(leadToApptRate)}
            color="#8b5cf6"
            hint="Appointments booked ÷ organic leads"
            fillPct={leadToApptRate}
          />
          <StatTile
            label="Call Completed Rate"
            value={formatPercent(o.callCompletedRate)}
            color="#22c55e"
            hint="Calls completed ÷ appointments booked"
            good={o.callCompletedRate >= 60}
            fillPct={o.callCompletedRate}
          />
          <StatTile
            label="No-Show Rate"
            value={formatPercent(o.noShowRate)}
            color="#ef4444"
            hint="No-shows ÷ appointments booked"
            good={o.noShowRate <= 20}
            fillPct={o.noShowRate}
          />
        </div>
      </div>

      {/* Outcomes (purchases + revenue sit outside the call funnel) */}
      <div>
        <p className="label mb-2 px-1">Outcomes</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatTile
            label="Purchases"
            value={formatNumber(o.purchases.value)}
            color="#3b82f6"
            hint="Orders attributed to organic leads"
          />
          <StatTile
            label="Organic Revenue"
            value={formatCurrency(o.revenue.value, { compact: true })}
            color="#22c55e"
            hint="Revenue attributed to organic leads"
          />
          <StatTile
            label="Lead → Purchase"
            value={formatPercent(leadToPurchaseRate)}
            color="#22d3ee"
            hint="Purchases ÷ organic leads"
            fillPct={leadToPurchaseRate}
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
