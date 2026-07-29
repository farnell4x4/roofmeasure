import { describe, expect, it } from "vitest";
import { formatSubscriptionStatus, hasBillingAccess, isEntitlementRefreshDue } from "@/lib/billing/access";

describe("billing access helpers", () => {
  it("grants access only for active and trialing subscriptions", () => {
    expect(hasBillingAccess("active")).toBe(true);
    expect(hasBillingAccess("trialing")).toBe(true);
    expect(hasBillingAccess("past_due")).toBe(false);
    expect(hasBillingAccess("canceled")).toBe(false);
    expect(hasBillingAccess("inactive")).toBe(false);
  });

  it("formats statuses for the UI", () => {
    expect(formatSubscriptionStatus("past_due")).toBe("past due");
  });

  it("refreshes entitlements after seven days", () => {
    expect(
      isEntitlementRefreshDue({
        user_id: "user-1",
        email: "example@example.com",
        subscription_active: true,
        plan: "pro",
        issued_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
        expires_at: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    ).toBe(true);
  });
});
