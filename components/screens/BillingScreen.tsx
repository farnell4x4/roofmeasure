"use client";

import { CreditCard, LoaderCircle, Mail, Settings2, ShieldCheck, ShieldX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  clearStoredBillingEntitlement,
  getStoredBillingEntitlement,
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

type BillingDebugEntry = {
  time: string;
  message: string;
};

async function postJson<T>(url: string, body?: unknown, token?: string, onResponse?: (status: number) => void) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  onResponse?.(response.status);
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
  const [debugEntries, setDebugEntries] = useState<BillingDebugEntry[]>([]);

  function addDebug(message: string) {
    setDebugEntries((current) => [
      ...current.slice(-39),
      { time: new Date().toISOString(), message },
    ]);
  }

  useEffect(() => {
    let cancelled = false;
    addDebug("Billing screen mounted.");

    async function loadEntitlement() {
      addDebug("Entitlement load started.");
      try {
        const current = await refreshBillingEntitlementIfNeeded();
        addDebug(
          current
            ? `Entitlement load found a token; active=${current.payload.subscription_active}.`
            : "Entitlement load found no stored token.",
        );
        if (cancelled) {
          addDebug("Entitlement load completed after unmount; ignoring result.");
          return;
        }
        setEntitlement(current?.payload ?? null);
        setEntitlementToken(current?.token ?? null);
      } catch (error) {
        addDebug(`Entitlement load failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        if (!cancelled) {
          setLoadingEntitlement(false);
          addDebug("Entitlement loading state set to complete.");
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

  async function getUsableEntitlementToken() {
    addDebug(`Button token check: state token=${entitlementToken ? "present" : "missing"}.`);
    if (entitlementToken) return entitlementToken;

    addDebug("Button token check: reading IndexedDB entitlement.");
    const current = await getStoredBillingEntitlement();
    if (!current) {
      addDebug("Button token check: IndexedDB returned no usable entitlement.");
      return null;
    }

    setEntitlement(current.payload);
    setEntitlementToken(current.token);
    addDebug(`Button token check: recovered token; active=${current.payload.subscription_active}.`);
    return current.token;
  }

  async function handleCheckout(planId: string) {
    addDebug(`Start Subscription clicked: plan=${planId}.`);
    try {
      setBillingError(null);
      setBusyAction(planId);
      const token = await getUsableEntitlementToken();
      if (!token) {
        addDebug("Start Subscription stopped: no entitlement token.");
        throw new Error("Sign in with a magic link first.");
      }

      addDebug("Start Subscription sending POST /api/stripe/checkout.");
      const payload = await postJson<{ url: string }>(
        "/api/stripe/checkout",
        { planId },
        token,
        (status) => addDebug(`Checkout API response status=${status}.`),
      );
      addDebug(`Checkout response received: url=${payload.url ? "present" : "missing"}.`);
      addDebug("Navigating to Stripe Checkout.");
      window.location.href = payload.url;
    } catch (error) {
      addDebug(`Start Subscription failed: ${error instanceof Error ? error.message : String(error)}`);
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
    addDebug("Manage Billing clicked.");
    try {
      setBillingError(null);
      setBusyAction("portal");
      const token = await getUsableEntitlementToken();
      if (!token) {
        addDebug("Manage Billing stopped: no entitlement token.");
        throw new Error("Sign in with a magic link first.");
      }

      addDebug("Manage Billing sending POST /api/stripe/customer-portal.");
      const payload = await postJson<{ url: string }>(
        "/api/stripe/customer-portal",
        undefined,
        token,
        (status) => addDebug(`Portal API response status=${status}.`),
      );
      addDebug(`Portal response received: url=${payload.url ? "present" : "missing"}.`);
      addDebug("Navigating to Stripe Billing Portal.");
      window.location.href = payload.url;
    } catch (error) {
      addDebug(`Manage Billing failed: ${error instanceof Error ? error.message : String(error)}`);
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
                <Button type="button" onClick={() => void handleCheckout(plan.id)} disabled={busyAction !== null}>
                  {busyAction === plan.id ? <LoaderCircle size={18} /> : <CreditCard size={18} />}
                  Start Subscription
                </Button>
                <Button type="button" variant="secondary" onClick={() => void handlePortal()} disabled={busyAction !== null}>
                  {busyAction === "portal" ? <LoaderCircle size={18} /> : <Settings2 size={18} />}
                  Manage Billing
                </Button>
              </div>
            </Card>
          ))
        )}
      </section>

      <Card style={{ display: "grid", gap: 10 }}>
        <strong>Billing diagnostics</strong>
        <span style={{ color: "var(--muted)", fontSize: 14 }}>
          Safe UI trace: token values are never displayed. Reproduce the issue, then copy this log.
        </span>
        <pre
          style={{
            margin: 0,
            padding: 12,
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            fontSize: 12,
            lineHeight: 1.5,
            background: "var(--surface-strong)",
            borderRadius: 12,
            userSelect: "text",
          }}
        >
          {debugEntries.length > 0
            ? debugEntries.map((entry) => `${entry.time} ${entry.message}`).join("\n")
            : "No billing events recorded yet."}
        </pre>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>
          Current state: loading={String(loadingEntitlement)}, stateToken={entitlementToken ? "present" : "missing"}, busyAction={busyAction ?? "none"}, plans={plans.length}
        </span>
      </Card>
    </main>
  );
}
