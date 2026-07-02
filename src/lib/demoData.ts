import type {
  AdPlatformMetrics,
  AnalyticsMetrics,
  ColdTrafficMetrics,
  Contact,
  DashboardData,
  DateRange,
  FunnelStage,
  Metric,
  MoneyMetrics,
  OrganicMetrics,
  OverviewMetrics,
  SeriesPoint,
} from "./types";
import { eachDay, humanRange, previousRange, rangeLength } from "./dates";

// -----------------------------------------------------------------------------
// Deterministic demo data. Produces realistic, internally-consistent numbers so
// the dashboard looks production-ready before live APIs are connected. The same
// range always yields the same figures (seeded PRNG keyed off the date).
// -----------------------------------------------------------------------------

function seeded(seedStr: string): () => number {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** Smooth-ish daily series with weekly seasonality. */
function buildSeries(days: string[], base: number, variance: number, rnd: () => number): SeriesPoint[] {
  return days.map((date, i) => {
    const dow = new Date(date + "T00:00:00").getDay();
    const weekend = dow === 0 || dow === 6 ? 0.72 : 1;
    const wave = 1 + Math.sin(i / 3.3) * 0.18;
    const noise = 1 + (rnd() - 0.5) * variance;
    return { date, value: Math.max(0, base * weekend * wave * noise) };
  });
}

function sum(series: SeriesPoint[]): number {
  return series.reduce((a, b) => a + b.value, 0);
}

function deltaPct(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

function metricFrom(
  days: string[],
  prevDays: string[],
  base: number,
  variance: number,
  rnd: () => number,
  round = true,
): Metric {
  const series = buildSeries(days, base, variance, rnd);
  const prevSeries = buildSeries(prevDays, base * (0.82 + rnd() * 0.3), variance, rnd);
  const value = sum(series);
  const prev = sum(prevSeries);
  return {
    value: round ? Math.round(value) : value,
    deltaPct: deltaPct(value, prev),
    series,
  };
}

function funnel(stages: { label: string; value: number }[]): FunnelStage[] {
  return stages.map((s, i) => ({
    label: s.label,
    value: Math.round(s.value),
    rateFromPrev: i === 0 ? null : stages[i - 1].value ? (s.value / stages[i - 1].value) * 100 : null,
  }));
}

// ---- Demo contacts ----------------------------------------------------------
const DEMO_FIRST = [
  "James", "Olivia", "Liam", "Emma", "Noah", "Ava", "Ethan", "Sophia", "Mason",
  "Isabella", "Lucas", "Mia", "Logan", "Charlotte", "Jackson", "Amelia", "Aiden", "Harper",
];
const DEMO_LAST = [
  "Carter", "Reyes", "Nguyen", "Patel", "OBrien", "Kim", "Schmidt", "Rossi", "Andersson",
  "Haddad", "Walsh", "Fischer", "Moreau", "Costa", "Novak", "Tanaka", "Khan", "Murphy",
];

/** Generate a deterministic set of demo contacts for a widget drill-down. */
function demoContacts(
  rnd: () => number,
  n: number,
  baseTag: string,
  extraTag?: string,
): Contact[] {
  const out: Contact[] = [];
  for (let i = 0; i < n; i++) {
    const f = DEMO_FIRST[Math.floor(rnd() * DEMO_FIRST.length)];
    const l = DEMO_LAST[Math.floor(rnd() * DEMO_LAST.length)];
    const tags = [baseTag];
    if (rnd() > 0.5) tags.push("customer");
    if (extraTag) tags.push(extraTag);
    const area = 200 + Math.floor(rnd() * 700);
    const mid = 100 + Math.floor(rnd() * 900);
    const last = 1000 + Math.floor(rnd() * 9000);
    out.push({
      id: `demo-${baseTag}-${i}`,
      name: `${f} ${l}`,
      email: `${f}.${l}`.toLowerCase() + "@example.com",
      phone: `+1 (${area}) ${mid}-${last}`,
      tags,
      url: null,
    });
  }
  return out;
}

/** Distribute a lead total across countries by fraction (drops empty buckets). */
function countryMix(total: number, mix: [string, number][]): { code: string; value: number }[] {
  return mix
    .map(([code, frac]) => ({ code, value: Math.round(total * frac) }))
    .filter((c) => c.value > 0);
}

export function buildDemoData(range: DateRange): DashboardData {
  const days = eachDay(range);
  const prev = previousRange(range);
  const prevDays = eachDay(prev);
  const len = rangeLength(range);
  const scale = range.lifetime ? 1 : 1; // series already length-aware
  const rnd = seeded(range.start + range.end + (range.lifetime ? "life" : "rng"));

  // ---- Ad spend (split across Meta + Google) -------------------------------
  const metaSpend = metricFrom(days, prevDays, 780, 0.5, rnd, false);
  const googleSpend = metricFrom(days, prevDays, 80, 0.6, rnd, false);

  // ---- Cold traffic funnel volumes -----------------------------------------
  const clicks = metricFrom(days, prevDays, 280, 0.55, rnd);
  const leads = metricFrom(days, prevDays, 36, 0.5, rnd);
  const appts = metricFrom(days, prevDays, 14, 0.55, rnd);
  const callsCompleted = metricFrom(days, prevDays, 9, 0.55, rnd);
  const coldPurchases = metricFrom(days, prevDays, 3.1, 0.7, rnd);
  const noShows = metricFrom(days, prevDays, 3.4, 0.7, rnd);
  const coldRevenue = metricFrom(days, prevDays, 720, 0.7, rnd, false);

  const adSpendTotal = metaSpend.value + googleSpend.value;
  const coldFunnel = funnel([
    { label: "Clicks", value: clicks.value },
    { label: "Leads", value: leads.value },
    { label: "Appointments", value: appts.value },
    { label: "Calls Completed", value: callsCompleted.value },
    { label: "Purchases", value: coldPurchases.value },
  ]);

  const cold: ColdTrafficMetrics = {
    adSpend: { ...metaSpend, value: Math.round(adSpendTotal), deltaPct: metaSpend.deltaPct },
    clicks,
    leads,
    appointments: appts,
    callsCompleted,
    purchases: coldPurchases,
    noShows,
    revenue: { ...coldRevenue, value: Math.round(coldRevenue.value) },
    funnel: coldFunnel,
    countries: countryMix(leads.value, [
      ["US", 0.58], ["AU", 0.16], ["GB", 0.08], ["CA", 0.07], ["NZ", 0.04], ["IN", 0.03], ["??", 0.04],
    ]),
    callCompletedRate: appts.value ? (callsCompleted.value / appts.value) * 100 : 0,
    closeRate: callsCompleted.value ? (coldPurchases.value / callsCompleted.value) * 100 : 0,
    noShowRate: appts.value ? (noShows.value / appts.value) * 100 : 0,
    costPerClick: clicks.value ? adSpendTotal / clicks.value : 0,
    costPerLead: leads.value ? adSpendTotal / leads.value : 0,
    costToAcquireCustomer: coldPurchases.value ? adSpendTotal / coldPurchases.value : 0,
  };

  // ---- Overall dashboard (all traffic, Stripe-authoritative) ---------------
  // Purchases include warm/website/referral on top of cold.
  const purchases = metricFrom(days, prevDays, 8.4, 0.55, rnd);
  const revenue = metricFrom(days, prevDays, 2120, 0.5, rnd, false);
  const refunds = metricFrom(days, prevDays, 0.55, 1.1, rnd);
  const refundAmount = metricFrom(days, prevDays, 120, 1.1, rnd, false);
  const uniqueRatio = 0.72; // some clients purchase more than once
  const uniquePurchasers: Metric = {
    value: Math.round(purchases.value * uniqueRatio),
    deltaPct: purchases.deltaPct,
    series: purchases.series.map((p) => ({ date: p.date, value: p.value * uniqueRatio })),
  };

  const coldLeads = leads.value;
  const warmLeads = Math.round(coldLeads * 0.62);
  const websiteLeads = Math.round(coldLeads * 0.81);

  const revVsPur = days.map((date, i) => ({
    date,
    revenue: revenue.series[i]?.value ?? 0,
    purchases: purchases.series[i]?.value ?? 0,
  }));

  // Sample contacts behind each purchase/refund widget (drill-down popups).
  // Build a pool of unique purchasers, then one row per purchase (repeat buyers
  // recur) so the Purchases popup matches the purchase count and shows pagination.
  const poolSize = Math.min(Math.max(Math.round(uniquePurchasers.value), 6), 50);
  const pool = demoContacts(rnd, poolSize, "warm traffic");
  const purchaseCount = Math.min(Math.max(Math.round(purchases.value), pool.length), 120);
  const purchaseContacts: Contact[] = Array.from(
    { length: purchaseCount },
    () => pool[Math.floor(rnd() * pool.length)],
  );
  const freq = new Map<string, number>();
  purchaseContacts.forEach((c) => freq.set(c.id, (freq.get(c.id) || 0) + 1));
  const aovDemo = purchases.value ? revenue.value / purchases.value : 1500;
  const seenIds = new Set<string>();
  // One row per unique buyer, carrying total spend and transaction count (mirrors
  // the live Stripe→GHL drill-down), most valuable first.
  const purchaserContacts: Contact[] = purchaseContacts
    .filter((c) => (seenIds.has(c.id) ? false : (seenIds.add(c.id), true)))
    .map((c) => {
      const count = freq.get(c.id) || 1;
      const paidCrypto = rnd() < 0.18; // a slice of buyers also paid via crypto
      return {
        ...c,
        purchaseCount: count,
        purchaseValue: Math.round(count * aovDemo),
        paidStripe: true,
        paidCrypto,
        tags: paidCrypto ? [...c.tags, "crypto-payment"] : c.tags,
      };
    })
    .sort((a, b) => (b.purchaseValue || 0) - (a.purchaseValue || 0));
  const repeatPurchaserContacts = purchaserContacts
    .filter((c) => (c.purchaseCount || 0) >= 2)
    .map((c) => ({ ...c, tags: [...c.tags, "repeat buyer"] }));
  const avgRefund = refunds.value ? refundAmount.value / refunds.value : 400;
  const refundContacts = demoContacts(
    rnd,
    Math.min(Math.max(Math.round(refunds.value), 1), 30),
    "cold traffic",
    "refunded",
  ).map((c) => ({ ...c, purchaseValue: Math.round(avgRefund), purchaseCount: 1, paidStripe: true }));

  const overview: OverviewMetrics = {
    uniquePurchasers: { ...uniquePurchasers, contacts: purchaserContacts },
    purchases: { ...purchases, contacts: purchaserContacts },
    revenue: { ...revenue, value: Math.round(revenue.value), contacts: purchaserContacts },
    refunds: { ...refunds, value: Math.round(refunds.value), contacts: refundContacts },
    refundAmount: { ...refundAmount, value: Math.round(refundAmount.value) },
    repeatPurchaserContacts,
    leadsBySource: {
      cold: coldLeads,
      warm: warmLeads,
      website: websiteLeads,
      total: coldLeads + warmLeads + websiteLeads,
    },
    paidChannels: [
      { label: "Meta Ads", value: Math.round(coldLeads * 0.82), color: "#1d8cff" },
      { label: "Google Ads", value: Math.round(coldLeads * 0.13), color: "#ea4335" },
      { label: "Other Paid", value: Math.max(0, coldLeads - Math.round(coldLeads * 0.82) - Math.round(coldLeads * 0.13)), color: "#64748b" },
    ].filter((s) => s.value > 0),
    organicChannels: [
      { label: "Twitter / X", value: Math.round((warmLeads + websiteLeads) * 0.4), color: "#1d9bf0" },
      { label: "Direct", value: Math.round((warmLeads + websiteLeads) * 0.24), color: "#22d3ee" },
      { label: "LinkedIn", value: Math.round((warmLeads + websiteLeads) * 0.14), color: "#0a66c2" },
      { label: "Organic Search", value: Math.round((warmLeads + websiteLeads) * 0.12), color: "#22c55e" },
      { label: "Website form", value: Math.round((warmLeads + websiteLeads) * 0.1), color: "#8b5cf6" },
    ].filter((s) => s.value > 0),
    averageOrderValue: purchases.value ? revenue.value / purchases.value : 0,
    lifetimeValue: uniquePurchasers.value ? revenue.value / uniquePurchasers.value : 0,
    netRevenue: revenue.value - refundAmount.value,
    revenueVsPurchasesSeries: revVsPur,
    refundReasons: [
      { label: "Changed mind", value: Math.max(1, Math.round(refunds.value * 0.4)), color: "#3b82f6" },
      { label: "Not a fit", value: Math.max(1, Math.round(refunds.value * 0.3)), color: "#8b5cf6" },
      { label: "Duplicate charge", value: Math.max(0, Math.round(refunds.value * 0.15)), color: "#22d3ee" },
      { label: "Other", value: Math.max(0, Math.round(refunds.value * 0.15)), color: "#64748b" },
    ],
  };

  // ---- Organic ("warm") traffic --------------------------------------------
  const orgLeads = metricFrom(days, prevDays, 26, 0.5, rnd);
  const orgAppts = metricFrom(days, prevDays, 7, 0.55, rnd);
  const orgCalls = metricFrom(days, prevDays, 4.6, 0.55, rnd);
  const orgNoShows = metricFrom(days, prevDays, 1.6, 0.7, rnd);
  const orgPurch = metricFrom(days, prevDays, 2.2, 0.7, rnd);
  const orgRevenue = metricFrom(days, prevDays, 1180, 0.6, rnd, false);
  const ol = orgLeads.value;
  const orgSourceCounts = [
    { label: "Twitter / X", frac: 0.46, color: "#1d9bf0" },
    { label: "Direct", frac: 0.2, color: "#22d3ee" },
    { label: "LinkedIn", frac: 0.12, color: "#0a66c2" },
    { label: "Organic Search", frac: 0.1, color: "#22c55e" },
    { label: "Website form", frac: 0.07, color: "#8b5cf6" },
    { label: "Other", frac: 0.05, color: "#64748b" },
  ];
  const organic: OrganicMetrics = {
    leads: orgLeads,
    appointments: orgAppts,
    callsCompleted: orgCalls,
    noShows: orgNoShows,
    purchases: orgPurch,
    revenue: { ...orgRevenue, value: Math.round(orgRevenue.value) },
    sources: orgSourceCounts.map((s) => ({ label: s.label, value: Math.max(0, Math.round(ol * s.frac)), color: s.color })),
    countries: countryMix(orgLeads.value, [
      ["US", 0.5], ["AU", 0.18], ["GB", 0.1], ["CA", 0.08], ["NZ", 0.05], ["HK", 0.03], ["??", 0.06],
    ]),
    funnel: funnel([
      { label: "Meetings Scheduled", value: orgAppts.value },
      { label: "Meetings Held", value: orgCalls.value },
    ]),
    callCompletedRate: orgAppts.value ? (orgCalls.value / orgAppts.value) * 100 : 0,
    closeRate: orgCalls.value ? (orgPurch.value / orgCalls.value) * 100 : 0,
    noShowRate: orgAppts.value ? (orgNoShows.value / orgAppts.value) * 100 : 0,
  };

  // ---- Money (GHL custom fields are the source of truth; demo approximation).
  // Per-year + lifetime aggregates, with crypto as a separate single-source
  // stream. The daily trend reuses the overall revenue series (live = Stripe).
  const moneyYears = [2023, 2024, 2025, 2026];
  const yearBaseRev: Record<number, number> = {
    2023: 182000,
    2024: 321000,
    2025: 548000,
    2026: 414000, // partial year
  };
  const moneyByYear = moneyYears
    .slice()
    .reverse()
    .map((year) => {
      const rev = yearBaseRev[year] ?? 200000;
      const purch = Math.max(1, Math.round(rev / 1850));
      return {
        year,
        revenue: rev,
        cryptoRevenue: Math.round(rev * 0.11),
        refund: Math.round(rev * 0.03),
        purchases: purch,
        cryptoPurchases: Math.max(1, Math.round(purch * 0.08)),
      };
    });
  const sumYear = (k: keyof (typeof moneyByYear)[number]) =>
    moneyByYear.reduce((a, y) => a + (y[k] as number), 0);
  const mGrossRevenue = sumYear("revenue");
  const mGrossCryptoRevenue = sumYear("cryptoRevenue");
  const mGrossPurchases = sumYear("purchases");
  const mGrossCryptoPurchases = sumYear("cryptoPurchases");
  const mTotalRevenue = mGrossRevenue + mGrossCryptoRevenue;
  const mTotalPurchases = mGrossPurchases + mGrossCryptoPurchases;
  const mGrossRefund = sumYear("refund");
  const money: MoneyMetrics = {
    grossRevenue: mGrossRevenue,
    grossCryptoRevenue: mGrossCryptoRevenue,
    totalRevenue: mTotalRevenue,
    grossRefund: mGrossRefund,
    netRevenue: mTotalRevenue - mGrossRefund,
    grossPurchases: mGrossPurchases,
    grossCryptoPurchases: mGrossCryptoPurchases,
    totalPurchases: mTotalPurchases,
    averageOrderValue: mTotalPurchases ? mTotalRevenue / mTotalPurchases : 0,
    uniquePurchasers: Math.round(mTotalPurchases * 0.72),
    lifetimeValue: 4200,
    pendingInvoices: 6,
    pendingInvoiceValue: 18400,
    cryptoClients: 9,
    byYear: moneyByYear,
    dailyRevenue: revenue.series.map((p) => ({ date: p.date, value: Math.round(p.value) })),
    lastSyncedAt: new Date().toISOString(),
  };

  // ---- Ad platform views ----------------------------------------------------
  const metaAds = buildPlatform("meta", days, prevDays, metaSpend, rnd);
  const googleAds = buildPlatform("google", days, prevDays, googleSpend, rnd);

  // ---- Website analytics (GA4) ----------------------------------------------
  const analytics = buildAnalytics(days, prevDays, rnd);

  return {
    meta: {
      mode: "demo",
      rangeLabel: humanRange(range),
      sources: { ghl: "demo", stripe: "demo", meta: "demo", google: "demo", ga4: "demo" },
      generatedAt: new Date().toISOString(),
    },
    overview,
    money,
    cold,
    organic,
    metaAds,
    googleAds,
    analytics,
  };
}

function buildAnalytics(days: string[], prevDays: string[], rnd: () => number): AnalyticsMetrics {
  const sessions = metricFrom(days, prevDays, 940, 0.45, rnd);
  const activeUsers = metricFrom(days, prevDays, 720, 0.45, rnd);
  const newUsers = metricFrom(days, prevDays, 510, 0.5, rnd);
  const pageViews = metricFrom(days, prevDays, 2600, 0.45, rnd);
  const conversions = metricFrom(days, prevDays, 38, 0.55, rnd);

  const s = sessions.value;
  const channelMix: { label: string; frac: number; color: string }[] = [
    { label: "Organic Search", frac: 0.34, color: "#22c55e" },
    { label: "Direct", frac: 0.24, color: "#22d3ee" },
    { label: "Paid Search", frac: 0.16, color: "#ea4335" },
    { label: "Organic Social", frac: 0.14, color: "#1d9bf0" },
    { label: "Referral", frac: 0.08, color: "#8b5cf6" },
    { label: "Email", frac: 0.04, color: "#f59e0b" },
  ];

  const pagePaths = ["/", "/pricing", "/crypto-tax-guide", "/book-a-call", "/blog/cost-basis", "/about", "/faq", "/contact"];

  return {
    sessions,
    activeUsers,
    newUsers,
    pageViews,
    conversions,
    engagementRate: 54 + rnd() * 14,
    avgSessionDuration: 95 + rnd() * 70,
    bounceRate: 36 + rnd() * 12,
    channels: channelMix
      .map((c) => ({ label: c.label, value: Math.max(0, Math.round(s * c.frac)), color: c.color }))
      .filter((c) => c.value > 0),
    topPages: pagePaths.map((path, i) => ({
      path,
      views: Math.max(0, Math.round(pageViews.value * (0.26 - i * 0.027) * (0.8 + rnd() * 0.4))),
    })),
    topCountries: countryMix(s, [
      ["US", 0.55], ["AU", 0.15], ["GB", 0.09], ["CA", 0.07], ["NZ", 0.04], ["IN", 0.04], ["??", 0.06],
    ]),
    byDay: days.map((date, i) => ({
      date,
      sessions: Math.round(sessions.series[i]?.value ?? 0),
      users: Math.round(activeUsers.series[i]?.value ?? 0),
    })),
  };
}

function buildPlatform(
  platform: "meta" | "google",
  days: string[],
  prevDays: string[],
  investment: Metric,
  rnd: () => number,
): AdPlatformMetrics {
  const isMeta = platform === "meta";
  const impressions = metricFrom(days, prevDays, isMeta ? 9000 : 2400, 0.5, rnd);
  const clicks = metricFrom(days, prevDays, isMeta ? 280 : 95, 0.55, rnd);
  const results = metricFrom(days, prevDays, isMeta ? 17 : 9, 0.55, rnd);
  const purchases = metricFrom(days, prevDays, isMeta ? 3 : 2, 0.6, rnd);
  const revenue = metricFrom(days, prevDays, isMeta ? 1380 : 760, 0.5, rnd, false);
  const inv = investment.value;
  const roasVal = inv ? revenue.value / inv : 0;

  const roas: Metric = {
    value: Number(roasVal.toFixed(2)),
    deltaPct: revenue.deltaPct,
    series: revenue.series.map((p, i) => ({
      date: p.date,
      value: investment.series[i]?.value ? p.value / investment.series[i].value : 0,
    })),
  };

  const accent = isMeta ? "#1d8cff" : "#34a853";
  const names = isMeta
    ? ["Cold — Advantage+ Shopping", "Cold — Lookalike 1%", "Retargeting — 7d Viewers", "Cold — Interest Stack", "Warm — Engagers 30d", "Cold — Broad Test"]
    : ["Search — Brand", "Search — Non-Brand Core", "Performance Max — Cold", "Search — Competitor", "Display — Remarketing", "YouTube — Awareness"];

  const campaigns = names.map((name, i) => {
    const spend = (inv * (0.32 - i * 0.045)) * (0.8 + rnd() * 0.4);
    const res = Math.max(0, Math.round(results.value * (0.34 - i * 0.05) * (0.7 + rnd() * 0.6)));
    return {
      name,
      spend: Math.max(0, spend),
      results: res,
      resultDeltaPct: (rnd() - 0.45) * 60,
      cpa: res ? spend / res : 0,
      ctr: 1 + rnd() * 4,
    };
  });

  const fStages = isMeta
    ? funnel([
        { label: "Clicks", value: clicks.value },
        { label: "Page Views", value: clicks.value * 0.86 },
        { label: "Checkouts", value: clicks.value * 0.12 },
        { label: "Purchases", value: results.value },
      ])
    : funnel([
        { label: "Impressions", value: impressions.value },
        { label: "Clicks", value: clicks.value },
        { label: "Conversions", value: results.value },
      ]);

  const resultsByDay = days.map((date, i) => ({
    date,
    investment: investment.series[i]?.value ?? 0,
    results: results.series[i]?.value ?? 0,
  }));

  void accent;
  return {
    platform,
    resultLabel: isMeta ? "Leads" : "Conversions",
    investment,
    results,
    purchases,
    revenue: { ...revenue, value: Math.round(revenue.value) },
    clicks,
    impressions,
    roas,
    cpc: clicks.value ? inv / clicks.value : 0,
    cpm: impressions.value ? (inv / impressions.value) * 1000 : 0,
    ctr: impressions.value ? (clicks.value / impressions.value) * 100 : 0,
    costPerResult: results.value ? inv / results.value : 0,
    costToAcquireCustomer: purchases.value ? inv / purchases.value : 0,
    funnel: fStages,
    campaigns,
    resultsByDay,
  };
}
