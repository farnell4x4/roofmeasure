export type StripeSubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused"
  | "inactive";

export type BillingUser = {
  userId: string;
  email: string;
  stripeCustomerId: string | null;
  subscriptionId: string | null;
  subscriptionStatus: StripeSubscriptionStatus;
  currentPeriodEnd: string | null;
  subscriptionCancelAt: string | null;
  updatedAt: string;
};

export type BillingMagicLink = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
};

export type BillingEntitlementPayload = {
  user_id: string;
  email: string;
  subscription_active: boolean;
  subscription_cancel_at: string | null;
  plan: string | null;
  issued_at: string;
  expires_at: string;
};

export type BillingUserSummary = {
  userId: string;
  email: string;
  stripeCustomerId: string | null;
  subscriptionStatus: StripeSubscriptionStatus;
  currentPeriodEnd: string | null;
  subscriptionActive: boolean;
  updatedAt: string;
};
