import { NextResponse } from "next/server";
import { getRuntimeEnvSnapshot } from "@/lib/config/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const env = await getRuntimeEnvSnapshot();
  if (!env.NEXT_PUBLIC_BILLING_ENTITLEMENT_PUBLIC_KEY) {
    return NextResponse.json({ error: "Missing entitlement public key." }, { status: 503 });
  }

  return NextResponse.json(
    { publicKey: env.NEXT_PUBLIC_BILLING_ENTITLEMENT_PUBLIC_KEY },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
