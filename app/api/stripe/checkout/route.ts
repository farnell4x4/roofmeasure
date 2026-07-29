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

function logStage(requestId: string, stage: string, details?: Record<string, unknown>) {
  console.log("[stripe-checkout]", {
    requestId,
    stage,
    time: new Date().toISOString(),
    ...details,
  });
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();

  try {
    logStage(requestId, "request-started");
    const rawBody = await request.json();
    logStage(requestId, "request-body-read", {
      planId: typeof rawBody === "object" && rawBody !== null && "planId" in rawBody
        ? rawBody.planId
        : undefined,
      tokenPresent: request.headers.get("authorization")?.startsWith("Bearer ") ?? false,
    });

    const body = checkoutSchema.parse(rawBody);
    logStage(requestId, "token-verification-started");
    const { user } = await requireBillingUserFromAuthorizationHeader(
      request.headers.get("authorization"),
    );
    logStage(requestId, "token-verification-completed", { userFound: Boolean(user) });

    logStage(requestId, "plan-lookup-started", { planId: body.planId });
    const plan = await getStripeBillingPlan(body.planId);
    logStage(requestId, "plan-lookup-completed", { planFound: Boolean(plan) });
    if (!plan) {
      return NextResponse.json({ error: "Unknown billing plan." }, { status: 400 });
    }

    logStage(requestId, "stripe-client-started");
    const stripe = await getStripeClient();
    logStage(requestId, "stripe-client-completed");

    logStage(requestId, "billing-repository-started");
    const repository = await createBillingRepository();
    logStage(requestId, "billing-repository-completed");

    logStage(requestId, "customer-lookup-started");
    const customer = await findOrCreateStripeCustomerForUser(user);
    logStage(requestId, "customer-lookup-completed", { customerFound: Boolean(customer) });
    if (customer.deleted) {
      return NextResponse.json({ error: "Stripe customer is unavailable." }, { status: 500 });
    }

    logStage(requestId, "customer-record-update-started");
    await repository.updateStripeCustomerId(user.userId, customer.id);
    logStage(requestId, "customer-record-update-completed");

    logStage(requestId, "session-creation-started", { planId: plan.id });
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
      success_url: `${request.nextUrl.origin}/subscription?checkout=success`,
      cancel_url: `${request.nextUrl.origin}/subscription?checkout=cancelled`,
      integration_identifier: buildStripeCheckoutIntegrationIdentifier(),
    });
    logStage(requestId, "session-creation-completed", { sessionCreated: Boolean(session.id) });

    if (!session.url) {
      return NextResponse.json(
        { error: "Stripe did not return a Checkout URL.", requestId },
        { status: 500 },
      );
    }

    return NextResponse.json({ url: session.url, requestId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create Checkout session.";
    console.error("[stripe-checkout]", {
      requestId,
      stage: "request-failed",
      error: message,
    });
    return NextResponse.json({ error: message, requestId }, { status: 500 });
  }
}
