import { NextRequest, NextResponse } from "next/server";
import { requireBillingUserFromAuthorizationHeader } from "@/lib/billing/auth";
import { toBillingUserSummary } from "@/lib/billing/access";
import { createBillingEntitlementForUser } from "@/lib/stripe/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireBillingUserFromAuthorizationHeader(
      request.headers.get("authorization"),
    );
    const entitlement = await createBillingEntitlementForUser(user);
    return NextResponse.json({
      entitlementToken: entitlement.token,
      user: toBillingUserSummary(user),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not refresh entitlement.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
