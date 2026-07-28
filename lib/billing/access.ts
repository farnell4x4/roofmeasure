import type {
  BillingEntitlementPayload,
  BillingUser,
  BillingUserSummary,
  StripeSubscriptionStatus,
} from "@/types/billing";

export function hasBillingAccess(status: StripeSubscriptionStatus) {
  return status === "active" || status === "trialing";
}

export function formatSubscriptionStatus(status: StripeSubscriptionStatus) {
  return status.replace(/_/g, " ");
}

export function toBillingUserSummary(user: BillingUser): BillingUserSummary {
  return {
    userId: user.userId,
    email: user.email,
    stripeCustomerId: user.stripeCustomerId,
    subscriptionStatus: user.subscriptionStatus,
    currentPeriodEnd: user.currentPeriodEnd,
    subscriptionActive: hasBillingAccess(user.subscriptionStatus),
    updatedAt: user.updatedAt,
  };
}

export function isEntitlementRefreshDue(entitlement: BillingEntitlementPayload) {
  return Date.now() - Date.parse(entitlement.issued_at) >= 7 * 24 * 60 * 60 * 1000;
}
