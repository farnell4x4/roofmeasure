import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireBillingUserFromAuthorizationHeader } from "@/lib/billing/auth";
import { createBillingRepository } from "@/lib/billing/repository";
import {
  buildStripeCheckoutIntegrationIdentifier,
  findOrCreateStripeCustomerForUser,
  getStripeBillingPlan,
  getStripeClient,
} from "@/lib/stripe/server";

export const dynamic = "force-dynamic";

const checkoutSchema = z.object({
  planId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireBillingUserFromAuthorizationHeader(
      request.headers.get("authorization"),
    );
    const body = checkoutSchema.parse(await request.json());
    const plan = await getStripeBillingPlan(body.planId);
    if (!plan) {
      return NextResponse.json({ error: "Unknown billing plan." }, { status: 400 });
    }

    const stripe = await getStripeClient();
    const repository = await createBillingRepository();
    const customer = await findOrCreateStripeCustomerForUser(user);
    if (customer.deleted) {
      return NextResponse.json({ error: "Stripe customer is unavailable." }, { status: 500 });
    }

    await repository.updateStripeCustomerId(user.userId, customer.id);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      line_items: [{ price: plan.priceId, quantity: 1 }],
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      customer_update: {
        address: "auto",
        name: "auto",
      },
      client_reference_id: user.userId,
      metadata: {
        app: "roof-tape-measure",
        user_id: user.userId,
        plan_id: plan.id,
      },
      subscription_data: {
        metadata: {
          app: "roof-tape-measure",
          user_id: user.userId,
          plan_id: plan.id,
        },
      },
      success_url: `${request.nextUrl.origin}/billing?checkout=success`,
      cancel_url: `${request.nextUrl.origin}/billing?checkout=cancelled`,
      integration_identifier: buildStripeCheckoutIntegrationIdentifier(),
    });

    if (!session.url) {
      return NextResponse.json({ error: "Stripe did not return a Checkout URL." }, { status: 500 });
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create Checkout session.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
