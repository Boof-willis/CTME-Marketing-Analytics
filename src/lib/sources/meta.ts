import { config, hasMeta } from "../config";
import type { DateRange } from "../types";

// -----------------------------------------------------------------------------
// Meta (Facebook/Instagram) Ads adapter via the Marketing API Insights edge.
//
// CTME's preference is to pull ad data through the GHL integration where
// possible. GHL's public API does not currently expose granular Meta spend,
// so for reliable spend / CPC / CPM / impressions we hit the Marketing API
// directly. Connect by setting META_ACCESS_TOKEN + META_AD_ACCOUNT_ID.
// Returns null on failure -> aggregator falls back to demo data.
// -----------------------------------------------------------------------------

export interface MetaCampaign {
  name: string;
  spend: number;
  results: number;
  cpa: number;
  ctr: number;
}

export interface MetaMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  results: number; // conversions attributed to Meta (leads for CTME)
  revenue: number; // purchase conversion value (0 for lead-gen accounts)
  resultLabel: string;
  landingPageViews: number;
  byDay: { date: string; spend: number; clicks: number; impressions: number; results: number }[];
  campaigns: MetaCampaign[];
}

function sumAction(actions: any[], type: string): number {
  return Number((actions || []).find((a: any) => a.action_type === type)?.value || 0);
}

// Conversion action priority. The first action type present in the account's
// insights is used as "results". CTME is lead-gen, so a lead action wins;
// e-commerce accounts would resolve to "purchase".
const RESULT_ACTIONS: { type: string; label: string }[] = [
  { type: "purchase", label: "Purchases" },
  { type: "offsite_conversion.fb_pixel_purchase", label: "Purchases" },
  { type: "lead", label: "Leads" },
  { type: "offsite_conversion.fb_pixel_lead", label: "Leads" },
  { type: "onsite_web_lead", label: "Leads" },
  { type: "leadgen_grouped", label: "Leads" },
  { type: "link_click", label: "Link Clicks" },
];


export async function fetchMeta(range: DateRange): Promise<MetaMetrics | null> {
  if (!hasMeta()) return null;
  try {
    const acct = config.meta.adAccountId.startsWith("act_")
      ? config.meta.adAccountId
      : `act_${config.meta.adAccountId}`;
    const url = new URL(`https://graph.facebook.com/v20.0/${acct}/insights`);
    url.searchParams.set("access_token", config.meta.accessToken);
    url.searchParams.set("time_increment", "1");
    url.searchParams.set("level", "account");
    url.searchParams.set(
      "fields",
      "spend,impressions,clicks,actions,action_values",
    );
    url.searchParams.set(
      "time_range",
      JSON.stringify({ since: range.start, until: range.end }),
    );

    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) throw new Error(`Meta insights -> ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { data?: any[] };

    const rows = json.data || [];

    // Pick ONE result action type for the whole period (consistent label +
    // count), based on aggregated totals across every day — not per-row, which
    // would let the chosen action flip day to day.
    const totals = new Map<string, number>();
    for (const row of rows) {
      for (const a of row.actions || []) {
        totals.set(a.action_type, (totals.get(a.action_type) || 0) + Number(a.value || 0));
      }
    }
    let chosen = { type: "", label: "Results" };
    for (const a of RESULT_ACTIONS) {
      if (totals.has(a.type)) {
        chosen = { type: a.type, label: a.label };
        break;
      }
    }

    const byDay = rows.map((row) => {
      const action = (row.actions || []).find((a: any) => a.action_type === chosen.type);
      return {
        date: row.date_start as string,
        spend: Number(row.spend || 0),
        clicks: Number(row.clicks || 0),
        impressions: Number(row.impressions || 0),
        results: Number(action?.value || 0),
        // Only real purchase revenue counts; lead "values" aren't revenue.
        revenue: Number(
          (row.action_values || []).find(
            (a: any) => a.action_type === "purchase" || a.action_type === "offsite_conversion.fb_pixel_purchase",
          )?.value || 0,
        ),
      };
    });

    const landingPageViews = rows.reduce((a, r) => a + sumAction(r.actions || [], "landing_page_view"), 0);

    // Campaign-level breakdown (one extra call). Tolerate failure.
    let campaigns: MetaCampaign[] = [];
    try {
      const cUrl = new URL(`https://graph.facebook.com/v20.0/${acct}/insights`);
      cUrl.searchParams.set("access_token", config.meta.accessToken);
      cUrl.searchParams.set("level", "campaign");
      cUrl.searchParams.set("fields", "campaign_name,spend,impressions,clicks,actions");
      cUrl.searchParams.set("time_range", JSON.stringify({ since: range.start, until: range.end }));
      cUrl.searchParams.set("limit", "100");
      const cRes = await fetch(cUrl.toString(), { cache: "no-store" });
      if (cRes.ok) {
        const cJson = (await cRes.json()) as { data?: any[] };
        campaigns = (cJson.data || [])
          .map((row) => {
            const spend = Number(row.spend || 0);
            const results = chosen.type ? sumAction(row.actions || [], chosen.type) : 0;
            const clicks = Number(row.clicks || 0);
            const impressions = Number(row.impressions || 0);
            return {
              name: row.campaign_name || "(unnamed)",
              spend,
              results,
              cpa: results ? spend / results : 0,
              ctr: impressions ? (clicks / impressions) * 100 : 0,
            };
          })
          .sort((a, b) => b.spend - a.spend);
      }
    } catch (e) {
      console.warn("[meta] campaign breakdown skipped:", (e as Error).message);
    }

    return {
      spend: byDay.reduce((a, b) => a + b.spend, 0),
      impressions: byDay.reduce((a, b) => a + b.impressions, 0),
      clicks: byDay.reduce((a, b) => a + b.clicks, 0),
      results: byDay.reduce((a, b) => a + b.results, 0),
      revenue: byDay.reduce((a, b) => a + (b as any).revenue, 0),
      resultLabel: chosen.label,
      landingPageViews,
      byDay: byDay.map(({ revenue, ...rest }) => rest),
      campaigns,
    };
  } catch (err) {
    console.error("[meta] live fetch failed, falling back to demo:", err);
    return null;
  }
}
