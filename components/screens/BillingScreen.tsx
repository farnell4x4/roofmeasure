"use client";

import { CreditCard, LoaderCircle, Mail, Settings2, ShieldCheck, ShieldX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  clearStoredBillingEntitlement,
  refreshBillingEntitlementIfNeeded,
  saveBillingEntitlementToken,
} from "@/lib/billing/entitlement-client";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/ToastProvider";
import type { BillingEntitlementPayload } from "@/types/billing";
import type { StripeBillingPlan } from "@/lib/stripe/server";

type Props = {
  plans: StripeBillingPlan[];
  planLoadError: string | null;
};

type RefreshPayload = {
  entitlementToken: string;
};

async function postJson<T>(url: string, body?: unknown, token?: string) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

function formatDate(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleString();
}

export function BillingScreen({ plans, planLoadError }: Props) {
  const searchParams = useSearchParams();
  const { push } = useToast();
  const [email, setEmail] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [entitlement, setEntitlement] = useState<BillingEntitlementPayload | null>(null);
  const [entitlementToken, setEntitlementToken] = useState<string | null>(null);
  const [magicLinkPreviewUrl, setMagicLinkPreviewUrl] = useState<string | null>(null);
  const [loadingEntitlement, setLoadingEntitlement] = useState(true);
  const [billingError, setBillingError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadEntitlement() {
      try {
        const current = await refreshBillingEntitlementIfNeeded();
        if (cancelled) return;
        setEntitlement(current?.payload ?? null);
        setEntitlementToken(current?.token ?? null);
      } finally {
        if (!cancelled) {
          setLoadingEntitlement(false);
        }
      }
    }

    void loadEntitlement();
    return () => {
      cancelled = true;
    };
  }, []);

  const checkoutMessage = useMemo(() => {
    if (searchParams.get("paywall") === "project-limit") {
      return "Your free project is ready. Subscribe to create additional projects.";
    }
    const magicLink = searchParams.get("magicLink");
    if (magicLink === "success") {
      return "Email sign-in is complete. This device now has a signed 30-day entitlement stored locally.";
    }
    const checkout = searchParams.get("checkout");
    if (checkout === "success") {
      return "Stripe checkout returned successfully. Paid access updates from the signed entitlement after the webhook sync completes.";
    }
    if (checkout === "cancelled") {
      return "Checkout was cancelled. Existing paid access stays based on your last signed entitlement until the next refresh.";
    }
    return "";
  }, [searchParams]);

  async function handleSendMagicLink() {
    try {
      setBusyAction("magic-link");
      const payload = await postJson<{ sent: boolean; previewUrl?: string }>(
        "/api/auth/magic-link/request",
        { email },
      );
      setMagicLinkPreviewUrl(payload.previewUrl ?? null);
      push({
        title: payload.previewUrl
          ? "Magic link created. Use the preview link below."
          : "Check your email for the sign-in link.",
        tone: "success",
      });
    } catch (error) {
      push({
        title: error instanceof Error ? error.message : "Could not send magic link.",
        tone: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRefreshEntitlement() {
    if (!entitlementToken) return;
    try {
      setBusyAction("refresh");
      const payload = await postJson<RefreshPayload>(
        "/api/auth/entitlement/refresh",
        undefined,
        entitlementToken,
      );
      if (payload.entitlementToken) {
        const refreshed = await saveBillingEntitlementToken(payload.entitlementToken);
        setEntitlement(refreshed);
        setEntitlementToken(payload.entitlementToken);
      }
    } catch (error) {
      push({
        title: error instanceof Error ? error.message : "Could not refresh entitlement.",
        tone: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCheckout(planId: string) {
    if (!entitlementToken) {
      setBillingError("Sign in with a magic link first.");
      push({ title: "Sign in with a magic link first.", tone: "default" });
      return;
    }
    try {
      setBillingError(null);
      setBusyAction(planId);
      const payload = await postJson<{ url: string }>(
        "/api/stripe/checkout",
        { planId },
        entitlementToken,
      );
      window.location.href = payload.url;
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : "Could not start checkout.");
      push({
        title: error instanceof Error ? error.message : "Could not start checkout.",
        tone: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handlePortal() {
    if (!entitlementToken) {
      setBillingError("Sign in with a magic link first.");
      push({ title: "Sign in with a magic link first.", tone: "default" });
      return;
    }
    try {
      setBillingError(null);
      setBusyAction("portal");
      const payload = await postJson<{ url: string }>(
        "/api/stripe/customer-portal",
        undefined,
        entitlementToken,
      );
      window.location.href = payload.url;
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : "Could not open billing portal.");
      push({
        title: error instanceof Error ? error.message : "Could not open billing portal.",
        tone: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSignOut() {
    await clearStoredBillingEntitlement();
    setEntitlement(null);
    setEntitlementToken(null);
    push({ title: "Local entitlement cleared on this device.", tone: "success" });
  }

  const statusLabel = entitlement?.subscription_active ? "active" : "inactive";

  return (
    <main className="app-shell page-grid">
      <div>
        <p className="chip">Stripe Billing</p>
        <h1>Subscriptions</h1>
        <p style={{ color: "var(--muted)", margin: 0 }}>
          Sign in by email, keep the signed 30-day entitlement in IndexedDB, and let Stripe webhooks update the tiny D1 billing record.
        </p>
      </div>

      {checkoutMessage ? (
        <Card style={{ borderColor: "rgba(65, 105, 225, 0.24)", background: "rgba(65, 105, 225, 0.08)" }}>
          {checkoutMessage}
        </Card>
      ) : null}

      {billingError ? (
        <Card style={{ borderColor: "rgba(166, 45, 39, 0.3)", background: "rgba(166, 45, 39, 0.08)", color: "#8c211d" }}>
          {billingError}
        </Card>
      ) : null}

      <Card style={{ display: "grid", gap: 16 }}>
        <Input
          id="billing-email"
          type="email"
          autoComplete="email"
          label="Billing email"
          placeholder="you@rooftapemeasure.com"
          hint="Magic-link sign-in creates or reuses the tiny D1 billing identity for this email."
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Button onClick={() => void handleSendMagicLink()} disabled={busyAction !== null || !email.trim()}>
            {busyAction === "magic-link" ? <LoaderCircle size={18} /> : <Mail size={18} />}
            Send Magic Link
          </Button>
          <Button variant="secondary" onClick={() => void handleRefreshEntitlement()} disabled={busyAction !== null || !entitlementToken}>
            {busyAction === "refresh" ? <LoaderCircle size={18} /> : <ShieldCheck size={18} />}
            Refresh Entitlement
          </Button>
          <Button variant="ghost" onClick={() => void handleSignOut()} disabled={busyAction !== null || !entitlementToken}>
            <ShieldX size={18} /> Clear Local Access
          </Button>
        </div>
        {magicLinkPreviewUrl ? (
          <Card style={{ padding: 14, borderRadius: 16, background: "rgba(65, 105, 225, 0.06)" }}>
            <div style={{ display: "grid", gap: 8 }}>
              <strong>Dev magic-link preview</strong>
              <a href={magicLinkPreviewUrl} style={{ color: "var(--accent)", overflowWrap: "anywhere" }}>
                {magicLinkPreviewUrl}
              </a>
            </div>
          </Card>
        ) : null}
      </Card>

      <Card style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "space-between", alignItems: "center" }}>
          <strong>Local paid-access state</strong>
          <span className="chip">
            {entitlement?.subscription_active ? <ShieldCheck size={16} /> : <ShieldX size={16} />}
            {loadingEntitlement ? "loading" : statusLabel}
          </span>
        </div>
        {entitlement ? (
          <div style={{ display: "grid", gap: 6, color: "var(--muted)", fontSize: 14 }}>
            <span>User ID: {entitlement.user_id}</span>
            <span>Plan: {entitlement.plan ?? "none"}</span>
            <span>Issued: {formatDate(entitlement.issued_at)}</span>
            <span>Expires: {formatDate(entitlement.expires_at)}</span>
          </div>
        ) : (
          <span style={{ color: "var(--muted)" }}>
            No signed entitlement is stored locally yet.
          </span>
        )}
      </Card>

      {planLoadError ? (
        <Card style={{ display: "grid", gap: 8 }}>
          <strong>Billing plans could not be loaded.</strong>
          <span style={{ color: "var(--muted)" }}>{planLoadError}</span>
        </Card>
      ) : null}

      <section className="projects-screen__list">
        {plans.length === 0 ? (
          <Card style={{ display: "grid", gap: 8 }}>
            <strong>No billing plans are configured yet.</strong>
            <span style={{ color: "var(--muted)" }}>
              Add `STRIPE_BILLING_PLANS_JSON` in your Cloudflare variables or local env, then reload.
            </span>
          </Card>
        ) : (
          plans.map((plan) => (
            <Card key={plan.id} style={{ display: "grid", gap: 14 }}>
              <div style={{ display: "grid", gap: 6 }}>
                <h2 style={{ margin: 0 }}>{plan.name}</h2>
                <p style={{ margin: 0, color: "var(--muted)" }}>{plan.description}</p>
                <span className="chip">Billed per {plan.interval}</span>
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <Button onClick={() => void handleCheckout(plan.id)} disabled={busyAction !== null || loadingEntitlement}>
                  {busyAction === plan.id ? <LoaderCircle size={18} /> : <CreditCard size={18} />}
                  Start Subscription
                </Button>
                <Button variant="secondary" onClick={() => void handlePortal()} disabled={busyAction !== null || loadingEntitlement}>
                  {busyAction === "portal" ? <LoaderCircle size={18} /> : <Settings2 size={18} />}
                  Manage Billing
                </Button>
              </div>
            </Card>
          ))
        )}
      </section>
    </main>
  );
}
