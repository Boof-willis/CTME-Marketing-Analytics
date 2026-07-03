// -----------------------------------------------------------------------------
// Shared types for the CTME Marketing Dashboard.
// These describe the *normalized* shape the UI consumes, regardless of whether
// the numbers came from GHL, Stripe, Meta, Google Ads or demo data.
// -----------------------------------------------------------------------------

export type TrafficSegment = "cold" | "warm" | "website" | "all";

export type DataMode = "demo" | "live" | "auto";

/** A single point in a time series (one per day inside the selected range). */
export interface SeriesPoint {
  /** ISO date (yyyy-MM-dd). */
  date: string;
  value: number;
}

/** A single CRM contact, used to drill down into the people behind a metric. */
export interface Contact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  tags: string[];
  /** Deep link to the contact record (opens in a new tab), null in demo mode. */
  url: string | null;
  /** Total purchase value attributed to this contact (currency). Set on
   *  purchase drill-downs so the modal can show how much each buyer spent. */
  purchaseValue?: number;
  /** Number of purchases/transactions by this contact (shown when > 1). */
  purchaseCount?: number;
  /** Paid via Stripe (card) — set on purchase drill-downs. */
  paidStripe?: boolean;
  /** Paid via crypto (GHL crypto-payment tag or crypto revenue field). */
  paidCrypto?: boolean;
}

/** A metric with its headline value, trend series and period-over-period delta. */
export interface Metric {
  value: number;
  /** Percent change vs the immediately preceding period of equal length. */
  deltaPct: number | null;
  /** Sparkline / trend data across the selected range. */
  series: SeriesPoint[];
  /** Optional sample of the contacts this metric is comprised of (drill-down). */
  contacts?: Contact[];
}

export interface FunnelStage {
  label: string;
  value: number;
  /** Conversion rate from the previous stage, 0-100. */
  rateFromPrev: number | null;
}

export interface CampaignRow {
  name: string;
  spend: number;
  results: number; // purchases / conversions depending on platform
  resultDeltaPct: number | null;
  cpa: number;
  ctr?: number;
}

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

/** Lead count for a single country (ISO 3166-1 alpha-2 code, e.g. "US"). */
export interface CountryCount {
  /** ISO 3166-1 alpha-2 code, or "??" when unknown. */
  code: string;
  value: number;
}

/** Top-level "Overall" dashboard metrics required by CTME. */
export interface OverviewMetrics {
  uniquePurchasers: Metric;
  purchases: Metric;
  revenue: Metric;
  refunds: Metric;
  refundAmount: Metric;
  /** Revenue split by rail (card / crypto / all) for the SELECTED range —
   *  date-responsive for dated ranges; at Lifetime it uses the all-in GHL
   *  aggregates so the undated "Legacy" revenue still reconciles with Financials.
   *  Drives the Overview revenue card + its All/Stripe/Crypto toggle. */
  railRevenue: { all: number; card: number; crypto: number };
  leadsBySource: {
    cold: number;
    warm: number;
    website: number;
    total: number;
  };
  /** Paid leads by ad channel (Meta, Google, …), from attribution. */
  paidChannels: DonutSlice[];
  /** Organic leads by source channel (Twitter/X, Direct, …), from attribution. */
  organicChannels: DonutSlice[];
  // KPIs
  averageOrderValue: number; // revenue / purchases
  lifetimeValue: number; // revenue / unique purchasers
  netRevenue: number; // revenue - refundAmount
  revenueVsPurchasesSeries: { date: string; revenue: number; purchases: number }[];
  refundReasons: DonutSlice[];
  /** Contacts who purchased more than once (drill-down for repeat purchase rate). */
  repeatPurchaserContacts?: Contact[];
}

/** Cold-traffic funnel dashboard metrics. */
export interface ColdTrafficMetrics {
  adSpend: Metric;
  clicks: Metric; // page visits / clicks (unique where possible)
  leads: Metric;
  appointments: Metric;
  callsCompleted: Metric;
  purchases: Metric;
  noShows: Metric;
  revenue: Metric;
  funnel: FunnelStage[];
  /** Paid leads broken down by country (largest first). */
  countries: CountryCount[];
  // KPIs / rates (0-100 for percentages)
  callCompletedRate: number; // calls completed / appts booked
  closeRate: number; // purchases / calls completed
  noShowRate: number; // no shows / appts booked
  costPerClick: number;
  costPerLead: number;
  costToAcquireCustomer: number; // CAC = spend / purchases
}

/** A single organic traffic source (e.g. Twitter/X, LinkedIn, Direct). */
export interface OrganicSource {
  label: string;
  value: number;
  color: string;
}

/** Organic ("warm" in CTME's vocabulary) traffic dashboard metrics. */
export interface OrganicMetrics {
  leads: Metric;
  appointments: Metric;
  callsCompleted: Metric;
  noShows: Metric;
  purchases: Metric;
  revenue: Metric;
  /** Lead breakdown by attribution source, largest first. */
  sources: OrganicSource[];
  /** Organic leads broken down by country (largest first). */
  countries: CountryCount[];
  funnel: FunnelStage[]; // Leads -> Appointments -> Calls Completed -> Purchases
  callCompletedRate: number;
  closeRate: number;
  noShowRate: number;
  /** How the warm-leads KPI is being counted, and the transition status toward
   *  the accurate per-period count (see the "sent to sales" workflow field). */
  warmTracking?: {
    /** "pipeline" = all currently-tagged warm contacts (interim); "period" =
     *  leads whose sent-to-sales date falls in the selected range (accurate). */
    mode: "pipeline" | "period" | "created";
    /** Contacts currently tagged warm traffic (the live pipeline). */
    pipeline: number;
    /** Share (0-100) of the warm pipeline that has a sent-to-sales date stamped. */
    coverage: number;
  };
}

