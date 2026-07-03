import type { DashboardData, DateRange, Metric, MoneyMetrics, SeriesPoint } from "../types";
import { buildDemoData } from "../demoData";
import { config } from "../config";
import { previousRange } from "../dates";
import { fetchStripe, type StripeBuyer, type StripeMetrics } from "./stripe";
import { fetchGhl, lookupContactsByEmails, type GhlMoneyFields } from "./ghl";
import type { Contact } from "../types";
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

  // Previous equal-length window, for REAL period-over-period deltas (skipped for
  // lifetime, where a "previous period" is meaningless). Cached like any range.
  const prevRange = range.lifetime ? null : previousRange(range);
  const [stripe, ghl, meta, google, ga, stripePrev] = await Promise.all([
    fetchStripe(range),
    fetchGhl(range),
    fetchMeta(range),
    fetchGoogle(range),
    fetchGa(range),
    prevRange ? fetchStripe(prevRange) : Promise.resolve(null),
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
    // Real period-over-period deltas from the previous equal-length window —
    // null for lifetime or when there was no prior activity (never demo values).
    const pctChange = (cur: number, prev: number): number | null =>
      prev > 0 ? ((cur - prev) / prev) * 100 : null;
    const revDelta = stripePrev ? pctChange(stripe.revenue, stripePrev.revenue) : null;
    const purDelta = stripePrev ? pctChange(stripe.purchases, stripePrev.purchases) : null;
    const upDelta = stripePrev ? pctChange(stripe.uniquePurchasers, stripePrev.uniquePurchasers) : null;
    const refDelta = stripePrev ? pctChange(stripe.refunds, stripePrev.refunds) : null;
    data.overview.revenue = metric(stripe.revenue, revSeries, revDelta);
    data.overview.purchases = metric(stripe.purchases, purSeries, purDelta);
    data.overview.uniquePurchasers = metric(
      stripe.uniquePurchasers,
      purSeries.map((p) => ({ date: p.date, value: p.value })),
      upDelta,
    );
    // Stripe has no refund-by-day series wired up, so show the real count/amount
    // without a fabricated demo sparkline behind it.
    data.overview.refunds = metric(stripe.refunds, [], refDelta);
    data.overview.refundAmount = metric(stripe.refundAmount, [], null);
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

    // NOTE: GHL payment *transactions* are no longer a money source. The
    // authoritative top-line (revenue / purchases / refunds / AOV / LTV) comes
    // from the synced contact custom fields, assembled into data.money below and
    // applied to the Overview headline by applyOverviewMoney(). GHL payments are
    // still read for the per-day shape and the contact drill-downs only.

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

    // Attach the drill-down contacts behind each purchase/refund widget. These
    // are CRM contacts (GHL is the only source with the contact↔purchase link),
    // so they're set even when Stripe is the authoritative money source.
    if (ghl.contacts) {
      const { purchases, purchasers, repeatPurchasers, refunds } = ghl.contacts;
      // Purchases lists one row per payment; the rest are unique purchasers.
      data.overview.purchases.contacts = purchases.length ? purchases : purchasers;
      data.overview.uniquePurchasers.contacts = purchasers;
      data.overview.revenue.contacts = purchasers;
      data.overview.refunds.contacts = refunds;
      data.overview.repeatPurchaserContacts = repeatPurchasers;
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
    // "Warm traffic" = leads tagged "warm traffic" and handed to the sales team
    // (organic leads worked by a rep, not closed through the email system).
    //
    // GHL has no tag-applied timestamp, so we can't directly count "tagged this
    // period" from the tag alone. A workflow stamps a "sent to sales" date field;
    // once that field covers most of the warm pipeline we count by it (accurate
    // per-period). Until then we show the live pipeline (all currently tagged),
    // falling back to contacts created-and-tagged this period if neither exists.
    const warmPipeline = ghl.money?.warmPipeline ?? 0;
    const warmDates = ghl.money?.warmTaggedDates ?? [];
    const warmCoverage = warmPipeline ? warmDates.length / warmPipeline : 0;
    const READY = 0.8; // switch to per-period once ~80% of warm leads are dated
    let warmLeads: number;
    let warmMode: NonNullable<typeof org.warmTracking>["mode"];
    if (warmPipeline > 0 && warmCoverage >= READY) {
      warmLeads = warmDates.filter((d) => d >= range.start && d <= range.end).length;
      warmMode = "period";
    } else if (warmPipeline > 0) {
      warmLeads = warmPipeline;
      warmMode = "pipeline";
    } else {
      warmLeads = ghl.leads.warm;
      warmMode = "created";
    }
    org.leads = metric(warmLeads, org.leads.series, org.leads.deltaPct);
    org.warmTracking = {
      mode: warmMode,
      pipeline: warmPipeline,
      coverage: Math.round(warmCoverage * 100),
    };
    // Meetings/held/sold are scoped to warm-tagged contacts and deduped to one
    // count per lead (reschedules don't inflate), so the funnel nests under the
    // warm pipeline. Falls back to calendar-based counts if the warm set is
    // unavailable (e.g. the contact scan failed).
    const wm = ghl.warmMeetings;
    if (wm) {
      org.appointments = metric(wm.scheduled, org.appointments.series, null);
      org.callsCompleted = metric(wm.held, org.callsCompleted.series, null);
      org.noShows = metric(wm.noShows, org.noShows.series, null);
    } else {
      org.appointments = metric(Math.max(0, ghl.appointments - ghl.coldAppointments), org.appointments.series, null);
      org.callsCompleted = metric(Math.max(0, ghl.callsCompleted - ghl.coldCallsCompleted), org.callsCompleted.series, null);
      org.noShows = metric(Math.max(0, ghl.noShows - ghl.coldNoShows), org.noShows.series, null);
    }
    // Sold + Revenue come from the contact money custom fields (gross_revenue /
    // crypto, the Stripe-synced source of truth) summed over warm-tagged contacts
    // — i.e. customers cross-referenced with the tag. These are lifetime totals
    // (the fields are aggregates), unlike the range-scoped meetings above.
    if (ghl.money) {
      org.purchases = metric(ghl.money.warmCustomers, org.purchases.series, null);
      org.revenue = metric(ghl.money.warmRevenue, org.revenue.series, null);
    } else if (ghl.payments) {
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
    // The meeting funnel is range-scoped and per-lead (scheduled ≥ held). Sold /
    // Revenue are NOT funnel stages here: they come from lifetime contact money
    // fields, so they'd invert the funnel on a narrow range — they're shown as
    // outcomes instead.
    const wstages = [
      { label: "Meetings Scheduled", value: org.appointments.value },
      { label: "Meetings Held", value: org.callsCompleted.value },
    ];
    org.funnel = wstages.map((s, i) => ({
      label: s.label,
      value: Math.round(s.value),
      rateFromPrev: i === 0 ? null : wstages[i - 1].value ? (s.value / wstages[i - 1].value) * 100 : null,
    }));
  }

  // ---- Money: GHL custom fields are the source of truth -------------------
  // Lifetime / per-year revenue, refunds, purchases (for AOV), the Stripe-vs-
  // crypto split, pending invoices and LTV all come from contact custom fields
  // synced out of Stripe (+ crypto). The daily trend is the one live-Stripe
  // piece (card payments, for the selected range). We only swap in live money
  // once the fields actually carry a signal, so a location that hasn't created
  // them yet keeps the demo placeholder instead of an all-zero panel.
  const m = ghl?.money;
  const hasMoneySignal =
    !!m && (m.grossRevenue > 0 || m.grossCryptoRevenue > 0 || m.pendingInvoiceValue > 0 || m.ltvCount > 0);
  if (hasMoneySignal) {
    data.meta.sources.ghl = "live";
    data.money = buildMoney(m!, stripe);
  } else if (stripe) {
    // No money fields yet — still show a live daily revenue trend from Stripe.
    data.money.dailyRevenue = seriesFrom(stripe.revenueByDay).map((p) => ({
      date: p.date,
      value: Math.round(p.value),
    }));
  }

  // ---- Overview revenue rails (card / crypto / all) -----------------------
  // Date-responsive for a dated range: card = Stripe charges in the window,
  // crypto = the dated payment history in the window. At Lifetime we use the
  // all-in GHL aggregates instead, so the undated "Legacy" revenue is included
  // and the card still reconciles with Financials ($3.2M).
  if (range.lifetime) {
    data.overview.railRevenue = {
      all: data.money.totalRevenue,
      card: data.money.grossRevenue,
      crypto: data.money.grossCryptoRevenue,
    };
  } else {
    const cryptoInRange = data.money.cryptoRevByDay
      .filter((p) => p.date >= range.start && p.date <= range.end)
      .reduce((a, p) => a + p.value, 0);
    const cardInRange = stripe ? stripe.revenue : data.overview.revenue.value;
    data.overview.railRevenue = {
      all: cardInRange + cryptoInRange,
      card: cardInRange,
      crypto: cryptoInRange,
    };
  }

  // ---- Overview purchases: card + crypto, date-scoped, so the Purchases card
  // count equals the drill-down list (one row per transaction). ------------
  const cryptoTxInRange = range.lifetime
    ? data.money.cryptoTx
    : data.money.cryptoTx.filter((t) => t.date >= range.start && t.date <= range.end);
  {
    const cardCount = stripe ? stripe.purchases : data.overview.purchases.value;
    let delta: number | null = null;
    if (!range.lifetime && stripePrev && prevRange) {
      const prevCrypto = data.money.cryptoTx.filter(
        (t) => t.date >= prevRange.start && t.date <= prevRange.end,
      ).length;
      const prevTotal = stripePrev.purchases + prevCrypto;
      delta =
        prevTotal > 0 ? ((cardCount + cryptoTxInRange.length - prevTotal) / prevTotal) * 100 : null;
    }
    data.overview.purchases = {
      ...data.overview.purchases,
      value: cardCount + cryptoTxInRange.length,
      deltaPct: delta,
    };
  }

  // ---- Stripe-authoritative contact drill-downs ---------------------------
  // Build the purchase/refund drill-downs from Stripe's actual charges + the
  // crypto payments in the window, so the Purchases row count matches the card,
  // and enrich each buyer with their GHL contact record by email where one exists.
  if (stripe) {
    await applyStripeContacts(data, stripe, cryptoTxInRange).catch((e) =>
      console.warn("[contacts] stripe drill-down failed:", (e as Error).message),
    );
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

/** Assemble the authoritative money view from GHL custom-field aggregates, with
 *  the daily revenue trend supplied live by Stripe (card payments). */
function buildMoney(m: GhlMoneyFields, stripe: StripeMetrics | null): MoneyMetrics {
  const years = Object.keys(m.revenueByYear)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => b - a);
  const byYear = years.map((year) => ({
    year,
    revenue: m.revenueByYear[year] || 0,
    cryptoRevenue: m.cryptoRevenueByYear[year] || 0,
    refund: m.refundByYear[year] || 0,
    purchases: m.purchasesByYear[year] || 0,
    cryptoPurchases: m.cryptoPurchasesByYear[year] || 0,
  }));
  const totalRevenue = m.grossRevenue + m.grossCryptoRevenue;
  const totalPurchases = m.grossPurchases + m.grossCryptoPurchases;
  return {
    grossRevenue: m.grossRevenue,
    grossCryptoRevenue: m.grossCryptoRevenue,
    totalRevenue,
    grossRefund: m.grossRefund,
    netRevenue: totalRevenue - m.grossRefund,
    grossPurchases: m.grossPurchases,
    grossCryptoPurchases: m.grossCryptoPurchases,
    totalPurchases,
    averageOrderValue: totalPurchases ? totalRevenue / totalPurchases : 0,
    uniquePurchasers: m.uniquePurchasers,
    lifetimeValue: m.ltvAverage,
    pendingInvoices: m.pendingInvoices,
    pendingInvoiceValue: m.pendingInvoiceValue,
    cryptoClients: m.cryptoClients,
    byYear,
    dailyRevenue: stripe
      ? seriesFrom(stripe.revenueByDay).map((p) => ({ date: p.date, value: Math.round(p.value) }))
      : [],
    cryptoRevByDay: Object.entries(m.cryptoRevByDay).map(([date, value]) => ({ date, value })),
    cryptoTx: m.cryptoTx,
    lastSyncedAt: m.lastSyncedAt,
  };
}

/** Build the purchase/refund contact drill-downs from Stripe charges, enriched
 *  with matching GHL contact records (deep link, phone, tags) by email. */
async function applyStripeContacts(
  data: DashboardData,
  stripe: StripeMetrics,
  cryptoTxInRange: MoneyMetrics["cryptoTx"] = [],
) {
  const emails = [...stripe.buyers, ...stripe.refundBuyers]
    .map((b) => b.email)
    .filter((e): e is string => Boolean(e));
  const matched = emails.length ? await lookupContactsByEmails(emails) : new Map<string, Contact>();

  const cryptoTags = config.ghl.tags.crypto;
  const hasCryptoTag = (c: Contact) =>
    c.tags.some((t) => cryptoTags.includes(t.toLowerCase().trim()));

  const toContact = (b: StripeBuyer, i: number): Contact => {
    const m = b.email ? matched.get(b.email.toLowerCase().trim()) : undefined;
    if (m) return m;
    return {
      id: `stripe:${b.email || b.name || i}`,
      name: b.name || b.email || "Unknown contact",
      email: b.email,
      phone: null,
      tags: [],
      url: null,
    };
  };

  const CAP = 500;
  // Aggregate one row per unique buyer: sum their amount and count transactions,
  // keyed by email (falling back to name) so a repeat buyer collapses to a single
  // row showing total value + how many transactions they had.
  const aggregate = (rows: StripeBuyer[]): Contact[] => {
    const key = (b: StripeBuyer, i: number) =>
      (b.email && b.email.toLowerCase().trim()) || (b.name && b.name.toLowerCase().trim()) || `anon:${i}`;
    const agg = new Map<string, { rep: StripeBuyer; index: number; value: number; count: number }>();
    rows.forEach((b, i) => {
      const k = key(b, i);
      const cur = agg.get(k);
      if (cur) {
        cur.value += b.amount;
        cur.count += 1;
      } else {
        agg.set(k, { rep: b, index: i, value: b.amount, count: 1 });
      }
    });
    return [...agg.values()]
      .sort((a, b) => b.value - a.value) // most valuable first
      .slice(0, CAP)
      .map(({ rep, index, value, count }) => {
        const base = toContact(rep, index);
        return {
          ...base,
          purchaseValue: value,
          purchaseCount: count,
          paidStripe: true,
          paidCrypto: hasCryptoTag(base),
        };
      });
  };

  // Aggregate the crypto payments in the window into one row per unique buyer.
  const aggCryptoInRange: Contact[] = (() => {
    const map = new Map<string, Contact>();
    cryptoTxInRange.forEach((t, i) => {
      const k = (t.email && t.email.toLowerCase().trim()) || t.name.toLowerCase().trim() || `c:${i}`;
      const cur = map.get(k);
      if (cur) {
        cur.purchaseValue = (cur.purchaseValue || 0) + t.amount;
        cur.purchaseCount = (cur.purchaseCount || 0) + 1;
      } else {
        map.set(k, {
          id: `crypto:${k}`,
          name: t.name,
          email: t.email,
          phone: null,
          tags: [],
          url: t.url,
          purchaseValue: t.amount,
          purchaseCount: 1,
          paidStripe: false,
          paidCrypto: true,
        });
      }
    });
    return [...map.values()];
  })();

  // Fold crypto buyers into the Stripe purchasers: a buyer who paid both ways
  // merges into one row (both rails flagged); a crypto-only payer is a new row.
  const mergeCrypto = (list: Contact[]): Contact[] => {
    const byEmail = new Map<string, Contact>();
    list.forEach((c) => {
      if (c.email) byEmail.set(c.email.toLowerCase().trim(), c);
    });
    for (const cb of aggCryptoInRange) {
      const existing = cb.email ? byEmail.get(cb.email.toLowerCase().trim()) : undefined;
      if (existing) {
        existing.paidCrypto = true;
        existing.purchaseValue = (existing.purchaseValue || 0) + (cb.purchaseValue || 0);
        if (cb.purchaseCount) existing.purchaseCount = (existing.purchaseCount || 0) + cb.purchaseCount;
      } else {
        list.push({ ...cb });
      }
    }
    return list.sort((a, b) => (b.purchaseValue || 0) - (a.purchaseValue || 0)).slice(0, CAP);
  };

  // Purchases drill-down = ONE ROW PER TRANSACTION (card charge + crypto payment
  // in the window), so the row count matches the Purchases card exactly.
  const cardPurchaseRows: Contact[] = stripe.buyers.map((b, i) => {
    const base = toContact(b, i);
    return { ...base, purchaseValue: b.amount, purchaseCount: 1, paidStripe: true, paidCrypto: hasCryptoTag(base) };
  });
  const cryptoPurchaseRows: Contact[] = cryptoTxInRange.map((t, i) => ({
    id: `cryptotx:${(t.email || t.name || "x").toLowerCase()}:${t.date}:${i}`,
    name: t.name,
    email: t.email,
    phone: null,
    tags: [],
    url: t.url,
    purchaseValue: t.amount,
    purchaseCount: 1,
    paidStripe: false,
    paidCrypto: true,
  }));
  const perPurchase = [...cardPurchaseRows, ...cryptoPurchaseRows]
    .sort((a, b) => (b.purchaseValue || 0) - (a.purchaseValue || 0))
    .slice(0, CAP);

  // Unique Purchasers + Revenue drill into one row per unique buyer.
  const purchasers = mergeCrypto(aggregate(stripe.buyers));
  const repeat = purchasers.filter((c) => (c.purchaseCount || 0) >= 2);

  // Refunds drill-down = one row per refund (Stripe only — crypto refunds aren't
  // tracked as dated records), so its count matches the Refunds card.
  const refundRows = stripe.refundBuyers
    .map((b, i) => {
      const base = toContact(b, i);
      return { ...base, purchaseValue: b.amount, purchaseCount: 1, paidStripe: true };
    })
    .sort((a, b) => (b.purchaseValue || 0) - (a.purchaseValue || 0))
    .slice(0, CAP);

  data.overview.purchases.contacts = perPurchase;
  data.overview.uniquePurchasers.contacts = purchasers;
  data.overview.revenue.contacts = purchasers;
  data.overview.refunds.contacts = refundRows;
  data.overview.repeatPurchaserContacts = repeat;
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
