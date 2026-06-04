# CTME Marketing Dashboard

A unified marketing-performance dashboard for CTME that brings **GoHighLevel (GHL)**,
**Stripe**, **Meta Ads** and **Google Ads** into one dark, embeddable view. It is
designed to be dropped into GHL as a **custom menu link** (iframe) so the team can
answer one question at a glance: *are our marketing efforts working?*

The app ships with realistic **demo data** so it looks complete the moment it runs.
As you connect each integration, that section flips from "Demo" to "Live"
automatically — no code changes required.

---

## What it tracks

### Overview (all traffic)
*Every metric supports a date range **or** lifetime.*

| Metric | Source of truth | Notes |
| --- | --- | --- |
| # Unique purchasers | Stripe (distinct customers) | |
| # Purchases | Stripe (succeeded charges) | counts multiple payments per client |
| Total revenue | Stripe | net of partial refunds per charge |
| # Refunds + refund $ | Stripe refunds / GHL refund flag | see *Refunds* below |
| Net revenue | Stripe | revenue − refunds |
| Leads by source | GHL tags (`cold` / `warm` / `website`) | counts tagged contacts |
| **AOV** | calculated | Total revenue ÷ # purchases |
| **LTV** | GHL "Lifetime Value" custom field | average over contacts with a real (non-zero) value |
| Repeat purchase rate, refund rate | calculated | extras for context |

### Navigation: Paid vs Organic
CTME calls **paid** traffic "cold traffic" and **organic** traffic "warm
traffic". The dashboard separates the two cleanly:

- **Paid Traffic** tab — an **All / Meta Ads / Google Ads** switch at the top.
  - **All** = combined paid funnel + blended cost KPIs (Meta + Google).
  - **Meta Ads / Google Ads** = the per-platform ad views.
- **Organic Traffic** tab — non-paid leads broken down by **real source**
  (Twitter/X, LinkedIn, Direct, Organic Search, Website form, Reddit, Telegram,
  …) plus the organic funnel and conversion rates.

Paid vs organic is determined from each GHL contact's **attribution**
(`utmSource` / `medium` / `sessionSource` / `referrer`), not just tags:
- Paid = `utmSource` of meta/google **or** `medium = paid` (CTME's paid contacts
  are all `utmSource=meta`, tagged `cold traffic` — tags and attribution agree).
- Organic source = referrer host (e.g. `t.co` → Twitter/X) or session source
  (Direct / Organic Search / Social). CRM-entered or CSV-imported contacts are
  bucketed as **Manual / Imported** so true web sources stay clean.

### Paid Traffic — "All" (paid acquisition funnel)
*Every metric supports a date range **or** lifetime.*

- Ad spend, Clicks / page visits, Leads, Appointments booked, Calls completed,
  No-shows, Purchases, Revenue from paid leads
- Full **funnel** (Clicks → Leads → Appointments → Calls → Purchases) with
  step-to-step conversion rates
- **KPIs:** Call Completed Rate (calls ÷ appts), Close Rate (purchases ÷ calls),
  No-Show Rate (no-shows ÷ appts), Cost Per Click, Cost Per Lead, and
  Cost to Acquire Customer (CAC = spend ÷ purchases)

### Organic Traffic
- Organic leads, appointments, calls completed, no-shows, purchases, revenue
- **Leads by source** (donut + ranked breakdown) from contact attribution
- Organic **funnel** (Leads → Appointments → Calls → Purchases) + conversion rates

> **Segment revenue caveat:** paid- and organic-attributed **purchases & revenue**
> come from GHL payments (the only place with the contact↔purchase link), which
> for CTME is sparse vs. Stripe. The Overview totals use Stripe (authoritative);
> the per-segment money figures are approximate. To make them exact we can match
> Stripe customers to GHL paid/organic contacts by email — ask to enable this.

### Meta Ads & Google Ads (inside the Paid tab)
- Investment, results (purchases/conversions), revenue, ROAS, clicks, impressions
- Efficiency strip: Cost/Result, CPC, CPM, CTR
- Investment-vs-results trend, platform funnel, and a per-campaign table

---

## Quick start

