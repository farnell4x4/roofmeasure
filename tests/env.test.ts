import { beforeEach, describe, expect, it, vi } from "vitest";

const getCloudflareContextMock = vi.fn();

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: getCloudflareContextMock
}));

describe("runtime env helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    delete process.env.NEXT_PUBLIC_APP_NAME;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXT_PUBLIC_BILLING_ENTITLEMENT_PUBLIC_KEY;
    delete process.env.NEXT_PUBLIC_MAPKIT_JS_KEY;
    delete process.env.MAPKIT_TEAM_ID;
    delete process.env.MAPKIT_KEY_ID;
    delete process.env.MAPKIT_PRIVATE_KEY;
    delete process.env.BILLING_ENTITLEMENT_PRIVATE_KEY;
    delete process.env.MAGIC_LINK_FROM_EMAIL;
    delete process.env.MAGIC_LINK_FROM_NAME;
    delete process.env.RESEND_API_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_PORTAL_CONFIGURATION_ID;
    delete process.env.STRIPE_BILLING_PLANS_JSON;
  });

  it("prefers Cloudflare runtime bindings when available", async () => {
    getCloudflareContextMock.mockResolvedValue({
      env: {
        NEXT_PUBLIC_APP_NAME: "Roof Tape Measure CF",
        NEXT_PUBLIC_APP_URL: "https://cf.example.com",
        NEXT_PUBLIC_BILLING_ENTITLEMENT_PUBLIC_KEY: "public-entitlement-cf",
        NEXT_PUBLIC_MAPKIT_JS_KEY: "public-from-cf",
        MAPKIT_TEAM_ID: "team-from-cf",
        MAPKIT_KEY_ID: "key-from-cf",
        MAPKIT_PRIVATE_KEY: "line1\\nline2",
        BILLING_ENTITLEMENT_PRIVATE_KEY: "private-entitlement-cf",
        MAGIC_LINK_FROM_EMAIL: "magic@example.com",
        MAGIC_LINK_FROM_NAME: "Roof Tape Measure",
        RESEND_API_KEY: "re_test_cf",
        STRIPE_SECRET_KEY: "rk_test_cf",
        STRIPE_WEBHOOK_SECRET: "whsec_cf",
        STRIPE_PORTAL_CONFIGURATION_ID: "bpc_cf",
        STRIPE_BILLING_PLANS_JSON: '[{"id":"starter","name":"Starter","description":"desc","priceId":"price_1","interval":"month"}]'
      }
    });

    process.env.NEXT_PUBLIC_APP_NAME = "Roof Tape Measure Local";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    process.env.NEXT_PUBLIC_BILLING_ENTITLEMENT_PUBLIC_KEY = "public-entitlement-local";
    process.env.NEXT_PUBLIC_MAPKIT_JS_KEY = "public-from-process";
    process.env.MAPKIT_TEAM_ID = "team-from-process";
    process.env.MAPKIT_KEY_ID = "key-from-process";
    process.env.MAPKIT_PRIVATE_KEY = "process-private";
    process.env.BILLING_ENTITLEMENT_PRIVATE_KEY = "private-entitlement-process";
    process.env.MAGIC_LINK_FROM_EMAIL = "magic@local.test";
    process.env.MAGIC_LINK_FROM_NAME = "Roof Tape Measure Local";
    process.env.RESEND_API_KEY = "re_test_process";
    process.env.STRIPE_SECRET_KEY = "rk_test_process";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_process";
    process.env.STRIPE_PORTAL_CONFIGURATION_ID = "bpc_process";
    process.env.STRIPE_BILLING_PLANS_JSON = "[]";

    const { getEnv } = await import("@/lib/config/env");
    const env = await getEnv();

    expect(env.appName).toBe("Roof Tape Measure CF");
    expect(env.mapKit.publicKey).toBe("public-from-cf");
    expect(env.mapKit.teamId).toBe("team-from-cf");
    expect(env.mapKit.keyId).toBe("key-from-cf");
    expect(env.mapKit.privateKey).toBe("line1\nline2");
    expect(env.mapKit.isConfigured).toBe(true);
  });

  it("falls back to process.env when Cloudflare context is unavailable", async () => {
    getCloudflareContextMock.mockRejectedValue(new Error("no cloudflare context"));

    process.env.NEXT_PUBLIC_APP_NAME = "Roof Tape Measure Local";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    process.env.NEXT_PUBLIC_BILLING_ENTITLEMENT_PUBLIC_KEY = "public-entitlement-local";
    process.env.NEXT_PUBLIC_MAPKIT_JS_KEY = "public-local";
    process.env.MAPKIT_TEAM_ID = "team-local";
    process.env.MAPKIT_KEY_ID = "key-local";
    process.env.MAPKIT_PRIVATE_KEY = "local-private";
    process.env.BILLING_ENTITLEMENT_PRIVATE_KEY = "private-entitlement-local";
    process.env.MAGIC_LINK_FROM_EMAIL = "magic@local.test";
    process.env.MAGIC_LINK_FROM_NAME = "Roof Tape Measure Local";
    process.env.RESEND_API_KEY = "re_test_local";
    process.env.STRIPE_SECRET_KEY = "rk_test_local";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_local";
    process.env.STRIPE_PORTAL_CONFIGURATION_ID = "bpc_local";
    process.env.STRIPE_BILLING_PLANS_JSON = "[]";

    const { getRuntimeEnvSnapshot } = await import("@/lib/config/env");
    const env = await getRuntimeEnvSnapshot();

    expect(env).toEqual({
      NEXT_PUBLIC_APP_NAME: "Roof Tape Measure Local",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_BILLING_ENTITLEMENT_PUBLIC_KEY: "public-entitlement-local",
      NEXT_PUBLIC_MAPKIT_JS_KEY: "public-local",
      MAPKIT_TEAM_ID: "team-local",
      MAPKIT_KEY_ID: "key-local",
      MAPKIT_PRIVATE_KEY: "local-private",
      BILLING_ENTITLEMENT_PRIVATE_KEY: "private-entitlement-local",
      MAGIC_LINK_FROM_EMAIL: "magic@local.test",
      MAGIC_LINK_FROM_NAME: "Roof Tape Measure Local",
      RESEND_API_KEY: "re_test_local",
      STRIPE_SECRET_KEY: "rk_test_local",
      STRIPE_WEBHOOK_SECRET: "whsec_local",
      STRIPE_PORTAL_CONFIGURATION_ID: "bpc_local",
      STRIPE_BILLING_PLANS_JSON: "[]"
    });
  });

  it("returns diagnostics with existence and length only", async () => {
    getCloudflareContextMock.mockResolvedValue({
      env: {
        NEXT_PUBLIC_MAPKIT_JS_KEY: "public123",
        MAPKIT_TEAM_ID: "",
        MAPKIT_KEY_ID: "kid",
        MAPKIT_PRIVATE_KEY: "secret-value"
      }
    });

    const { getMapKitEnvDiagnostics } = await import("@/lib/config/env");
    const diagnostics = await getMapKitEnvDiagnostics();

    expect(diagnostics).toEqual({
      NEXT_PUBLIC_MAPKIT_JS_KEY: { exists: true, length: 9 },
      MAPKIT_TEAM_ID: { exists: false, length: 0 },
      MAPKIT_KEY_ID: { exists: true, length: 3 },
      MAPKIT_PRIVATE_KEY: { exists: true, length: 12 }
    });
  });
});
