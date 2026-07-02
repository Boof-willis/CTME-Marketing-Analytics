import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { stripe, emailForCustomer, recomputeForEmail } from "@/lib/sync/stripeSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stripe webhook — real-time card-money sync. On any charge/invoice event we
// recompute that customer's email from Stripe (source of truth) and overwrite
// their GHL money fields. Signature-verified with STRIPE_WEBHOOK_SECRET.
export async function POST(req: NextRequest) {
  const secret = config.stripe.webhookSecret;
  const sig = req.headers.get("stripe-signature");
  if (!secret || !sig) {
    return NextResponse.json({ ok: false, error: "webhook not configured" }, { status: 503 });
  }

  const raw = await req.text(); // raw body required for signature verification
  let event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    return NextResponse.json({ ok: false, error: `signature: ${(err as Error).message}` }, { status: 400 });
  }

  // Only charge/invoice events move money totals.
  const relevant = event.type.startsWith("charge.") || event.type.startsWith("invoice.");
  if (!relevant) return NextResponse.json({ received: true, ignored: event.type });

  const obj = event.data.object as { customer?: string | { id?: string } | null };
  const customerId = typeof obj.customer === "string" ? obj.customer : obj.customer?.id;
  if (!customerId) return NextResponse.json({ received: true, note: "no customer on event" });

  try {
    const email = await emailForCustomer(customerId);
    if (!email) return NextResponse.json({ received: true, note: "customer has no email" });
    const result = await recomputeForEmail(email);
    return NextResponse.json({ received: true, event: event.type, result });
  } catch (err) {
    // 200 anyway so Stripe doesn't hammer retries on a transient GHL hiccup; the
    // nightly backfill reconciles anything missed.
    console.error("[sync/stripe/webhook] recompute failed:", err);
    return NextResponse.json({ received: true, error: (err as Error).message });
  }
}