```bash
npm install
cp .env.example .env.local   # optional — runs on demo data without it
npm run dev                  # http://localhost:3000
```

Build for production:

```bash
npm run build && npm start
```

---

## Connecting live data

Edit `.env.local`. You can connect sources **one at a time** — anything left blank
stays on demo data. `DATA_MODE=auto` (default) uses live data wherever credentials
exist.

### Stripe (revenue, purchases, unique purchasers, refunds)
```
STRIPE_SECRET_KEY=sk_live_...
```
This is the authoritative money source. Most valuable first integration.

### GoHighLevel (leads by source, appointments, refund flag)
```
GHL_API_TOKEN=...          # Private Integration token or OAuth access token
GHL_LOCATION_ID=...        # the sub-account you're reporting on
```
Traffic-source counting uses contact **tags**. Configure which tags map to each
bucket (defaults shown):
```
GHL_TAG_COLD=cold
GHL_TAG_WARM=warm
GHL_TAG_WEBSITE=website
```
Appointment outcomes map GHL appointment statuses to "completed" vs "no-show":
```
GHL_STATUS_COMPLETED=showed,confirmed,completed
GHL_STATUS_NOSHOW=noshow,no-show
```

#### Refunds
Today you can flag refunds with a **tag** (`GHL_TAG_REFUND=refund`). The cleaner,
recommended approach you described — a **dropdown custom field** with a reason — is
already supported: create the field, then set its key here and the dashboard will
read reasons + dates from it instead of the tag:
```
GHL_REFUND_FIELD_KEY=refund_reason
```
Because Stripe knows the actual refund date and amount, **Stripe is preferred for
refund counts/$**, while the GHL field drives the *reason* breakdown. If a refund
date predates when you applied the dropdown, it can be adjusted manually in GHL.

### Meta Ads
CTME's preference is to pull through GHL where possible. GHL's public API does not
currently expose granular Meta spend/CPC/CPM, so for reliable ad metrics connect the
Meta Marketing API directly:
```
META_ACCESS_TOKEN=...
META_AD_ACCOUNT_ID=act_123...
```

### Google Ads
```
GOOGLE_ADS_DEVELOPER_TOKEN=...
GOOGLE_ADS_CLIENT_ID=...
GOOGLE_ADS_CLIENT_SECRET=...
GOOGLE_ADS_REFRESH_TOKEN=...
GOOGLE_ADS_CUSTOMER_ID=123-456-7890
```

> **Resilience:** every live adapter is wrapped so that an expired token or API
> hiccup silently falls back to demo data for that source — the dashboard never
> shows a broken screen to the team.

---

## Embedding inside GoHighLevel

1. Deploy this app (Vercel is the easiest: `vercel` → set the env vars above).
2. In GHL: **Settings → Custom Menu Links → Add**.
3. Set the URL to your deployment, e.g. `https://ctme-dashboard.vercel.app`.
4. Choose to open it in an **iframe** and select which users/locations see it.

`next.config.mjs` already sends a `frame-ancestors` Content-Security-Policy that
allows GHL / LeadConnector / white-label domains to embed the app.

### Optional access key
To stop the embed URL from being usable outside GHL, set:
```
DASHBOARD_ACCESS_KEY=some-long-random-string
```
Then point the menu link at `https://your-app/?k=some-long-random-string`. Requests
without the matching `k` are rejected.

---

## How it's built

```
src/
  app/
    page.tsx              # dashboard shell: sidebar + view switching + date range
    api/metrics/route.ts  # single JSON endpoint the UI consumes
  components/             # KPI cards, funnel, charts, tables, sidebar, topbar, views
  hooks/useMetrics.ts     # client data fetching keyed on the selected range
  lib/
    types.ts              # normalized metric shapes the UI renders
    sources/
      index.ts            # aggregator: demo baseline + live overrides + KPI recompute
      stripe.ts ghl.ts meta.ts google.ts
    demoData.ts           # deterministic sample data
    dates.ts format.ts config.ts
```

**Data flow:** the UI calls `/api/metrics?start=…&end=…` (or `?lifetime=1`). The
server builds a full demo dataset, overlays live data from any configured source,
recomputes dependent KPIs (AOV, LTV, CPL, CAC, rates), and returns one normalized
`DashboardData` object. The client renders Overview / Cold Traffic / Meta / Google
from that single payload.

