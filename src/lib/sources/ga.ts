import { config, gaConfigured } from "../config";
import type { DateRange } from "../types";
import { previousRange } from "../dates";
import { cached } from "../cache";
import { getRefreshToken } from "../tokenStore";

// -----------------------------------------------------------------------------
// Google Analytics 4 (GA4) adapter — pure REST (edge/Cloudflare-compatible).
//
// Auth is OAuth: the refresh token comes from the runtime token store (set via
// the in-app /api/ga/connect flow), falling back to the GA4_REFRESH_TOKEN seed.
// Whoever authorized owns the token, so it survives a change of agency.
//
// Return contract:
//   • GaMetrics            -> connected, live data
//   • "disconnected"       -> configured but the token is missing/revoked
//                             (access removed) -> UI shows a Connect button
//   • null                 -> not configured at all -> dashboard stays on demo
// -----------------------------------------------------------------------------

const DATA_API = "https://analyticsdata.googleapis.com/v1beta";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TTL = 5 * 60 * 1000; // 5 minutes

export interface GaMetrics {
  sessions: number;
  activeUsers: number;
  newUsers: number;
  pageViews: number;
  conversions: number;
  engagementRate: number; // 0-100
  avgSessionDuration: number; // seconds
  bounceRate: number; // 0-100
  deltas: {
    sessions: number | null;
    activeUsers: number | null;
    newUsers: number | null;
    pageViews: number | null;
    conversions: number | null;
  };
  channels: { label: string; value: number }[];
  topPages: { path: string; views: number }[];
  topCountries: { code: string; value: number }[];
  byDay: { date: string; sessions: number; users: number }[];
}

export type GaResult = GaMetrics | "disconnected" | null;

/** Raised when the refresh token is rejected (revoked / access removed). */
class GaAuthError extends Error {}

type GaRow = {
  dimensionValues?: ({ value?: string | null } | null)[] | null;
  metricValues?: ({ value?: string | null } | null)[] | null;
};

interface GaReport {
  metricHeaders?: { name?: string | null }[];
  rows?: GaRow[];
}

/** Exchange the refresh token for a short-lived access token. */
async function getAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.ga4.oauthClientId,
      client_secret: config.ga4.oauthClientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    // invalid_grant = the token was revoked or the account lost access.
    if (res.status === 400 || res.status === 401 || /invalid_grant/i.test(text)) {
      throw new GaAuthError(`token exchange rejected: ${text}`);
    }
    throw new Error(`GA4 token -> ${res.status} ${text}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new GaAuthError("no access_token returned");
  return json.access_token;
}

async function runReport(
  accessToken: string,
  propertyId: string,
  body: Record<string, unknown>,
): Promise<GaReport> {
  const res = await fetch(`${DATA_API}/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    // The service account / user no longer has access to the property.
    if (res.status === 401 || res.status === 403) {
      throw new GaAuthError(`report denied: ${res.status} ${text}`);
    }
    throw new Error(`GA4 runReport -> ${res.status} ${text}`);
  }
  return (await res.json()) as GaReport;
}

function rowsToPairs(rows: GaRow[] | undefined): { label: string; value: number }[] {
  return (rows || []).map((r) => ({
    label: r.dimensionValues?.[0]?.value || "(not set)",
    value: Number(r.metricValues?.[0]?.value || 0),
  }));
}

function totalsFrom(report: GaReport): Record<string, number> {
  const headers = (report.metricHeaders || []).map((h) => h?.name || "");
  const values = report.rows?.[0]?.metricValues || [];
  const map: Record<string, number> = {};
  headers.forEach((name, i) => {
    map[name] = Number(values[i]?.value || 0);
  });
  return map;
}

