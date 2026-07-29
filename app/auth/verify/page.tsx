"use client";

import { LoaderCircle } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { saveBillingEntitlementToken } from "@/lib/billing/entitlement-client";

function VerifyMagicLinkContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("Verifying your magic link…");

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setMessage("This magic link is missing its token.");
      return;
    }

    let cancelled = false;

    async function run() {
      try {
        const response = await fetch("/api/auth/magic-link/verify", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token }),
        });
        const payload = (await response.json()) as { entitlementToken?: string; error?: string };
        if (!response.ok || !payload.entitlementToken) {
          throw new Error(payload.error || "Could not verify magic link.");
        }
        await saveBillingEntitlementToken(payload.entitlementToken);
        if (!cancelled) {
          router.replace("/subscription?magicLink=success");
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : "Could not verify magic link.");
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  return (
    <main className="app-shell page-grid">
      <div style={{ display: "grid", gap: 12, justifyItems: "center", textAlign: "center" }}>
        <LoaderCircle size={28} />
        <h1 style={{ margin: 0 }}>Magic Link Sign-In</h1>
        <p style={{ margin: 0, color: "var(--muted)" }}>{message}</p>
      </div>
    </main>
  );
}

export default function VerifyMagicLinkRoute() {
  return (
    <Suspense
      fallback={
        <main className="app-shell page-grid">
          <div style={{ display: "grid", gap: 12, justifyItems: "center", textAlign: "center" }}>
            <LoaderCircle size={28} />
            <h1 style={{ margin: 0 }}>Magic Link Sign-In</h1>
            <p style={{ margin: 0, color: "var(--muted)" }}>Preparing secure sign-in…</p>
          </div>
        </main>
      }
    >
      <VerifyMagicLinkContent />
    </Suspense>
  );
}
