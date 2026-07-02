import Stripe from "stripe";
import { config, hasStripe } from "../config";
import type { DateRange } from "../types";
import { eachDay, toISO } from "../dates";
import { parseISO } from "date-fns";
import { cached } from "../cache";

const TTL = 5 * 60 * 1000; // 5 minutes

// -----------------------------------------------------------------------------
// Stripe is the authoritative source for money: revenue, purchases (charges),
// unique purchasers (distinct customers) and refunds.
// Returns null on any failure so the aggregator can fall back to demo data.
// -----------------------------------------------------------------------------

/** Minimal buyer identity captured off a charge/refund for the contact drill-down. */
export interface StripeBuyer {
  email: string | null;
  name: string | null;
  /** Net amount of this charge/refund (currency), so drill-downs can sum a
   *  buyer's total spend across multiple transactions. */
  amount: number;
}

export interface StripeMetrics {
  revenueByDay: { date: string; value: number }[];
  purchasesByDay: { date: string; value: number }[];
  revenue: number;
  purchases: number;
  uniquePurchasers: number;
  refunds: number;
  refundAmount: number;
  /** One entry per succeeded charge (repeat buyers recur), for drill-downs. */
  buyers: StripeBuyer[];
  /** One entry per refund, for drill-downs. */
  refundBuyers: StripeBuyer[];
}

function unix(d: string): number {
  return Math.floor(parseISO(d + "T00:00:00").getTime() / 1000);
}

export async function fetchStripe(range: DateRange): Promise<StripeMetrics | null> {
  if (!hasStripe()) return null;
  const key = `stripe:${range.start}:${range.end}:${range.lifetime}`;
  return cached(key, TTL, () => fetchStripeUncached(range));
}

async function fetchStripeUncached(range: DateRange): Promise<StripeMetrics | null> {
  try {
    const stripe = new Stripe(config.stripe.secretKey, { apiVersion: "2024-06-20" });

    const created = {
      gte: unix(range.start),
      lte: unix(range.end) + 86399,
    };

    const days = eachDay(range);
    const revByDay = new Map<string, number>(days.map((d) => [d, 0]));
    const purByDay = new Map<string, number>(days.map((d) => [d, 0]));
    const customers = new Set<string>();

    let revenue = 0;
    let purchases = 0;
    const buyers: StripeBuyer[] = [];
    const refundBuyers: StripeBuyer[] = [];

    // Iterate succeeded charges in the window. Expand the customer so invoice /
    // subscription charges (which often have empty billing_details) still yield
    // an email to match against GHL and a name to display.
    for await (const charge of stripe.charges.list({ created, limit: 100, expand: ["data.customer"] })) {
      if (charge.status !== "succeeded" || !charge.paid) continue;
      const amount = (charge.amount - (charge.amount_refunded || 0)) / 100;
      const day = toISO(new Date(charge.created * 1000));
      revenue += amount;
      purchases += 1;
      revByDay.set(day, (revByDay.get(day) || 0) + amount);
      purByDay.set(day, (purByDay.get(day) || 0) + 1);
      const custObj =
        charge.customer && typeof charge.customer === "object" && !("deleted" in charge.customer)
          ? charge.customer
          : null;
      const cust = typeof charge.customer === "string" ? charge.customer : charge.customer?.id;
      const buyerEmail =
        charge.billing_details?.email || charge.receipt_email || custObj?.email || null;
      if (cust) customers.add(cust);
      else if (buyerEmail) customers.add(buyerEmail);
      buyers.push({
        email: buyerEmail,
        name: charge.billing_details?.name || custObj?.name || null,
        amount,
      });
    }

    // Refunds in the window. Expand the charge AND its customer so we can
    // identify the buyer even when the charge's billing_details are empty.
    let refunds = 0;
    let refundAmount = 0;
    for await (const refund of stripe.refunds.list({ created, limit: 100, expand: ["data.charge.customer"] })) {
      refunds += 1;
      refundAmount += refund.amount / 100;
      const ch = refund.charge && typeof refund.charge !== "string" ? refund.charge : null;
      const rCust =
        ch?.customer && typeof ch.customer === "object" && !("deleted" in ch.customer) ? ch.customer : null;
      refundBuyers.push({
        email: ch?.billing_details?.email || ch?.receipt_email || rCust?.email || null,
        name: ch?.billing_details?.name || rCust?.name || null,
        amount: refund.amount / 100,
      });
    }

    return {
      revenueByDay: days.map((d) => ({ date: d, value: revByDay.get(d) || 0 })),
      purchasesByDay: days.map((d) => ({ date: d, value: purByDay.get(d) || 0 })),
      revenue,
      purchases,
      uniquePurchasers: customers.size,
      refunds,
      refundAmount,
      buyers,
      refundBuyers,
    };
  } catch (err) {
    console.error("[stripe] live fetch failed, falling back to demo:", err);
    return null;
  }
}
