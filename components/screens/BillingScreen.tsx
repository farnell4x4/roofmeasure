"use client";

import { CreditCard, LoaderCircle, Mail, Settings2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  clearStoredBillingEntitlement,
  getStoredBillingEntitlement,
  refreshBillingEntitlement,
  refreshBillingEntitlementIfNeeded,
} from "@/lib/billing/entitlement-client";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/ToastProvider";
import { AppNavigation } from "@/components/app/AppNavigation";
import type { BillingEntitlementPayload } from "@/types/billing";
import type { StripeBillingPlan } from "@/lib/stripe/server";

type Props = {
  plans: StripeBillingPlan[];
  planLoadError: string | null;
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

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

export function BillingScreen({ plans, planLoadError }: Props) {
  const searchParams = useSearchParams();
  const checkoutSucceeded = searchParams.get("checkout") === "success";
  const returnedFromPortal = searchParams.get("billing") === "returned";
  const reachedProjectLimit = searchParams.get("paywall") === "project-limit";
  const { push } = useToast();
  const [email, setEmail] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [entitlement, setEntitlement] = useState<BillingEntitlementPayload | null>(null);
  const [entitlementToken, setEntitlementToken] = useState<string | null>(null);
  const [loadingEntitlement, setLoadingEntitlement] = useState(true);
  const [billingError, setBillingError] = useState<string | null>(null);
  function addDebug(message: string) {
    if (process.env.NODE_ENV !== "production") {
      console.debug(`[BillingScreen] ${message}`);
    }
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

  if (loadingEntitlement) {
    return (
      <main className="safe-viewport-page" style={{ display: "grid", placeItems: "center", padding: 24 }}>
        <p style={{ margin: 0, color: "var(--muted)" }}>Loading…</p>
      </main>
    );
  }

  if (!entitlement?.email) {
    return (
      <main className="safe-viewport-page" style={{ display: "grid", placeItems: "center", padding: 24 }}>
        <section style={{ width: "min(420px, 100%)", display: "grid", gap: 20 }}>
          <div style={{ display: "grid", gap: 8 }}>
            <h1 style={{ margin: 0 }}>{reachedProjectLimit ? "Sign in to continue" : "Sign in"}</h1>
            <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
              {reachedProjectLimit
                ? "You’ve used your free project. Sign in to continue."
                : "Enter your email and we’ll send you a secure sign-in link."}
            </p>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (email.trim()) void handleSendMagicLink();
            }}
            style={{ display: "grid", gap: 12 }}
          >
            <Input
              id="billing-email"
              type="email"
              autoComplete="email"
              autoFocus
              label="Email address"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <Button type="submit" disabled={busyAction !== null || !email.trim()}>
              {busyAction === "magic-link" ? <LoaderCircle size={18} /> : <Mail size={18} />}
              Send sign-in link
            </Button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell page-grid">
      <AppNavigation />
      <Card style={{ display: "grid", gap: 20, maxWidth: 520 }}>
        <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 16 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <h1 style={{ margin: 0, fontSize: "clamp(1.5rem, 4vw, 2rem)" }}>Subscription</h1>
            <span style={{ color: "var(--muted)", overflowWrap: "anywhere" }}>{entitlement.email}</span>
          </div>
          <Button variant="ghost" onClick={() => void handleSignOut()} disabled={busyAction !== null}>
            Sign out
          </Button>
        </div>

        {checkoutMessage ? (
          <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>{checkoutMessage}</p>
        ) : null}

        {billingError ? (
          <p role="alert" style={{ margin: 0, color: "var(--danger)", lineHeight: 1.5 }}>{billingError}</p>
        ) : null}

        {entitlement.subscription_active ? (
          <div style={{ display: "grid", gap: 12 }}>
            <p style={{ margin: 0 }}>Your subscription is active.</p>
            <Button type="button" variant="secondary" onClick={() => void handlePortal()} disabled={busyAction !== null}>
              {busyAction === "portal" ? <LoaderCircle size={18} /> : <Settings2 size={18} />}
              Manage or cancel subscription
            </Button>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <p style={{ margin: 0, color: "var(--muted)" }}>Choose a plan to continue.</p>
            {planLoadError ? <p role="alert" style={{ margin: 0, color: "var(--danger)" }}>{planLoadError}</p> : null}
            {plans.length === 0 ? (
              <p style={{ margin: 0, color: "var(--muted)" }}>Subscriptions are temporarily unavailable.</p>
            ) : (
              plans.map((plan) => (
                <Button key={plan.id} type="button" onClick={() => void handleCheckout(plan.id)} disabled={busyAction !== null}>
                  {busyAction === plan.id ? <LoaderCircle size={18} /> : <CreditCard size={18} />}
                  Subscribe to {plan.name}
                </Button>
              ))
            )}
          </div>
        )}
      </Card>

    </main>
  );
}
