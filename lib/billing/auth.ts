import { createBillingRepository } from "@/lib/billing/repository";
import { getRuntimeEnvSnapshot } from "@/lib/config/env";
import type { BillingEntitlementPayload } from "@/types/billing";

const MAGIC_LINK_TTL_MINUTES = 15;
const ENTITLEMENT_TTL_DAYS = 30;

function toBase64Url(bytes: Uint8Array | ArrayBuffer) {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Buffer.from(array)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toBase64Url(digest);
}

function addMinutes(date: Date, minutes: number) {
  const next = new Date(date);
  next.setUTCMinutes(next.getUTCMinutes() + minutes);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

async function getEntitlementPrivateKey() {
  const env = await getRuntimeEnvSnapshot();
  if (!env.BILLING_ENTITLEMENT_PRIVATE_KEY) {
    throw new Error("Missing BILLING_ENTITLEMENT_PRIVATE_KEY.");
  }
  return crypto.subtle.importKey(
    "pkcs8",
    pemToDer(env.BILLING_ENTITLEMENT_PRIVATE_KEY),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

function pemToDer(pem: string) {
  const base64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

export function generateMagicLinkToken() {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function createMagicLinkRecord(userId: string) {
  const repository = await createBillingRepository();
  await repository.deleteExpiredMagicLinks();
  const token = generateMagicLinkToken();
  const expiresAt = addMinutes(new Date(), MAGIC_LINK_TTL_MINUTES).toISOString();
  await repository.createMagicLink(userId, await sha256(token), expiresAt);
  return { token, expiresAt };
}

export async function consumeMagicLinkToken(token: string) {
  const repository = await createBillingRepository();
  const record = await repository.getActiveMagicLinkByTokenHash(await sha256(token));
  if (!record) {
    throw new Error("This magic link is invalid or already used.");
  }
  if (Date.parse(record.expiresAt) <= Date.now()) {
    throw new Error("This magic link has expired.");
  }
  await repository.consumeMagicLink(record.id);
  const user = await repository.getUserById(record.userId);
  if (!user) {
    throw new Error("The billing user for this magic link was not found.");
  }
  return user;
}

export async function createBillingEntitlementToken(payload: Omit<BillingEntitlementPayload, "issued_at" | "expires_at">) {
  const issuedAt = new Date();
  const expiresAt = addDays(issuedAt, ENTITLEMENT_TTL_DAYS);
  const fullPayload: BillingEntitlementPayload = {
    ...payload,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  };
  const signer = await getEntitlementPrivateKey();
  const encodedHeader = toBase64Url(
    new TextEncoder().encode(JSON.stringify({ alg: "ES256", typ: "JWT" })),
  );
  const encodedPayload = toBase64Url(
    new TextEncoder().encode(JSON.stringify(fullPayload)),
  );
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    signer,
    new TextEncoder().encode(signingInput),
  );
  const token = `${signingInput}.${toBase64Url(signature)}`;
  return { token, payload: fullPayload };
}

export async function verifyBillingEntitlementToken(token: string) {
  const env = await getRuntimeEnvSnapshot();
  if (!env.NEXT_PUBLIC_BILLING_ENTITLEMENT_PUBLIC_KEY) {
    throw new Error("Missing NEXT_PUBLIC_BILLING_ENTITLEMENT_PUBLIC_KEY.");
  }
  const verifier = await crypto.subtle.importKey(
    "spki",
    pemToDer(env.NEXT_PUBLIC_BILLING_ENTITLEMENT_PUBLIC_KEY),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid entitlement token.");
  }
  const isValid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    verifier,
    fromBase64Url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!isValid) {
    throw new Error("Invalid entitlement token.");
  }
  const parsed = JSON.parse(
    new TextDecoder().decode(fromBase64Url(parts[1])),
  ) as BillingEntitlementPayload;
  if (Date.parse(parsed.expires_at) <= Date.now()) {
    throw new Error("Entitlement token expired.");
  }
  return parsed;
}

export async function requireBillingUserFromAuthorizationHeader(authorizationHeader: string | null) {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    throw new Error("Missing billing entitlement.");
  }

  const payload = await verifyBillingEntitlementToken(
    authorizationHeader.slice("Bearer ".length),
  );
  const repository = await createBillingRepository();
  const user = await repository.getUserById(payload.user_id);
  if (!user) {
    throw new Error("Billing user not found.");
  }
  return { user, payload };
}
