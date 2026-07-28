import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripeClient, getStripeEnv, syncBillingUserFromStripeSubscription } from "@/lib/stripe/server";

export const dynamic = "force-dynamic";

function getInvoiceSubscriptionId(invoice: Stripe.Invoice) {
  const subscriptionDetails =
    invoice.parent?.type === "subscription_details"
      ? invoice.parent.subscription_details
      : null;
  const subscription = subscriptionDetails?.subscription ?? null;
  return typeof subscription === "string" ? subscription : subscription?.id ?? null;
}

async function processWebhookEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription" || typeof session.subscription !== "string") {
        return;
      }
      await syncBillingUserFromStripeSubscription({
        userId:
          typeof session.client_reference_id === "string" && session.client_reference_id.length > 0
            ? session.client_reference_id
            : typeof session.metadata?.user_id === "string"
              ? session.metadata.user_id
              : null,
        stripeCustomerId: typeof session.customer === "string" ? session.customer : null,
        subscriptionId: session.subscription,
      });
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      await syncBillingUserFromStripeSubscription({
        userId: typeof subscription.metadata?.user_id === "string" ? subscription.metadata.user_id : null,
        stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : null,
        subscriptionId: subscription.id,
        fallbackSubscription: subscription,
      });
      return;
    }
    case "invoice.paid":
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = getInvoiceSubscriptionId(invoice);
      if (!subscriptionId) return;
      await syncBillingUserFromStripeSubscription({
        stripeCustomerId: typeof invoice.customer === "string" ? invoice.customer : null,
        subscriptionId,
      });
      return;
    }
    default:
      return;
  }
}

export async function POST(request: Request) {
  const stripe = await getStripeClient();
  const env = await getStripeEnv();
  const signature = request.headers.get("stripe-signature");

  if (!env.webhookSecret) {
    return NextResponse.json({ error: "Missing STRIPE_WEBHOOK_SECRET." }, { status: 500 });
  }

  if (!signature) {
    return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });
  }

  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, env.webhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid webhook signature.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    await processWebhookEvent(event);
    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook processing failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
