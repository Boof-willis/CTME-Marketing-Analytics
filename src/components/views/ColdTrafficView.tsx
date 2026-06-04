"use client";

import {
  DollarSign,
  MousePointerClick,
  UserPlus,
  CalendarCheck,
  PhoneCall,
  ShoppingCart,
  UserX,
  TrendingUp,
  Filter,
} from "lucide-react";
import type { DashboardData } from "@/lib/types";
import { KpiCard, StatTile } from "@/components/KpiCard";
import { Funnel } from "@/components/Funnel";
import { LeadsByCountry } from "@/components/LeadsByCountry";
import { SectionTitle } from "@/components/ui";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";

export function PaidTrafficView({ data }: { data: DashboardData }) {
  const c = data.cold;

  return (
    <div className="space-y-5">
      {/* Volume KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Ad Spend" metric={c.adSpend} display={formatCurrency(c.adSpend.value, { compact: true })} icon={DollarSign} color="#f59e0b" higherIsBetter={false} />
        <KpiCard label="Clicks / Page Visits" metric={c.clicks} display={formatNumber(c.clicks.value)} icon={MousePointerClick} color="#3b82f6" />
        <KpiCard label="Leads" metric={c.leads} display={formatNumber(c.leads.value)} icon={UserPlus} color="#22d3ee" sublabel="emails captured" />
        <KpiCard label="Appointments" metric={c.appointments} display={formatNumber(c.appointments.value)} icon={CalendarCheck} color="#8b5cf6" />
        <KpiCard label="Calls Completed" metric={c.callsCompleted} display={formatNumber(c.callsCompleted.value)} icon={PhoneCall} color="#22c55e" />
        <KpiCard label="No-Shows" metric={c.noShows} display={formatNumber(c.noShows.value)} icon={UserX} color="#ef4444" higherIsBetter={false} />
        <KpiCard label="Purchases" metric={c.purchases} display={formatNumber(c.purchases.value)} icon={ShoppingCart} color="#3b82f6" />
        <KpiCard label="Paid Revenue" metric={c.revenue} display={formatCurrency(c.revenue.value, { compact: true })} icon={DollarSign} color="#22c55e" sublabel="from paid leads" />
      </div>

      {/* Funnel + Leads by country, side by side on desktop */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <SectionTitle icon={Filter} className="mb-4">
            Paid Traffic Funnel
          </SectionTitle>
          <Funnel stages={c.funnel} accent="#3b82f6" />
        </div>
        <LeadsByCountry countries={c.countries} accent="#3b82f6" title="Paid Leads by Country" />
      </div>

      <div className="grid grid-cols-1 gap-4">
        {/* Rates + costs */}
        <div className="space-y-4">
          <div>
            <p className="label mb-2 px-1">Funnel conversion rates</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatTile
                label="Call Completed Rate"
                value={formatPercent(c.callCompletedRate)}
                color="#22c55e"
                hint="Calls completed ÷ appointments booked"
                good={c.callCompletedRate >= 60}
                fillPct={c.callCompletedRate}
              />
              <StatTile
                label="Close Rate"
                value={formatPercent(c.closeRate)}
                color="#3b82f6"
                hint="Purchases ÷ calls completed"
                good={c.closeRate >= 25}
                fillPct={c.closeRate}
              />
              <StatTile
                label="No-Show Rate"
                value={formatPercent(c.noShowRate)}
                color="#ef4444"
                hint="No-shows ÷ appointments booked"
                good={c.noShowRate <= 20}
                fillPct={c.noShowRate}
              />
            </div>
          </div>

          <div>
            <p className="label mb-2 px-1">Acquisition costs</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatTile
                label="Cost Per Click"
                value={formatCurrency(c.costPerClick)}
                color="#f59e0b"
                hint="Ad spend ÷ clicks"
              />
              <StatTile
                label="Cost Per Lead"
                value={formatCurrency(c.costPerLead)}
                color="#22d3ee"
                hint="Ad spend ÷ leads"
              />
              <StatTile
                label="Cost to Acquire Customer"
                value={formatCurrency(c.costToAcquireCustomer)}
                color="#8b5cf6"
                hint="Ad spend ÷ purchases (CAC)"
              />
            </div>
          </div>

          {/* ROI summary */}
          <div className="card flex flex-wrap items-center justify-between gap-4 p-4">
            <div className="flex items-center gap-2">
              <TrendingUp size={18} className="text-good" />
              <div>
                <p className="label">Paid Traffic ROAS</p>
                <p className="text-xl font-bold text-ink">
                  {c.adSpend.value ? (c.revenue.value / c.adSpend.value).toFixed(2) + "x" : "—"}
                </p>
              </div>
            </div>
            <div>
              <p className="label">Revenue / CAC</p>
              <p className="text-xl font-bold text-ink">
                {c.costToAcquireCustomer
                  ? ((c.revenue.value / Math.max(c.purchases.value, 1)) / c.costToAcquireCustomer).toFixed(2) + "x"
                  : "—"}
              </p>
            </div>
            <div>
              <p className="label">Lead → Customer</p>
              <p className="text-xl font-bold text-ink">
                {c.leads.value ? formatPercent((c.purchases.value / c.leads.value) * 100) : "—"}
              </p>
            </div>
            <div>
              <p className="label">Spend → Revenue</p>
              <p className="text-xl font-bold text-ink">
                {formatCurrency(c.revenue.value - c.adSpend.value, { compact: true })}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
