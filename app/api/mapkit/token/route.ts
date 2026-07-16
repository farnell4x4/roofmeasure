import { SignJWT, importPKCS8 } from "jose";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";

export async function GET() {
  const env = getEnv();

  if (!env.mapKit.isConfigured) {
    return NextResponse.json(
      {
        ok: false,
        message: "MapKit credentials are not configured."
      },
      { status: 503 }
    );
  }

  const algorithm = "ES256";
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 60 * 30;
  const privateKey = await importPKCS8(env.mapKit.privateKey, algorithm);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: algorithm, kid: env.mapKit.keyId, typ: "JWT" })
    .setIssuer(env.mapKit.teamId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(privateKey);

  return NextResponse.json({
    ok: true,
    token,
    expiresAt,
    key: env.mapKit.publicKey
  });
}
