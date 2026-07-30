"use client";

import { CreditCard, FolderOpen, Home, LoaderCircle, Mail, MapPinned, Menu, Settings2, ShieldCheck, ShieldX, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  clearStoredBillingEntitlement,
  getStoredBillingEntitlement,
  refreshBillingEntitlement,
  refreshBillingEntitlementIfNeeded,
  saveBillingEntitlementToken,
} from "@/lib/billing/entitlement-client";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/ToastProvider";
import { canCreateLocalProject, LOCAL_PROJECT_LIMIT_MESSAGE } from "@/lib/billing/local-access";
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

async function postJson<T>(
  url: string,
  body?: unknown,
  token?: string,
  onResponse?: (status: number) => void,
  onWaiting?: (seconds: number) => void,
) {
  const controller = new AbortController();
  const waitingTimers = [2, 10].map((seconds) =>
    window.setTimeout(() => onWaiting?.(seconds), seconds * 1000),
  );
  const timeout = window.setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });

    onResponse?.(response.status);
    const payload = (await response.json()) as T & { error?: string };
    if (!response.ok) {
      throw new Error(payload.error || "Request failed.");
    }

    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`${url} did not respond within 15 seconds.`);
    }
    throw error;
  } finally {
    waitingTimers.forEach((timer) => window.clearTimeout(timer));
    window.clearTimeout(timeout);
  }
}