---

## Live data status (CTME account)

Both the GHL token and the Stripe secret key are connected, so these are **live**:

- **Revenue, purchases, unique purchasers, refunds + refund $** — from **Stripe**
  (the source of truth for money). Stripe automatically takes precedence over GHL
  payments whenever `STRIPE_SECRET_KEY` is present.
- **Leads by traffic source** — from GHL contact tags (`cold traffic`,
  `warm traffic`, `website`) for the Overview donut, and from contact
  **attribution** for the Organic tab's source breakdown (Twitter/X, LinkedIn,
  Direct, Organic Search, etc.) and the Paid platform split.
- **LTV** — average of the GHL **Lifetime Value** custom field
  (`contact.lifetime_value`) across contacts that have a real, non-zero value;
  contacts with a 0/blank LTV are ignored. This is an all-customers figure, so it
  stays the same across date ranges (unlike AOV, which is revenue ÷ purchases for
  the selected window). Override the field with `GHL_LTV_FIELD_ID` if needed.
- **Appointments / calls completed / no-shows** — from GHL calendar events across
  all booking calendars.
- **Meta Ads** — spend, impressions, clicks, CPC/CPM/CTR, results, real funnel and
  real per-campaign breakdown via the Marketing API.

Still **demo**: **Google Ads** (placeholder credentials — connect real ones to go
live). Source results are cached for 5 minutes per date range, so repeat loads are
instant; the first uncached **Lifetime** load pages full history and can take
10–20s (deploy with a function timeout of 60s+).

### Meta is a lead-gen account
CTME's Meta pixel tracks **leads** (`lead` / `fb_pixel_lead` / `onsite_web_lead`),
not purchases — so the Meta tab labels results as **"Leads"** and shows
**Cost per Lead + CTR** instead of Revenue/ROAS (there's no purchase value in the
pixel; real purchase revenue lives in Stripe → Overview). If you later add purchase
tracking, the tab automatically switches to Revenue/ROAS.

> **Cold-traffic purchase attribution:** cold purchases/revenue are attributed via
> GHL contact tags (a purchase counts as "cold" when the buyer's contact carries the
> `cold traffic` tag). This can legitimately read 0 for a window where cold leads
> haven't converted yet. For tighter attribution we can match Stripe customers to
> GHL cold contacts by email — ask if you want this.

Still **demo** until connected: **ad spend, clicks, impressions, CPC/CPM** (need
the Meta + Google APIs). Because of this, the Cold Traffic cost KPIs (Cost Per
Click, Cost Per Lead, CAC) currently mix *real* purchase/lead counts with *demo*
ad spend — they'll be fully accurate once the ad accounts are connected.

### Two CTME-specific behaviors worth knowing
- **Appointment statuses:** your account uses `confirmed` as the booked status and
  doesn't mark `showed`. So a `confirmed` appointment whose time has **passed** is
  counted as a *completed call*; future `confirmed` appointments are *booked but not
  yet held*; `noshow` is a no-show; `cancelled`/`invalid` are excluded. If your team
  starts using the `showed` status, it's already supported too.
- **Cold vs warm appointments:** any calendar whose name contains "warm" (e.g.
  *CTME Consultation - Warm Traffic*) is treated as warm and excluded from the Cold
  Traffic funnel. Adjust with `GHL_WARM_CALENDAR_HINTS`.

> **Refund reasons** chart is still placeholder data — wire it to real reasons by
> creating the refund dropdown custom field and setting `GHL_REFUND_FIELD_KEY`.

## Notes & assumptions

- **Demo numbers across views are illustrative and independently generated**, so
  e.g. Meta's purchase count won't tie out to the Overview total until live data is
  connected. Once Stripe/GHL/ad APIs are wired, all figures come from real sources.
- "Unique purchasers" uses the Stripe customer ID (falls back to billing email).
- Period-over-period deltas compare against the immediately preceding window of
  equal length.
- Lifetime view anchors a 2-year window for demo history; with live Stripe data it
  reflects your full account history within that window (extend in `dates.ts` if
  you need more).
```
