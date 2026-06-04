import { config, hasGoogle } from "../config";
import type { DateRange } from "../types";

// -----------------------------------------------------------------------------
// Google Ads adapter via the Google Ads API (GAQL search).
//
// Requires a developer token, an OAuth refresh token and the customer ID.
// We exchange the refresh token for an access token, then run a GAQL query
// for segments.date metrics. Returns null on failure -> demo fallback.
// -----------------------------------------------------------------------------

export interface GoogleMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  byDay: { date: string; spend: number; clicks: number; impressions: number; results: number }[];
}

async function getAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      refresh_token: config.google.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token -> ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

export async function fetchGoogle(range: DateRange): Promise<GoogleMetrics | null> {
  if (!hasGoogle()) return null;
  try {
    const accessToken = await getAccessToken();
    const customerId = config.google.customerId.replace(/-/g, "");
    const query = `
      SELECT segments.date, metrics.cost_micros, metrics.impressions,
             metrics.clicks, metrics.conversions, metrics.conversions_value
      FROM customer
      WHERE segments.date BETWEEN '${range.start}' AND '${range.end}'`;

    const res = await fetch(
      `https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:searchStream`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": config.google.developerToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      },
    );
    if (!res.ok) throw new Error(`Google Ads -> ${res.status} ${await res.text()}`);
    const json = (await res.json()) as any[];

    const byDayMap = new Map<string, { spend: number; clicks: number; impressions: number; results: number; revenue: number }>();
    for (const batch of json) {
      for (const row of batch.results || []) {
        const date = row.segments.date as string;
        const cur = byDayMap.get(date) || { spend: 0, clicks: 0, impressions: 0, results: 0, revenue: 0 };
        cur.spend += Number(row.metrics.costMicros || 0) / 1_000_000;
        cur.clicks += Number(row.metrics.clicks || 0);
        cur.impressions += Number(row.metrics.impressions || 0);
        cur.results += Number(row.metrics.conversions || 0);
        cur.revenue += Number(row.metrics.conversionsValue || 0);
        byDayMap.set(date, cur);
      }
    }
    const byDay = [...byDayMap.entries()].map(([date, v]) => ({ date, ...v }));

    return {
      spend: byDay.reduce((a, b) => a + b.spend, 0),
      impressions: byDay.reduce((a, b) => a + b.impressions, 0),
      clicks: byDay.reduce((a, b) => a + b.clicks, 0),
      conversions: byDay.reduce((a, b) => a + b.results, 0),
      revenue: byDay.reduce((a, b) => a + b.revenue, 0),
      byDay: byDay.map(({ revenue, ...rest }) => rest),
    };
  } catch (err) {
    console.error("[google] live fetch failed, falling back to demo:", err);
    return null;
  }
}
