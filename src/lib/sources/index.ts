import type { DashboardData, DateRange, Metric, SeriesPoint } from "../types";
import { buildDemoData } from "../demoData";
import { config } from "../config";
import { previousRange } from "../dates";
import { fetchStripe } from "./stripe";
import { fetchGhl } from "./ghl";
import { fetchMeta } from "./meta";
import { fetchGoogle } from "./google";
import { fetchGa } from "./ga";

// -----------------------------------------------------------------------------
// The aggregator builds a complete demo dataset as a baseline, then overrides
// individual metrics with live data from any source that has credentials.
// This means the dashboard is always fully populated, and turns "live" piece by
// piece as CTME connects each integration.
// -----------------------------------------------------------------------------

function seriesFrom(byDay: { date: string; value: number }[]): SeriesPoint[] {
  return byDay.map((d) => ({ date: d.date, value: d.value }));
}

function metric(value: number, series: SeriesPoint[], deltaPct: number | null): Metric {
  return { value, series, deltaPct };
}

// Stable colors for organic traffic sources (known brands + a fallback palette).
const SOURCE_COLORS: Record<string, string> = {
  "twitter / x": "#1d9bf0",
  linkedin: "#0a66c2",
  reddit: "#ff4500",
  telegram: "#229ed9",
  youtube: "#ff0000",
  "facebook / instagram": "#1d8cff",
  google: "#ea4335",
  "organic search": "#22c55e",
  "paid search": "#ea4335",
  "paid social": "#1d8cff",
  "organic social": "#1d9bf0",
  referral: "#8b5cf6",
  email: "#f59e0b",
  "social media": "#ec4899",
  direct: "#22d3ee",
  "website form": "#8b5cf6",
  "manual / imported": "#64748b",
  other: "#475569",
};
const PALETTE = ["#3b82f6", "#8b5cf6", "#22d3ee", "#f59e0b", "#22c55e", "#ec4899", "#14b8a6", "#a855f7"];
function sourceColor(label: string, index: number): string {
  return SOURCE_COLORS[label.toLowerCase()] ?? PALETTE[index % PALETTE.length];
}

