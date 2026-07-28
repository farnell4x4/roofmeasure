import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createMagicLinkRecord } from "@/lib/billing/auth";
import { sendMagicLinkEmail } from "@/lib/billing/magic-link-email";
import { createBillingRepository } from "@/lib/billing/repository";
import { getRuntimeEnvSnapshot } from "@/lib/config/env";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  email: z.email(),
});

export async function POST(request: NextRequest) {
  try {
    const body = requestSchema.parse(await request.json());
    const repository = await createBillingRepository();
    const env = await getRuntimeEnvSnapshot();
    const user = await repository.findOrCreateUserByEmail(body.email);
    const magicLink = await createMagicLinkRecord(user.userId);
    const appUrl = env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const magicLinkUrl = `${appUrl}/auth/verify?token=${encodeURIComponent(magicLink.token)}`;
    const delivery = await sendMagicLinkEmail(user.email, magicLinkUrl);

    return NextResponse.json({
      sent: true,
      ...(delivery.previewUrl ? { previewUrl: delivery.previewUrl } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send magic link.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
