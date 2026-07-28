import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeMagicLinkToken } from "@/lib/billing/auth";
import { toBillingUserSummary } from "@/lib/billing/access";
import { createBillingEntitlementForUser } from "@/lib/stripe/server";

export const dynamic = "force-dynamic";

const verifySchema = z.object({
  token: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const body = verifySchema.parse(await request.json());
    const user = await consumeMagicLinkToken(body.token);
    const entitlement = await createBillingEntitlementForUser(user);
    return NextResponse.json({
      entitlementToken: entitlement.token,
      user: toBillingUserSummary(user),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not verify magic link.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