export async function getDashboardData(range: DateRange): Promise<DashboardData> {
  const data = buildDemoData(range);

  if (config.mode === "demo") return data;

  const [stripe, ghl, meta, google, ga] = await Promise.all([
    fetchStripe(range),
    fetchGhl(range),
    fetchMeta(range),
    fetchGoogle(range),
    fetchGa(range),
  ]);

  // Per-platform paid customers (CRM-attributed, scaled to the authoritative
  // top-line). Populated from GHL below; undefined when GHL isn't connected, in
  // which case platform CAC stays unavailable rather than fabricated.
  let metaPurchases: number | undefined;
  let googlePurchases: number | undefined;

  // ---- Stripe -> authoritative money --------------------------------------
  if (stripe) {
    data.meta.sources.stripe = "live";
    const revSeries = seriesFrom(stripe.revenueByDay);
    const purSeries = seriesFrom(stripe.purchasesByDay);
    data.overview.revenue = metric(stripe.revenue, revSeries, data.overview.revenue.deltaPct);
    data.overview.purchases = metric(stripe.purchases, purSeries, data.overview.purchases.deltaPct);
    data.overview.uniquePurchasers = metric(
      stripe.uniquePurchasers,
      purSeries.map((p) => ({ date: p.date, value: p.value })),
      data.overview.uniquePurchasers.deltaPct,
    );
    data.overview.refunds = metric(stripe.refunds, data.overview.refunds.series, null);
    data.overview.refundAmount = metric(stripe.refundAmount, data.overview.refundAmount.series, null);
    // No refund-reason source exists yet (no GHL "Refund reason" field), so don't
    // show fabricated demo reasons against the real refund count.
    data.overview.refundReasons = [];
    data.overview.averageOrderValue = stripe.purchases ? stripe.revenue / stripe.purchases : 0;
    data.overview.lifetimeValue = stripe.uniquePurchasers ? stripe.revenue / stripe.uniquePurchasers : 0;
    data.overview.netRevenue = stripe.revenue - stripe.refundAmount;
    data.overview.revenueVsPurchasesSeries = revSeries.map((r, i) => ({
      date: r.date,
      revenue: r.value,
      purchases: purSeries[i]?.value ?? 0,
    }));
  }

  // ---- GHL -> contacts, traffic source, appointments, payments ------------
  if (ghl) {
    data.meta.sources.ghl = "live";
    data.overview.leadsBySource = ghl.leads;

    // Source-based channel breakdowns (attribution, not tags) so the Overview
    // matches the Paid and Organic tabs.
    const pc = ghl.paidLeadsByPlatform;
    data.overview.paidChannels = [
      { label: "Meta Ads", value: pc.meta, color: "#1d8cff" },
      { label: "Google Ads", value: pc.google, color: "#ea4335" },
      { label: "Other Paid", value: pc.other, color: "#64748b" },
    ].filter((s) => s.value > 0);
    if (ghl.organicSources.length) {
      data.overview.organicChannels = ghl.organicSources.map((s, i) => ({
        label: s.label,
        value: s.value,
        color: sourceColor(s.label, i),
      }));
    }

    // Use GHL payments for money when Stripe isn't connected (CTME runs
    // invoices through GHL). Stripe, if present, already took precedence above.
    if (!stripe && ghl.payments) {
      const p = ghl.payments;
      const revSeries = seriesFrom(p.revenueByDay);
      const purSeries = seriesFrom(p.purchasesByDay);
      data.overview.revenue = metric(p.revenue, revSeries, data.overview.revenue.deltaPct);
      data.overview.purchases = metric(p.purchases, purSeries, data.overview.purchases.deltaPct);
      data.overview.uniquePurchasers = metric(p.uniquePurchasers, purSeries, data.overview.uniquePurchasers.deltaPct);
      data.overview.refunds = metric(p.refunds, data.overview.refunds.series, null);
      data.overview.refundAmount = metric(p.refundAmount, data.overview.refundAmount.series, null);
      data.overview.refundReasons = [];
      data.overview.averageOrderValue = p.purchases ? p.revenue / p.purchases : 0;
      data.overview.lifetimeValue = p.uniquePurchasers ? p.revenue / p.uniquePurchasers : 0;
      data.overview.netRevenue = p.revenue - p.refundAmount;
      data.overview.revenueVsPurchasesSeries = revSeries.map((r, i) => ({
        date: r.date,
        revenue: r.value,
        purchases: purSeries[i]?.value ?? 0,
      }));
    }

    // Segment money (cold/organic) uses GHL ONLY for the split ratio, applied to
    // the authoritative top-line (Stripe if connected, else GHL). GHL counts raw
    // transactions (installments/recurring inflate them) and can't attribute
    // every payment, so raw attributed counts can exceed the Stripe total. Using
    // the share keeps cold + organic ≤ the authoritative total and reconciles
    // with the Overview numbers.
    const ghlTotalPur = ghl.payments ? ghl.payments.purchases || 0 : 0;
    const ghlTotalRev = ghl.payments ? ghl.payments.revenue || 0 : 0;
    const authPurchases = stripe ? stripe.purchases : ghlTotalPur;
    const authRevenue = stripe ? stripe.revenue : ghlTotalRev;
    const splitPurchases = (attributed: number) =>
      ghlTotalPur ? Math.round(authPurchases * (attributed / ghlTotalPur)) : 0;
    const splitRevenue = (attributed: number) =>
      ghlTotalRev ? authRevenue * (attributed / ghlTotalRev) : 0;

    if (ghl.payments) {
      data.cold.purchases = metric(splitPurchases(ghl.payments.coldPurchases), data.cold.purchases.series, null);
      data.cold.revenue = metric(splitRevenue(ghl.payments.coldRevenue), data.cold.revenue.series, null);
      // Scale each platform's attributed purchases the same way as the cold total
      // so per-platform CAC reconciles with the combined Paid CAC.
      metaPurchases = splitPurchases(ghl.payments.metaPurchases);
      googlePurchases = splitPurchases(ghl.payments.googlePurchases);
    }

    // LTV comes from the GHL "Lifetime Value" custom field (average over contacts
    // with a real, non-zero value) — not revenue / unique purchasers.
    if (ghl.ltv && ghl.ltv.count > 0) {
      data.overview.lifetimeValue = ghl.ltv.average;
    }

    // Cold-traffic funnel volumes from GHL.
    data.cold.leads = metric(ghl.coldLeads, data.cold.leads.series, data.cold.leads.deltaPct);
    data.cold.appointments = metric(ghl.coldAppointments, data.cold.appointments.series, null);
    data.cold.callsCompleted = metric(ghl.coldCallsCompleted, data.cold.callsCompleted.series, null);
    data.cold.noShows = metric(ghl.coldNoShows, data.cold.noShows.series, null);
    if (ghl.paidCountries.length) data.cold.countries = ghl.paidCountries;

    // ---- Organic ("warm") traffic: everything that isn't paid -------------
    // Volumes are derived as total − cold (paid). Source breakdown comes from
    // contact attribution; money is GHL-attributed (the only place with the
    // contact↔purchase link).
    const org = data.organic;
    org.leads = metric(ghl.organicLeads, org.leads.series, org.leads.deltaPct);
    org.appointments = metric(Math.max(0, ghl.appointments - ghl.coldAppointments), org.appointments.series, null);
    org.callsCompleted = metric(Math.max(0, ghl.callsCompleted - ghl.coldCallsCompleted), org.callsCompleted.series, null);
    org.noShows = metric(Math.max(0, ghl.noShows - ghl.coldNoShows), org.noShows.series, null);
    if (ghl.payments) {
      // Organic share of the authoritative top-line (see splitPurchases above).
      org.purchases = metric(splitPurchases(ghl.payments.organicPurchases), org.purchases.series, null);
      org.revenue = metric(splitRevenue(ghl.payments.organicRevenue), org.revenue.series, null);
    }
    if (ghl.organicSources.length) {
      org.sources = ghl.organicSources.map((s, i) => ({ label: s.label, value: s.value, color: sourceColor(s.label, i) }));
    }
    if (ghl.organicCountries.length) org.countries = ghl.organicCountries;
    org.callCompletedRate = org.appointments.value ? (org.callsCompleted.value / org.appointments.value) * 100 : 0;
    org.closeRate = org.callsCompleted.value ? (org.purchases.value / org.callsCompleted.value) * 100 : 0;
    org.noShowRate = org.appointments.value ? (org.noShows.value / org.appointments.value) * 100 : 0;
    // Organic buyers mostly self-serve (they don't book a call), so a strict
    // leads→appt→call→purchase funnel inverts. We show the booking funnel only
    // (leads → appointments → calls completed); purchases/revenue are reported
    // as separate outcomes with a direct lead→purchase rate in the view.
    const ostages = [
      { label: "Leads", value: org.leads.value },
      { label: "Appointments", value: org.appointments.value },
      { label: "Calls Completed", value: org.callsCompleted.value },
    ];
    org.funnel = ostages.map((s, i) => ({
      label: s.label,
      value: Math.round(s.value),
      rateFromPrev: i === 0 ? null : ostages[i - 1].value ? (s.value / ostages[i - 1].value) * 100 : null,
    }));
  }

  // ---- Meta + Google -> ad spend / clicks / impressions -------------------
  // For leads/results we trust GHL (CRM truth) over the platform's own reported
  // conversions when GHL is connected — Meta over-reports because CTME's offline
  // conversion tool fires a lead event per funnel stage (TOF/MOF/BOF).
  if (meta) {
    data.meta.sources.meta = "live";
    applyPlatform(data.metaAds, meta, ghl ? ghl.paidLeadsByPlatform.meta : undefined, metaPurchases);
  }
  if (google) {
    data.meta.sources.google = "live";
    applyPlatform(
      data.googleAds,
      {
        spend: google.spend,
        impressions: google.impressions,
        clicks: google.clicks,
        results: google.conversions,
        revenue: google.revenue,
        byDay: google.byDay,
      },
      ghl ? ghl.paidLeadsByPlatform.google : undefined,
      googlePurchases,
    );
  }

  // ---- Google Analytics 4 -> website analytics ----------------------------
  if (ga === "disconnected") {
    // Configured but access was revoked (or never connected) — flag it so the
    // UI shows a "Connect Google Analytics" prompt instead of demo numbers.
    data.meta.sources.ga4 = "disconnected";
  } else if (ga) {
    data.meta.sources.ga4 = "live";
    const a = data.analytics;
    const sessionSeries = ga.byDay.map((d) => ({ date: d.date, value: d.sessions }));
    const userSeries = ga.byDay.map((d) => ({ date: d.date, value: d.users }));
    const pvShape = sessionSeries; // GA byDay doesn't carry pageviews; reuse session shape
    a.sessions = metric(ga.sessions, sessionSeries, ga.deltas.sessions);
    a.activeUsers = metric(ga.activeUsers, userSeries, ga.deltas.activeUsers);
    a.newUsers = metric(ga.newUsers, userSeries, ga.deltas.newUsers);
    a.pageViews = metric(ga.pageViews, pvShape, ga.deltas.pageViews);
    a.conversions = metric(ga.conversions, sessionSeries, ga.deltas.conversions);
    a.engagementRate = ga.engagementRate;
    a.avgSessionDuration = ga.avgSessionDuration;
    a.bounceRate = ga.bounceRate;
    if (ga.channels.length) {
      a.channels = ga.channels.map((c, i) => ({ label: c.label, value: c.value, color: sourceColor(c.label, i) }));
    }
    if (ga.topPages.length) a.topPages = ga.topPages;
    if (ga.topCountries.length) a.topCountries = ga.topCountries;
    if (ga.byDay.length) a.byDay = ga.byDay;
  }

  // ---- Recompute cold-traffic cost KPIs from whichever spend is live ------
  recomputeColdKpis(data);

  return data;
}

