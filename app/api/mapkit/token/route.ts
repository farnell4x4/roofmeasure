import { SignJWT, importPKCS8 } from "jose";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

type TokenGenerationStep =
  | "load-env"
  | "import-private-key"
  | "sign-jwt";

function getPrivateKeyFormatChecks(privateKey: string) {
  const trimmed = privateKey.trim();
  return {
    hasValue: privateKey.length > 0,
    normalizedLength: privateKey.length,
    lineCount: privateKey.length > 0 ? privateKey.split("\n").length : 0,
    beginsWithBeginPrivateKey: trimmed.startsWith("-----BEGIN PRIVATE KEY-----"),
    endsWithEndPrivateKey: trimmed.endsWith("-----END PRIVATE KEY-----"),
    containsEscapedNewlines: privateKey.includes("\\n"),
    containsLiteralNewlines: privateKey.includes("\n")
  };
}

function getSafeErrorDiagnostics(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null
    };
  }

  return {
    name: "UnknownError",
    message: typeof error === "string" ? error : "Unknown token generation error",
    stack: null
  };
}

export async function GET() {
  let failedStep: TokenGenerationStep = "load-env";

  try {
    const env = await getEnv();

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

    failedStep = "import-private-key";
    const privateKey = await importPKCS8(env.mapKit.privateKey, algorithm);

    failedStep = "sign-jwt";
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
  } catch (error) {
    const env = await getEnv().catch(() => null);
    const privateKey = env?.mapKit.privateKey ?? "";
    const diagnostics = {
      ...getSafeErrorDiagnostics(error),
      failedStep,
      privateKeyFormatChecks: getPrivateKeyFormatChecks(privateKey)
    };

    console.error("MapKit token generation failed", {
      failedStep,
      diagnostics,
      error
    });

    return NextResponse.json(
      {
        ok: false,
        message: "MapKit token generation failed.",
        diagnostics
      },
      { status: 500 }
    );
  }
}
