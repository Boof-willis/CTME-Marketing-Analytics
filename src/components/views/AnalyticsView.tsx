"use client";

import {
  Users,
  MousePointerClick,
  UserPlus,
  FileText,
  Target,
  Globe,
  TrendingUp,
  Clock,
} from "lucide-react";
import type { DashboardData } from "@/lib/types";
import { KpiCard, StatTile } from "@/components/KpiCard";
import { ComboChart, Donut } from "@/components/Charts";
import { LeadsByCountry } from "@/components/LeadsByCountry";
import { SectionTitle } from "@/components/ui";
import { formatNumber, formatPercent } from "@/lib/format";

const ACCENT = "#beb086";

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 1) return "0s";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function AnalyticsView({ data }: { data: DashboardData }) {
  const a = data.analytics;
  const totalChannelSessions = a.channels.reduce((acc, c) => acc + c.value, 0) || a.sessions.value;
  const maxPageViews = a.topPages.reduce((m, p) => Math.max(m, p.views), 0) || 1;

  return (
    <div className="space-y-5">
      {/* Volume KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard label="Sessions" metric={a.sessions} display={formatNumber(a.sessions.value)} icon={MousePointerClick} color="#beb086" />
        <KpiCard label="Active Users" metric={a.activeUsers} display={formatNumber(a.activeUsers.value)} icon={Users} color="#22d3ee" />
        <KpiCard label="New Users" metric={a.newUsers} display={formatNumber(a.newUsers.value)} icon={UserPlus} color="#8b5cf6" sublabel="first-time visitors" />
        <KpiCard label="Page Views" metric={a.pageViews} display={formatNumber(a.pageViews.value)} icon={FileText} color="#3b82f6" />
        <KpiCard label="Conversions" metric={a.conversions} display={formatNumber(a.conversions.value)} icon={Target} color="#22c55e" sublabel="key events" />
      </div>

      {/* Engagement strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile
          label="Engagement Rate"
          value={formatPercent(a.engagementRate)}
          color="#22c55e"
          hint="Engaged sessions ÷ sessions"
          good={a.engagementRate >= 50}
          fillPct={a.engagementRate}
        />
        <StatTile
          label="Bounce Rate"
          value={formatPercent(a.bounceRate)}
          color="#ef4444"
          hint="Sessions with no engagement"
          good={a.bounceRate <= 45}
          fillPct={a.bounceRate}
        />
        <StatTile
          label="Avg. Session Duration"
          value={formatDuration(a.avgSessionDuration)}
          color="#22d3ee"
          hint="Average time engaged per session"
        />
      </div>

      {/* Sessions over time */}
      <div className="card p-4">
        <SectionTitle icon={TrendingUp} className="mb-3">
          Sessions & Users Over Time
        </SectionTitle>
        <ComboChart
          data={a.byDay}
          series={[
            { key: "sessions", label: "Sessions", color: ACCENT, type: "area" },
            { key: "users", label: "Active Users", color: "#22d3ee", type: "line" },
          ]}
        />
      </div>

      {/* Channels + Countries */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <SectionTitle icon={Globe} className="mb-4">
            Sessions by Channel
          </SectionTitle>
          <div className="grid grid-cols-1 items-center gap-6 sm:grid-cols-2">
            <Donut
              slices={a.channels}
              centerLabel="sessions"
              centerValue={formatNumber(totalChannelSessions)}
              showLegend={false}
            />
            <div className="space-y-3">
              {a.channels.length ? (
                a.channels.map((c) => {
                  const pct = totalChannelSessions ? Math.round((c.value / totalChannelSessions) * 100) : 0;
                  return (
                    <div key={c.label} className="flex items-center gap-3">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                      <span className="flex-1 truncate text-sm text-ink">{c.label}</span>
                      <span className="text-sm font-semibold text-ink">{formatNumber(c.value)}</span>
                      <span className="w-9 text-right text-[11px] text-ink-faint">{pct}%</span>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-ink-faint">No channel data in this period.</p>
              )}
            </div>
          </div>
        </div>
        <LeadsByCountry countries={a.topCountries} accent={ACCENT} title="Sessions by Country" />
      </div>

      {/* Top pages */}
      <div className="card p-5">
        <SectionTitle icon={FileText} className="mb-4">
          Top Pages
        </SectionTitle>
        {a.topPages.length ? (
          <div className="space-y-3">
            {a.topPages.map((p) => {
              const pct = Math.round((p.views / maxPageViews) * 100);
              return (
                <div key={p.path} className="flex items-center gap-3">
                  <span className="w-48 shrink-0 truncate font-mono text-[13px] text-ink lg:w-72">{p.path}</span>
                  <div className="h-2 flex-1 rounded-full bg-panel">
                    <div className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: ACCENT }} />
                  </div>
                  <span className="w-16 shrink-0 text-right text-sm font-semibold text-ink">{formatNumber(p.views)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-ink-faint">No page data in this period.</p>
        )}
      </div>
    </div>
  );
}