function applyPlatform(
  target: DashboardData["metaAds"],
  src: {
    spend: number;
    impressions: number;
    clicks: number;
    results: number;
    revenue: number;
    resultLabel?: string;
    landingPageViews?: number;
    byDay: { date: string; spend: number; clicks: number; impressions: number; results: number }[];
    campaigns?: { name: string; spend: number; results: number; cpa: number; ctr?: number }[];
  },
  // When set, use GHL's real CRM lead count for this platform instead of the
  // platform-reported results. CTME's offline-conversion tool fires separate
  // Meta "lead" events per funnel stage (TOF/MOF/BOF), which ~3x inflates Meta's
  // reported leads — GHL contacts are the source of truth.
  ghlLeads?: number,
  // Paid customers attributed to this platform by the CRM (already scaled to the
  // authoritative Stripe/GHL total). When set, drives the platform CAC.
  platformPurchases?: number,
) {
  const usingGhl = typeof ghlLeads === "number";
  const results = usingGhl ? ghlLeads : src.results;
  if (usingGhl) target.resultLabel = "Leads";
  else if (src.resultLabel) target.resultLabel = src.resultLabel;
  target.investment = metric(src.spend, src.byDay.map((d) => ({ date: d.date, value: d.spend })), target.investment.deltaPct);
  target.clicks = metric(src.clicks, src.byDay.map((d) => ({ date: d.date, value: d.clicks })), target.clicks.deltaPct);
  target.impressions = metric(src.impressions, src.byDay.map((d) => ({ date: d.date, value: d.impressions })), target.impressions.deltaPct);

  // Daily results: keep the platform's day-shape but scale it to sum to the GHL
  // total (fall back to clicks-shape if the platform reported no daily results).
  const baseVals = src.results > 0 ? src.byDay.map((d) => d.results) : src.byDay.map((d) => d.clicks);
  const baseSum = baseVals.reduce((a, b) => a + b, 0) || 1;
  const resultSeries = src.byDay.map((d, i) => ({
    date: d.date,
    value: usingGhl ? (baseVals[i] / baseSum) * results : d.results,
  }));
  target.results = metric(results, resultSeries, target.results.deltaPct);
  // Always set revenue (even to 0) so demo revenue can't leak through for
  // lead-gen accounts that report no purchase value.
  target.revenue = metric(src.revenue, target.revenue.series, src.revenue ? target.revenue.deltaPct : null);
  target.cpc = src.clicks ? src.spend / src.clicks : 0;
  target.cpm = src.impressions ? (src.spend / src.impressions) * 1000 : 0;
  target.ctr = src.impressions ? (src.clicks / src.impressions) * 100 : 0;
  target.costPerResult = results ? src.spend / results : 0;

  // CAC = spend / customers acquired. Customers come from CRM attribution (GHL);
  // without it we can't honestly attribute purchases to a platform, so leave 0
  // (the UI renders "—"). Spread the daily series proportional to spend.
  const purchases = typeof platformPurchases === "number" ? platformPurchases : 0;
  const spendSum = src.byDay.reduce((a, d) => a + d.spend, 0) || 1;
  const purchaseSeries = src.byDay.map((d) => ({ date: d.date, value: (d.spend / spendSum) * purchases }));
  target.purchases = metric(purchases, purchaseSeries, target.purchases.deltaPct);
  target.costToAcquireCustomer = purchases ? src.spend / purchases : 0;
  target.roas = metric(src.spend ? target.revenue.value / src.spend : 0, target.roas.series, target.roas.deltaPct);
  target.resultsByDay = resultSeries.map((d) => ({ date: d.date, investment: src.byDay.find((b) => b.date === d.date)?.spend ?? 0, results: d.value }));

  // Rebuild the funnel from real data: Clicks -> Landing Page Views -> Results.
  const lpv = src.landingPageViews ?? Math.round(src.clicks * 0.85);
  const fstages = [
    { label: "Clicks", value: src.clicks },
    { label: "Landing Page Views", value: lpv },
    { label: target.resultLabel || "Results", value: results },
  ];
  target.funnel = fstages.map((s, i) => ({
    label: s.label,
    value: Math.round(s.value),
    rateFromPrev: i === 0 ? null : fstages[i - 1].value ? (s.value / fstages[i - 1].value) * 100 : null,
  }));

  // Real campaigns (only when the platform returned them). When using GHL leads,
  // scale each campaign's results by the same ratio so the table reconciles with
  // the headline number (GHL has no per-campaign attribution).
  if (src.campaigns && src.campaigns.length) {
    const campTotal = src.campaigns.reduce((a, c) => a + c.results, 0) || 1;
    const scale = usingGhl ? results / campTotal : 1;
    target.campaigns = src.campaigns.map((c) => ({
      name: c.name,
      spend: c.spend,
      results: usingGhl ? Math.round(c.results * scale) : c.results,
      resultDeltaPct: null,
      cpa: usingGhl ? (c.results * scale ? c.spend / (c.results * scale) : 0) : c.cpa,
      ctr: c.ctr,
    }));
  }
}

