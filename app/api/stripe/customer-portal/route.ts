import { NextRequest, NextResponse } from "next/server";
import { requireBillingUserFromAuthorizationHeader } from "@/lib/billing/auth";
import { findOrCreateStripeCustomerForUser, getStripeClient } from "@/lib/stripe/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireBillingUserFromAuthorizationHeader(
      request.headers.get("authorization"),
    );
    const stripe = await getStripeClient();
    const customer = await findOrCreateStripeCustomerForUser(user);
    if (customer.deleted) {
      return NextResponse.json({ error: "Stripe customer is unavailable." }, { status: 500 });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: `${request.nextUrl.origin}/billing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not open billing portal.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
