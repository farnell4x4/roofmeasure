import Stripe from "stripe";
import { z } from "zod";
import { hasBillingAccess } from "@/lib/billing/access";
import { createBillingEntitlementToken } from "@/lib/billing/auth";
import { createBillingRepository } from "@/lib/billing/repository";
import { getRuntimeEnvSnapshot } from "@/lib/config/env";
import type { BillingUser } from "@/types/billing";

const stripePlanSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  priceId: z.string().min(1),
  interval: z.enum(["month", "year"]),
});

const stripePlansSchema = z.array(stripePlanSchema);

export type StripeBillingPlan = z.infer<typeof stripePlanSchema>;

let stripeClient: Stripe | null = null;

function randomSuffix(length: number) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function toIsoString(timestamp: number | null | undefined) {
  return typeof timestamp === "number" ? new Date(timestamp * 1000).toISOString() : null;
}

function getSubscriptionCurrentPeriodEnd(subscription: Stripe.Subscription) {
  const firstItem = subscription.items.data[0];
  return typeof firstItem?.current_period_end === "number"
    ? firstItem.current_period_end
    : null;
}

export async function getStripeEnv() {
  const env = await getRuntimeEnvSnapshot();
  return {
    appUrl: env.NEXT_PUBLIC_APP_URL,
    secretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    plansJson: env.STRIPE_BILLING_PLANS_JSON,
  };
}

export async function getStripeClient() {
  const env = await getStripeEnv();
  if (!env.secretKey) {
    throw new Error("Stripe is not configured. Add STRIPE_SECRET_KEY first.");
  }

  if (!stripeClient) {
    stripeClient = new Stripe(env.secretKey, {
      apiVersion: "2026-06-24.dahlia",
      httpClient: Stripe.createFetchHttpClient(),
      timeout: 15_000,
      maxNetworkRetries: 0,
    });
  }

  return stripeClient;
}

export async function getStripeBillingPlans() {
  const env = await getStripeEnv();
  if (!env.plansJson) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(env.plansJson);
  } catch {
    throw new Error("STRIPE_BILLING_PLANS_JSON must be valid JSON.");
  }

  return stripePlansSchema.parse(parsed);
}

export async function getStripeBillingPlan(planId: string) {
  const plans = await getStripeBillingPlans();
  return plans.find((plan) => plan.id === planId) ?? null;
}

export function buildStripeCheckoutIntegrationIdentifier() {
  return `roofmeasure-billing-${randomSuffix(8)}`;
}

async function retrieveExistingCustomer(stripe: Stripe, stripeCustomerId: string) {
  try {
    const customer = await stripe.customers.retrieve(stripeCustomerId);
    return customer.deleted ? null : customer;
  } catch {
    return null;
  }
}

export async function findOrCreateStripeCustomerForUser(user: BillingUser) {
  const stripe = await getStripeClient();
  const repository = await createBillingRepository();

  if (user.stripeCustomerId) {
    const existing = await retrieveExistingCustomer(stripe, user.stripeCustomerId);
    if (existing) {
      return existing;
    }
  }

  const matches = await stripe.customers.list({ email: user.email, limit: 10 });
  const customer =
    matches.data.find((candidate) => candidate.email?.toLowerCase() === user.email.toLowerCase()) ??
    (await stripe.customers.create({
      email: user.email,
      metadata: {
        app: "roof-tape-measure",
        user_id: user.userId,
      },
    }));

  if (!customer.deleted) {
    await stripe.customers.update(customer.id, {
      email: user.email,
      metadata: {
        ...(customer.metadata ?? {}),
        app: "roof-tape-measure",
        user_id: user.userId,
      },
    });
    await repository.updateStripeCustomerId(user.userId, customer.id);
  }

  return customer;
}

export async function refreshBillingUserFromStripe(user: BillingUser) {
  const stripe = await getStripeClient();
  const repository = await createBillingRepository();

  if (!user.stripeCustomerId) {
    return user;
  }

  const subscriptions = await stripe.subscriptions.list({
    customer: user.stripeCustomerId,
    status: "all",
    limit: 10,
  });

  const subscription =
    subscriptions.data.find((candidate) => candidate.status === "active" || candidate.status === "trialing") ??
    subscriptions.data.find((candidate) => candidate.status === "past_due") ??
    subscriptions.data[0] ??
    null;

  await repository.updateSubscriptionState({
    userId: user.userId,
    subscriptionId: subscription?.id ?? null,
    subscriptionStatus: subscription?.status ?? "inactive",
    currentPeriodEnd: toIsoString(subscription ? getSubscriptionCurrentPeriodEnd(subscription) : null),
  });

  return repository.getUserById(user.userId);
}

export async function syncBillingUserFromStripeSubscription(options: {
  userId?: string | null;
  stripeCustomerId?: string | null;
  subscriptionId: string;
  fallbackSubscription?: Stripe.Subscription | null;
}) {
  const stripe = await getStripeClient();
  const repository = await createBillingRepository();

  let subscription = options.fallbackSubscription ?? null;
  try {
    subscription = await stripe.subscriptions.retrieve(options.subscriptionId, {
      expand: ["items.data.price"],
    });
  } catch {
    if (!subscription) {
      throw new Error(`Stripe subscription ${options.subscriptionId} could not be retrieved.`);
    }
  }

  const stripeCustomerId =
    options.stripeCustomerId ??
    (typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id ?? null);
  if (!stripeCustomerId) {
    throw new Error("Stripe subscription is missing a customer ID.");
  }

  const user =
    (options.userId ? await repository.getUserById(options.userId) : null) ??
    (await repository.getUserByStripeCustomerId(stripeCustomerId));
  if (!user) {
    return null;
  }

  await repository.updateStripeCustomerId(user.userId, stripeCustomerId);
  await repository.updateSubscriptionState({
    userId: user.userId,
    subscriptionId: subscription.id,
    subscriptionStatus: subscription.status,
    currentPeriodEnd: toIsoString(getSubscriptionCurrentPeriodEnd(subscription)),
  });

  return repository.getUserById(user.userId);
}

async function resolvePlanIdFromStripeSubscription(subscriptionId: string, plans: StripeBillingPlan[]) {
  const stripe = await getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price"],
  });
  const priceId = subscription.items.data[0]?.price?.id ?? null;
  return plans.find((plan) => plan.priceId === priceId)?.id ?? null;
}

export async function createBillingEntitlementForUser(user: BillingUser) {
  const refreshedUser = user.stripeCustomerId ? await refreshBillingUserFromStripe(user) : user;
  if (!refreshedUser) {
    throw new Error("Billing user not found.");
  }

  const plans = await getStripeBillingPlans();
  const plan =
    refreshedUser.subscriptionId && refreshedUser.subscriptionStatus !== "inactive"
      ? await resolvePlanIdFromStripeSubscription(refreshedUser.subscriptionId, plans)
      : null;

  return createBillingEntitlementToken({
    user_id: refreshedUser.userId,
    subscription_active: hasBillingAccess(refreshedUser.subscriptionStatus),
    plan,
  });
}