function formatDate(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleString();
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

export function BillingScreen({ plans, planLoadError }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const checkoutSucceeded = searchParams.get("checkout") === "success";
  const returnedFromPortal = searchParams.get("billing") === "returned";
  const { push } = useToast();
  const [email, setEmail] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [entitlement, setEntitlement] = useState<BillingEntitlementPayload | null>(null);
  const [entitlementToken, setEntitlementToken] = useState<string | null>(null);
  const [magicLinkPreviewUrl, setMagicLinkPreviewUrl] = useState<string | null>(null);
  const [loadingEntitlement, setLoadingEntitlement] = useState(true);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [debugEntries, setDebugEntries] = useState<BillingDebugEntry[]>([]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  function navigateFromSubscription(path: "/" | "/projects" | "/?new=1") {
    setMobileMenuOpen(false);
    router.push(path);
  }

  async function handleNewProject() {
    if (!(await canCreateLocalProject())) {
      setMobileMenuOpen(false);
      push({ title: LOCAL_PROJECT_LIMIT_MESSAGE, tone: "default" });
      return;
    }
    navigateFromSubscription("/?new=1");
  }

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
        const current = returnedFromPortal
          ? await refreshBillingEntitlement(true)
          : await refreshBillingEntitlementIfNeeded();
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
        setEmail(current?.payload.email ?? "");

        if (checkoutSucceeded && current && !current.payload.subscription_active) {
          addDebug("Checkout success detected; starting automatic entitlement refresh.");
          setBusyAction("checkout-refresh");
          try {
            for (let attempt = 1; attempt <= 10; attempt += 1) {
              await wait(2000);
              if (cancelled) return;

              addDebug(`Automatic entitlement refresh attempt ${attempt}/10.`);
              const refreshed = await refreshBillingEntitlement(true);
              if (!refreshed) {
                addDebug("Automatic entitlement refresh found no stored token.");
                continue;
              }

              setEntitlement(refreshed.payload);
              setEntitlementToken(refreshed.token);
              setEmail(refreshed.payload.email);
              addDebug(`Automatic entitlement refresh result: active=${refreshed.payload.subscription_active}.`);
              if (refreshed.payload.subscription_active) {
                push({ title: "Paid access refreshed automatically.", tone: "success" });
                break;
              }
            }
          } finally {
            if (!cancelled) setBusyAction(null);
          }
        }
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
  }, [checkoutSucceeded, push, returnedFromPortal]);

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
        setEmail(refreshed.email);
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
    setEmail(current.payload.email ?? "");
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
        (seconds) => addDebug(`Checkout fetch still waiting after ${seconds} seconds.`),
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
        (seconds) => addDebug(`Portal fetch still waiting after ${seconds} seconds.`),
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
    setEmail("");
    setEntitlement(null);
    setEntitlementToken(null);
    push({ title: "Signed out on this device.", tone: "success" });
  }

  const statusLabel = entitlement?.subscription_active ? "active" : "inactive";

  return (
    <main className="app-shell page-grid">
      <nav className="subscription-navigation" aria-label="Subscription navigation">
        <div className="subscription-navigation__desktop">
          <Button variant="ghost" onClick={() => navigateFromSubscription("/")}>
            <Home size={18} /> Home
          </Button>
          <Button variant="ghost" onClick={() => navigateFromSubscription("/projects")}>
            <FolderOpen size={18} /> Saved Projects
          </Button>
          <Button variant="ghost" onClick={() => void handleNewProject()}>
            <MapPinned size={18} /> New Project
          </Button>
        </div>
        <div className="subscription-navigation__mobile">
          <Button
            variant="ghost"
            aria-expanded={mobileMenuOpen}
            aria-controls="subscription-mobile-menu"
            onClick={() => setMobileMenuOpen((current) => !current)}
          >
            {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />} Menu
          </Button>
          {mobileMenuOpen ? (
            <div id="subscription-mobile-menu" className="subscription-navigation__menu">
              <Button variant="ghost" onClick={() => navigateFromSubscription("/")}>
                <Home size={18} /> Home
              </Button>
              <Button variant="ghost" onClick={() => navigateFromSubscription("/projects")}>
                <FolderOpen size={18} /> Saved Projects
              </Button>
              <Button variant="ghost" onClick={() => void handleNewProject()}>
                <MapPinned size={18} /> New Project
              </Button>
            </div>
          ) : null}
        </div>
      </nav>
      <div>
        <h1>Manage Subscription</h1>
        <p style={{ color: "var(--muted)", margin: 0 }}>
          {entitlement?.subscription_active
            ? "Manage your active subscription through Stripe, including cancellation and payment details."
            : "Subscribe to unlock paid access. Your subscription is managed securely through Stripe."}
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
        {entitlement?.email ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <span style={{ color: "var(--muted)" }}>Signed in as <strong style={{ color: "var(--ink)" }}>{entitlement.email}</strong></span>
            <Button variant="ghost" onClick={() => void handleSignOut()} disabled={busyAction !== null}>
              <ShieldX size={18} /> Sign Out
            </Button>
          </div>
        ) : null}
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
          {!entitlement?.email ? (
            <Button variant="ghost" onClick={() => void handleSignOut()} disabled={busyAction !== null || !entitlementToken}>
              <ShieldX size={18} /> Sign Out
            </Button>
          ) : null}
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
            {entitlement.subscription_cancel_at ? (
              <strong style={{ color: "var(--danger)" }}>
                Canceled. Active until {formatDate(entitlement.subscription_cancel_at)}.
              </strong>
            ) : null}
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
                {entitlement?.subscription_active ? (
                  <span style={{ color: "var(--muted)", alignSelf: "center", fontSize: 14 }}>
                    You have an active subscription.
                  </span>
                ) : (
                  <Button type="button" onClick={() => void handleCheckout(plan.id)} disabled={busyAction !== null}>
                    {busyAction === plan.id ? <LoaderCircle size={18} /> : <CreditCard size={18} />}
                    Subscribe
                  </Button>
                )}
                {entitlement?.subscription_active ? (
                  <Button type="button" variant="secondary" onClick={() => void handlePortal()} disabled={busyAction !== null}>
                    {busyAction === "portal" ? <LoaderCircle size={18} /> : <Settings2 size={18} />}
                    Cancel Subscription
                  </Button>
                ) : null}
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