/** Ad-platform view (Meta or Google). */
export interface AdPlatformMetrics {
  platform: "meta" | "google";
  /** What "results" represents for this account, e.g. "Leads" / "Conversions". */
  resultLabel: string;
  investment: Metric;
  results: Metric; // leads / purchases / conversions depending on tracking
  /** Paid customers attributed to this platform (CRM purchases). */
  purchases: Metric;
  revenue: Metric;
  clicks: Metric;
  impressions: Metric;
  roas: Metric;
  cpc: number;
  cpm: number;
  ctr: number;
  costPerResult: number;
  costToAcquireCustomer: number; // CAC = spend / attributed purchases
  funnel: FunnelStage[];
  campaigns: CampaignRow[];
  resultsByDay: { date: string; investment: number; results: number }[];
}

/** Website analytics (Google Analytics 4) view. */
export interface AnalyticsMetrics {
  sessions: Metric;
  activeUsers: Metric;
  newUsers: Metric;
  pageViews: Metric;
  /** Key events / conversions tracked in GA4. */
  conversions: Metric;
  /** Engaged sessions ÷ sessions, 0-100. */
  engagementRate: number;
  /** Average engagement/session duration, in seconds. */
  avgSessionDuration: number;
  /** Bounce rate, 0-100. */
  bounceRate: number;
  /** Sessions by default channel group (Organic, Direct, Paid, …). */
  channels: DonutSlice[];
  /** Most-viewed pages, largest first. */
  topPages: { path: string; views: number }[];
  /** Sessions by country (ISO-2 code), largest first. */
  topCountries: CountryCount[];
  /** Daily sessions/users for the trend chart. */
  byDay: { date: string; sessions: number; users: number }[];
}

/** Per-year money breakdown (single-source: traditional = Stripe-synced, crypto
 *  = crypto-synced; the two never share a field so repeat-both buyers are exact). */
export interface MoneyYear {
  year: number;
  /** Stripe / traditional revenue for the year. */
  revenue: number;
  /** Crypto revenue for the year. */
  cryptoRevenue: number;
  /** Refunds for the year. */
  refund: number;
  /** Stripe / traditional purchase count for the year. */
  purchases: number;
  /** Crypto purchase count for the year. */
  cryptoPurchases: number;
}

/** Authoritative money metrics, sourced from GHL contact custom fields (synced
 *  from Stripe + crypto). These are lifetime / per-year aggregates, independent
 *  of the date-range picker. The daily trend is the one exception (live Stripe). */
export interface MoneyMetrics {
  // ---- Lifetime totals ----
  /** Stripe / traditional lifetime revenue. */
  grossRevenue: number;
  /** Crypto lifetime revenue. */
  grossCryptoRevenue: number;
  /** grossRevenue + grossCryptoRevenue. */
  totalRevenue: number;
  /** Lifetime refunds (currency). */
  grossRefund: number;
  /** totalRevenue − grossRefund. */
  netRevenue: number;
  /** Stripe / traditional lifetime purchase count. */
  grossPurchases: number;
  /** Crypto lifetime purchase count. */
  grossCryptoPurchases: number;
  /** grossPurchases + grossCryptoPurchases. */
  totalPurchases: number;
  /** totalRevenue / totalPurchases. */
  averageOrderValue: number;
  /** Contacts with any revenue > 0. */
  uniquePurchasers: number;
  /** Average of the GHL "Lifetime Value" field over contacts with value > 0. */
  lifetimeValue: number;
  /** Open invoice count and value still outstanding. */
  pendingInvoices: number;
  pendingInvoiceValue: number;
  /** Contacts carrying the crypto-payment tag (head-count). */
  cryptoClients: number;
  /** Per-year breakdown, most recent year first. */
  byYear: MoneyYear[];
  /** Daily revenue trend for the selected range (live Stripe card payments). */
  dailyRevenue: SeriesPoint[];
  /** Crypto revenue by calendar day, parsed from crypto_payment_history, so the
   *  Overview revenue card can slice crypto by an arbitrary date range (the
   *  aggregate fields above are lifetime/per-year only). */
  cryptoRevByDay: SeriesPoint[];
  /** Individual crypto transactions (date + amount + who), parsed from the
   *  payment-history logs — powers date-range crypto purchase counts and the
   *  Purchases drill-down (one row per crypto payment). */
  cryptoTx: { date: string; amount: number; name: string; email: string | null; url: string | null }[];
  /** Most recent contact sync timestamp (ISO), for a data-freshness indicator. */
  lastSyncedAt: string | null;
}

export interface DashboardData {
  meta: {
    mode: DataMode;
    rangeLabel: string;
    /** Which sources returned live data vs demo. "disconnected" means the
     *  integration is configured but lost access (needs reconnect). */
    sources: Record<string, "live" | "demo" | "disconnected">;
    generatedAt: string;
  };
  overview: OverviewMetrics;
  /** Authoritative money view (GHL custom fields + live Stripe daily trend). */
  money: MoneyMetrics;
  /** Paid traffic (CTME calls this "cold traffic") — combined Meta + Google. */
  cold: ColdTrafficMetrics;
  /** Organic traffic (CTME calls this "warm traffic"). */
  organic: OrganicMetrics;
  metaAds: AdPlatformMetrics;
  googleAds: AdPlatformMetrics;
  /** Website analytics (Google Analytics 4). */
  analytics: AnalyticsMetrics;
}

export interface DateRange {
  /** ISO yyyy-MM-dd inclusive. */
  start: string;
  /** ISO yyyy-MM-dd inclusive. */
  end: string;
  /** True when the user selected "lifetime" rather than a bounded range. */
  lifetime: boolean;
}
