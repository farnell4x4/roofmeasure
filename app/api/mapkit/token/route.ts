import { NextRequest, NextResponse } from "next/server";
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

function toBase64Url(input: ArrayBuffer | Uint8Array | string) {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);

  const base64 = Buffer.from(bytes).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function importMapKitPrivateKey(privateKeyPem: string) {
  const normalized = privateKeyPem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");

  const keyData = Buffer.from(normalized, "base64");

  return crypto.subtle.importKey(
    "pkcs8",
    keyData,
    {
      name: "ECDSA",
      namedCurve: "P-256"
    },
    false,
    ["sign"]
  );
}

async function signMapKitJwt({
  issuer,
  keyId,
  origin,
  privateKey,
  issuedAt,
  expiresAt
}: {
  issuer: string;
  keyId: string;
  origin: string;
  privateKey: string;
  issuedAt: number;
  expiresAt: number;
}) {
  const header = {
    alg: "ES256",
    kid: keyId,
    typ: "JWT"
  };

  const payload = {
    iss: issuer,
    iat: issuedAt,
    exp: expiresAt,
    aud: "https://appleid.apple.com",
    ...(origin ? { origin } : {})
  };

  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const cryptoKey = await importMapKitPrivateKey(privateKey);
  const signature = await crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: "SHA-256"
    },
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${toBase64Url(signature)}`;
}

export async function GET(request: NextRequest) {
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

    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + 60 * 30;
    const normalizedPrivateKey = env.mapKit.privateKey.replace(/\\n/g, "\n");
    const origin = request.nextUrl.origin;

    failedStep = "import-private-key";
    await importMapKitPrivateKey(normalizedPrivateKey);

    failedStep = "sign-jwt";
    const token = await signMapKitJwt({
      issuer: env.mapKit.teamId,
      keyId: env.mapKit.keyId,
      origin,
      privateKey: normalizedPrivateKey,
      issuedAt,
      expiresAt
    });

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