function recomputeColdKpis(data: DashboardData) {
  // Only fold in ad platforms that returned live data, so demo spend/clicks from
  // an unconnected platform don't pollute real cost KPIs. Falls back to the demo
  // blended total when no ad platform is connected yet.
  const livePlatforms = [
    data.meta.sources.meta === "live" ? data.metaAds : null,
    data.meta.sources.google === "live" ? data.googleAds : null,
  ].filter(Boolean) as DashboardData["metaAds"][];

  const c = data.cold;
  if (livePlatforms.length > 0) {
    const spend = livePlatforms.reduce((a, p) => a + p.investment.value, 0);
    const platformClicks = livePlatforms.reduce((a, p) => a + p.clicks.value, 0);
    data.cold.adSpend = metric(spend, data.cold.adSpend.series, data.cold.adSpend.deltaPct);
    if (platformClicks > 0) c.clicks = metric(platformClicks, c.clicks.series, c.clicks.deltaPct);
  }
  const spend = data.cold.adSpend.value;
  c.callCompletedRate = c.appointments.value ? (c.callsCompleted.value / c.appointments.value) * 100 : 0;
  c.closeRate = c.callsCompleted.value ? (c.purchases.value / c.callsCompleted.value) * 100 : 0;
  c.noShowRate = c.appointments.value ? (c.noShows.value / c.appointments.value) * 100 : 0;
  c.costPerClick = c.clicks.value ? spend / c.clicks.value : 0;
  c.costPerLead = c.leads.value ? spend / c.leads.value : 0;
  c.costToAcquireCustomer = c.purchases.value ? spend / c.purchases.value : 0;

  // Rebuild the funnel from current (possibly live) stage volumes.
  const stages = [
    { label: "Clicks", value: c.clicks.value },
    { label: "Leads", value: c.leads.value },
    { label: "Appointments", value: c.appointments.value },
    { label: "Calls Completed", value: c.callsCompleted.value },
    { label: "Purchases", value: c.purchases.value },
  ];
  c.funnel = stages.map((s, i) => ({
    label: s.label,
    value: Math.round(s.value),
    rateFromPrev: i === 0 ? null : stages[i - 1].value ? (s.value / stages[i - 1].value) * 100 : null,
  }));
}

export { previousRange };
