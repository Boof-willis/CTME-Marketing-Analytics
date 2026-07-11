"use client";

import { useMemo, useState } from "react";
import { Sidebar, type ViewId } from "@/components/Sidebar";
import { Topbar, rangeForPreset } from "@/components/Topbar";
import { SourcesBadge } from "@/components/SourcesBadge";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { OverviewView } from "@/components/views/OverviewView";
import { OperationsView, ScopeSelector, type YearScope } from "@/components/views/OperationsView";
import { PaidTrafficView } from "@/components/views/ColdTrafficView";
import { OrganicTrafficView } from "@/components/views/OrganicTrafficView";
import { AdPlatformView } from "@/components/views/AdPlatformView";
import { AnalyticsView } from "@/components/views/AnalyticsView";
import { GaConnect, GaConnectBanner } from "@/components/views/GaConnect";
import { PlatformNotConnected } from "@/components/views/PlatformNotConnected";
import { useMetrics, type RangeState } from "@/hooks/useMetrics";
import { MetaMark, GoogleMark } from "@/components/icons";
import { DashboardSkeleton, TopProgressBar, type SkeletonVariant } from "@/components/Skeletons";
import { LayoutGrid } from "lucide-react";

type PaidTab = "all" | "meta" | "google";

/** Map the Operations tab's Year / Lifetime scope to a concrete fetch range, so
 *  the operational KPIs (funnel/CRM, range-driven) re-scope alongside the money
 *  cards (annual/lifetime GHL fields) under a single control. */
function rangeForYearScope(scope: YearScope): RangeState {
  if (scope === "lifetime") return rangeForPreset("lifetime");
  const today = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const end = scope === today.getFullYear() ? iso(today) : `${scope}-12-31`;
  return { preset: "custom", start: `${scope}-01-01`, end };
}

const VIEW_META: Record<ViewId, { title: React.ReactNode; subtitle: string; accent: string }> = {
  overview: { title: "Marketing Overview", subtitle: "All traffic · purchases, revenue, refunds & leads", accent: "#beb086" },
  operations: { title: "Operations", subtitle: "Purchasers, net revenue, refunds & retention", accent: "#beb086" },
  paid: { title: "Paid Traffic", subtitle: "Paid acquisition funnel — Meta & Google ads", accent: "#beb086" },
  organic: { title: "Warm Traffic", subtitle: "Organic leads handed to the sales team — meetings, calls & closes", accent: "#22c55e" },
  analytics: { title: "Web Analytics", subtitle: "Website traffic & engagement — Google Analytics 4", accent: "#beb086" },
};

const PAID_TABS = [
  { id: "all" as const, label: "All", icon: LayoutGrid },
  { id: "meta" as const, label: "Meta Ads", icon: MetaMark as unknown as React.ElementType },
  { id: "google" as const, label: "Google Ads", icon: GoogleMark as unknown as React.ElementType },
];

export default function Page() {
  const [view, setView] = useState<ViewId>("overview");
  const [paidTab, setPaidTab] = useState<PaidTab>("all");
  const [range, setRange] = useState<RangeState>(() => rangeForPreset("28d"));
  // Operations tab has its own single control (Year / Lifetime); it drives the
  // fetch range for that tab instead of the global preset picker.
  const [opsScope, setOpsScope] = useState<YearScope>("lifetime");
  const [nonce, setNonce] = useState(0);

  // The Operations tab fetches by its Year/Lifetime scope; every other tab uses
  // the global preset picker. Memoized so identity is stable between renders.
  const effectiveRange = useMemo(
    () => (view === "operations" ? rangeForYearScope(opsScope) : range),
    [view, opsScope, range],
  );
  // nonce forces a refetch on manual refresh without changing the range object identity logic.
  const keyedRange = useMemo(() => ({ ...effectiveRange, _n: nonce }) as RangeState, [effectiveRange, nonce]);
  const { data, loading, error } = useMetrics(keyedRange);

  // Result of returning from the GA4 OAuth flow (?ga=connected|error|noref).
  const gaParam = useMemo(
    () => (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("ga") : null),
    [],
  );

  const vm = VIEW_META[view];
  const rangeLabel = `${effectiveRange.start} → ${effectiveRange.end}`;

  const skeletonVariant: SkeletonVariant =
    view === "overview"
      ? "overview"
      : view === "operations"
        ? "operations"
        : view === "organic"
        ? "organic"
        : view === "analytics"
          ? "analytics"
          : paidTab === "all"
            ? "paid"
            : "platform";

  return (
    <div className="flex min-h-screen">
      <Sidebar active={view} onChange={setView} />

      <main className="relative flex-1 px-4 py-5 lg:px-6">
        {loading && data ? <TopProgressBar /> : null}
        <Topbar
          title={vm.title}
          subtitle={vm.subtitle}
          accent={vm.accent}
          range={range}
          onRangeChange={setRange}
          rangeLabel={rangeLabel}
          onRefresh={() => setNonce((n) => n + 1)}
          sourcesBadge={data ? <SourcesBadge sources={data.meta.sources} /> : null}
          rangeControl={
            view === "operations" ? (
              <ScopeSelector
                years={data ? data.money.byYear.map((y) => y.year) : []}
                scope={opsScope}
                onChange={setOpsScope}
              />
            ) : undefined
          }
        />

        {error ? (
          <div className="card border-bad/40 p-6 text-bad">
            Failed to load dashboard: {error}
          </div>
        ) : loading && !data ? (
          <DashboardSkeleton variant={skeletonVariant} />
        ) : data ? (
          <div className={loading ? "opacity-50 transition-opacity duration-300" : "animate-fade-in-up transition-opacity duration-300"}>
            {view === "overview" && <OverviewView data={data} />}
            {view === "operations" && <OperationsView data={data} scope={opsScope} />}
            {view === "paid" && (
              <div className="space-y-5">
                <SegmentedTabs tabs={PAID_TABS} active={paidTab} onChange={setPaidTab} />
                {paidTab === "all" && <PaidTrafficView data={data} />}
                {paidTab === "meta" &&
                  (data.meta.sources.meta === "live" ? (
                    <AdPlatformView p={data.metaAds} />
                  ) : (
                    <PlatformNotConnected platform="Meta Ads" icon={MetaMark as unknown as React.ElementType} envHint="META_ACCESS_TOKEN · META_AD_ACCOUNT_ID" />
                  ))}
                {paidTab === "google" &&
                  (data.meta.sources.google === "live" ? (
                    <AdPlatformView p={data.googleAds} />
                  ) : (
                    <PlatformNotConnected platform="Google Ads" icon={GoogleMark as unknown as React.ElementType} envHint="GOOGLE_ADS_DEVELOPER_TOKEN · GOOGLE_ADS_REFRESH_TOKEN · GOOGLE_ADS_CUSTOMER_ID" />
                  ))}
              </div>
            )}
            {view === "organic" && <OrganicTrafficView data={data} />}
            {view === "analytics" && (
              <div className="space-y-5">
                {gaParam ? <GaConnectBanner status={gaParam} /> : null}
                {data.meta.sources.ga4 === "disconnected" ? (
                  <GaConnect revoked />
                ) : (
                  <AnalyticsView data={data} />
                )}
              </div>
            )}
          </div>
        ) : null}

        <footer className="mt-8 flex items-center justify-between text-[11px] text-ink-faint">
          <span>CTME Marketing Dashboard</span>
          {data ? <span>Updated {new Date(data.meta.generatedAt).toLocaleString()} · {data.meta.rangeLabel}</span> : null}
        </footer>
      </main>
    </div>
  );
}