function pctDelta(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

const TOTALS_METRICS = [
  { name: "sessions" },
  { name: "activeUsers" },
  { name: "newUsers" },
  { name: "screenPageViews" },
  { name: "engagementRate" },
  { name: "bounceRate" },
  { name: "averageSessionDuration" },
];

export async function fetchGa(range: DateRange): Promise<GaResult> {
  if (!gaConfigured()) return null;
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return "disconnected"; // configured but never connected

  const key = `ga4:${range.start}:${range.end}:${range.lifetime}`;
  try {
    return await cached(key, TTL, async () => {
      const property = config.ga4.propertyId;
      const prev = previousRange(range);
      const token = await getAccessToken(refreshToken);

      const dateRanges = [{ startDate: range.start, endDate: range.end }];
      const [totalsR, prevR, convR, byDayR, channelR, pageR, countryR] = await Promise.all([
        runReport(token, property, { dateRanges, metrics: TOTALS_METRICS }),
        runReport(token, property, {
          dateRanges: [{ startDate: prev.start, endDate: prev.end }],
          metrics: TOTALS_METRICS,
        }).catch(() => ({}) as GaReport),
        runReport(token, property, { dateRanges, metrics: [{ name: "conversions" }] }).catch(
          () => ({}) as GaReport,
        ),
        runReport(token, property, {
          dateRanges,
          dimensions: [{ name: "date" }],
          metrics: [{ name: "sessions" }, { name: "activeUsers" }],
          orderBys: [{ dimension: { dimensionName: "date" } }],
        }),
        runReport(token, property, {
          dateRanges,
          dimensions: [{ name: "sessionDefaultChannelGroup" }],
          metrics: [{ name: "sessions" }],
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: 10,
        }),
        runReport(token, property, {
          dateRanges,
          dimensions: [{ name: "pagePath" }],
          metrics: [{ name: "screenPageViews" }],
          orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
          limit: 8,
        }),
        runReport(token, property, {
          dateRanges,
          dimensions: [{ name: "countryId" }],
          metrics: [{ name: "sessions" }],
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: 9,
        }),
      ]);

      const totals = totalsFrom(totalsR);
      const prevTotals = totalsFrom(prevR);

      const sessions = totals.sessions || 0;
      const activeUsers = totals.activeUsers || 0;
      const newUsers = totals.newUsers || 0;
      const pageViews = totals.screenPageViews || 0;
      const conversions = Number(convR.rows?.[0]?.metricValues?.[0]?.value || 0);

      const byDay = (byDayR.rows || []).map((r) => {
        const raw = r.dimensionValues?.[0]?.value || ""; // YYYYMMDD
        const date = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
        return {
          date,
          sessions: Number(r.metricValues?.[0]?.value || 0),
          users: Number(r.metricValues?.[1]?.value || 0),
        };
      });

      return {
        sessions,
        activeUsers,
        newUsers,
        pageViews,
        conversions,
        engagementRate: (totals.engagementRate || 0) * 100,
        bounceRate: (totals.bounceRate || 0) * 100,
        avgSessionDuration: totals.averageSessionDuration || 0,
        deltas: {
          sessions: pctDelta(sessions, prevTotals.sessions || 0),
          activeUsers: pctDelta(activeUsers, prevTotals.activeUsers || 0),
          newUsers: pctDelta(newUsers, prevTotals.newUsers || 0),
          pageViews: pctDelta(pageViews, prevTotals.screenPageViews || 0),
          conversions: null,
        },
        channels: rowsToPairs(channelR.rows),
        topPages: rowsToPairs(pageR.rows).map((p) => ({ path: p.label, views: p.value })),
        topCountries: rowsToPairs(countryR.rows).map((c) => ({
          code: (c.label || "??").toUpperCase(),
          value: c.value,
        })),
        byDay,
      } satisfies GaMetrics;
    });
  } catch (err) {
    if (err instanceof GaAuthError) {
      console.warn("[ga4] access revoked / token invalid — prompting reconnect:", err.message);
      return "disconnected";
    }
    console.error("[ga4] live fetch failed, falling back to demo:", err);
    return null;
  }
}
