"use client";

import { compactVerify, importSPKI } from "jose";
import { isEntitlementRefreshDue } from "@/lib/billing/access";
import { db } from "@/lib/persistence/db";
import type { BillingEntitlementPayload } from "@/types/billing";

type StoredBillingEntitlement = {
  id: "current";
  token: string;
  payload: BillingEntitlementPayload;
};

async function verifyEntitlementToken(token: string) {
  const publicKeyPem = process.env.NEXT_PUBLIC_BILLING_ENTITLEMENT_PUBLIC_KEY;
  if (!publicKeyPem) {
    throw new Error("Missing NEXT_PUBLIC_BILLING_ENTITLEMENT_PUBLIC_KEY.");
  }
  const verifier = await importSPKI(publicKeyPem.replace(/\\n/g, "\n"), "ES256");
  const { payload } = await compactVerify(token, verifier);
  const parsed = JSON.parse(new TextDecoder().decode(payload)) as BillingEntitlementPayload;
  if (Date.parse(parsed.expires_at) <= Date.now()) {
    throw new Error("Entitlement token expired.");
  }
  return parsed;
}

export async function saveBillingEntitlementToken(token: string) {
  const payload = await verifyEntitlementToken(token);
  await db.saveBillingEntitlement({
    id: "current",
    token,
    payload,
  });
  return payload;
}

export async function getStoredBillingEntitlement() {
  const record = await db.getBillingEntitlement();
  if (!record) return null;
  try {
    await verifyEntitlementToken(record.token);
    return record as StoredBillingEntitlement;
  } catch {
    await db.clearBillingEntitlement();
    return null;
  }
}

export async function clearStoredBillingEntitlement() {
  await db.clearBillingEntitlement();
}

export async function refreshBillingEntitlementIfNeeded() {
  const current = await getStoredBillingEntitlement();
  if (!current || !navigator.onLine || !isEntitlementRefreshDue(current.payload)) {
    return current;
  }

  const response = await fetch("/api/auth/entitlement/refresh", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${current.token}`,
    },
  });

  if (!response.ok) {
    return current;
  }

  const payload = (await response.json()) as { entitlementToken?: string };
  if (!payload.entitlementToken) {
    return current;
  }

  const nextPayload = await saveBillingEntitlementToken(payload.entitlementToken);
  return {
    id: "current" as const,
    token: payload.entitlementToken,
    payload: nextPayload,
  };
}
