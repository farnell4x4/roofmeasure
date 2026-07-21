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
    delete process.env.NEXT_PUBLIC_MAPKIT_JS_KEY;
    delete process.env.MAPKIT_TEAM_ID;
    delete process.env.MAPKIT_KEY_ID;
    delete process.env.MAPKIT_PRIVATE_KEY;
  });

  it("prefers Cloudflare runtime bindings when available", async () => {
    getCloudflareContextMock.mockResolvedValue({
      env: {
        NEXT_PUBLIC_APP_NAME: "RoofMeasure CF",
        NEXT_PUBLIC_MAPKIT_JS_KEY: "public-from-cf",
        MAPKIT_TEAM_ID: "team-from-cf",
        MAPKIT_KEY_ID: "key-from-cf",
        MAPKIT_PRIVATE_KEY: "line1\\nline2"
      }
    });

    process.env.NEXT_PUBLIC_APP_NAME = "RoofMeasure Local";
    process.env.NEXT_PUBLIC_MAPKIT_JS_KEY = "public-from-process";
    process.env.MAPKIT_TEAM_ID = "team-from-process";
    process.env.MAPKIT_KEY_ID = "key-from-process";
    process.env.MAPKIT_PRIVATE_KEY = "process-private";

    const { getEnv } = await import("@/lib/config/env");
    const env = await getEnv();

    expect(env.appName).toBe("RoofMeasure CF");
    expect(env.mapKit.publicKey).toBe("public-from-cf");
    expect(env.mapKit.teamId).toBe("team-from-cf");
    expect(env.mapKit.keyId).toBe("key-from-cf");
    expect(env.mapKit.privateKey).toBe("line1\nline2");
    expect(env.mapKit.isConfigured).toBe(true);
  });

  it("falls back to process.env when Cloudflare context is unavailable", async () => {
    getCloudflareContextMock.mockRejectedValue(new Error("no cloudflare context"));

    process.env.NEXT_PUBLIC_APP_NAME = "RoofMeasure Local";
    process.env.NEXT_PUBLIC_MAPKIT_JS_KEY = "public-local";
    process.env.MAPKIT_TEAM_ID = "team-local";
    process.env.MAPKIT_KEY_ID = "key-local";
    process.env.MAPKIT_PRIVATE_KEY = "local-private";

    const { getRuntimeEnvSnapshot } = await import("@/lib/config/env");
    const env = await getRuntimeEnvSnapshot();

    expect(env).toEqual({
      NEXT_PUBLIC_APP_NAME: "RoofMeasure Local",
      NEXT_PUBLIC_MAPKIT_JS_KEY: "public-local",
      MAPKIT_TEAM_ID: "team-local",
      MAPKIT_KEY_ID: "key-local",
      MAPKIT_PRIVATE_KEY: "local-private"
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
