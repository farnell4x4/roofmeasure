import { getCloudflareContext } from "@opennextjs/cloudflare";

const DEFAULT_APP_NAME = "Roof Tape Measure";

export const requiredMapKitEnvKeys = [
  "NEXT_PUBLIC_MAPKIT_JS_KEY",
  "MAPKIT_TEAM_ID",
  "MAPKIT_KEY_ID",
  "MAPKIT_PRIVATE_KEY"
] as const;

type RequiredMapKitEnvKey = (typeof requiredMapKitEnvKeys)[number];
type RuntimeEnvKey =
  | "NEXT_PUBLIC_APP_NAME"
  | "NEXT_PUBLIC_APP_URL"
  | "NEXT_PUBLIC_BILLING_ENTITLEMENT_PUBLIC_KEY"
  | "NEXT_PUBLIC_MAPKIT_JS_KEY"
  | "MAPKIT_TEAM_ID"
  | "MAPKIT_KEY_ID"
  | "MAPKIT_PRIVATE_KEY"
  | "BILLING_ENTITLEMENT_PRIVATE_KEY"
  | "MAGIC_LINK_FROM_EMAIL"
  | "MAGIC_LINK_FROM_NAME"
  | "RESEND_API_KEY"
  | "STRIPE_SECRET_KEY"
  | "STRIPE_WEBHOOK_SECRET"
  | "STRIPE_PORTAL_CONFIGURATION_ID"
  | "STRIPE_BILLING_PLANS_JSON"
  | "STRIPE_PRICE_ID_MONTHLY";
type RuntimeEnvSnapshot = Record<RuntimeEnvKey, string>;

function readProcessEnvValue(key: string) {
  const value = process.env[key];
  return typeof value === "string" ? value : "";
}

function readCloudflareEnvValue(
  env: Record<string, unknown> | undefined,
  key: RuntimeEnvKey
) {
  const value = env?.[key];
  return typeof value === "string" ? value : "";
}

async function getCloudflareRuntimeEnv() {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return env as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function buildRuntimeEnvSnapshot(
  cloudflareEnv: Record<string, unknown> | undefined
): RuntimeEnvSnapshot {
  return {
    NEXT_PUBLIC_APP_NAME:
      readCloudflareEnvValue(cloudflareEnv, "NEXT_PUBLIC_APP_NAME") ||
      readProcessEnvValue("NEXT_PUBLIC_APP_NAME") ||
      DEFAULT_APP_NAME,
    NEXT_PUBLIC_APP_URL:
      readCloudflareEnvValue(cloudflareEnv, "NEXT_PUBLIC_APP_URL") ||
      readProcessEnvValue("NEXT_PUBLIC_APP_URL"),
    NEXT_PUBLIC_BILLING_ENTITLEMENT_PUBLIC_KEY:
      readCloudflareEnvValue(cloudflareEnv, "NEXT_PUBLIC_BILLING_ENTITLEMENT_PUBLIC_KEY") ||
      readProcessEnvValue("NEXT_PUBLIC_BILLING_ENTITLEMENT_PUBLIC_KEY"),
    NEXT_PUBLIC_MAPKIT_JS_KEY:
      readCloudflareEnvValue(cloudflareEnv, "NEXT_PUBLIC_MAPKIT_JS_KEY") ||
      readProcessEnvValue("NEXT_PUBLIC_MAPKIT_JS_KEY"),
    MAPKIT_TEAM_ID:
      readCloudflareEnvValue(cloudflareEnv, "MAPKIT_TEAM_ID") ||
      readProcessEnvValue("MAPKIT_TEAM_ID"),
    MAPKIT_KEY_ID:
      readCloudflareEnvValue(cloudflareEnv, "MAPKIT_KEY_ID") ||
      readProcessEnvValue("MAPKIT_KEY_ID"),
    MAPKIT_PRIVATE_KEY:
      readCloudflareEnvValue(cloudflareEnv, "MAPKIT_PRIVATE_KEY") ||
      readProcessEnvValue("MAPKIT_PRIVATE_KEY"),
    BILLING_ENTITLEMENT_PRIVATE_KEY:
      readCloudflareEnvValue(cloudflareEnv, "BILLING_ENTITLEMENT_PRIVATE_KEY") ||
      readProcessEnvValue("BILLING_ENTITLEMENT_PRIVATE_KEY"),
    MAGIC_LINK_FROM_EMAIL:
      readCloudflareEnvValue(cloudflareEnv, "MAGIC_LINK_FROM_EMAIL") ||
      readProcessEnvValue("MAGIC_LINK_FROM_EMAIL"),
    MAGIC_LINK_FROM_NAME:
      readCloudflareEnvValue(cloudflareEnv, "MAGIC_LINK_FROM_NAME") ||
      readProcessEnvValue("MAGIC_LINK_FROM_NAME"),
    RESEND_API_KEY:
      readCloudflareEnvValue(cloudflareEnv, "RESEND_API_KEY") ||
      readProcessEnvValue("RESEND_API_KEY"),
    STRIPE_SECRET_KEY:
      readCloudflareEnvValue(cloudflareEnv, "STRIPE_SECRET_KEY") ||
      readProcessEnvValue("STRIPE_SECRET_KEY"),
    STRIPE_WEBHOOK_SECRET:
      readCloudflareEnvValue(cloudflareEnv, "STRIPE_WEBHOOK_SECRET") ||
      readProcessEnvValue("STRIPE_WEBHOOK_SECRET"),
    STRIPE_PORTAL_CONFIGURATION_ID:
      readCloudflareEnvValue(cloudflareEnv, "STRIPE_PORTAL_CONFIGURATION_ID") ||
      readProcessEnvValue("STRIPE_PORTAL_CONFIGURATION_ID"),
    STRIPE_BILLING_PLANS_JSON:
      readCloudflareEnvValue(cloudflareEnv, "STRIPE_BILLING_PLANS_JSON") ||
      readProcessEnvValue("STRIPE_BILLING_PLANS_JSON"),
    STRIPE_PRICE_ID_MONTHLY:
      readCloudflareEnvValue(cloudflareEnv, "STRIPE_PRICE_ID_MONTHLY") ||
      readProcessEnvValue("STRIPE_PRICE_ID_MONTHLY")
  };
}

export async function getRuntimeEnvSnapshot() {
  return buildRuntimeEnvSnapshot(await getCloudflareRuntimeEnv());
}

export async function getMapKitEnvDiagnostics() {
  const env = await getRuntimeEnvSnapshot();
  return requiredMapKitEnvKeys.reduce<Record<RequiredMapKitEnvKey, { exists: boolean; length: number }>>(
    (accumulator, key) => {
      const value = env[key];
      accumulator[key] = {
        exists: value.length > 0,
        length: value.length
      };
      return accumulator;
    },
    {} as Record<RequiredMapKitEnvKey, { exists: boolean; length: number }>
  );
}

export async function getEnv() {
  const env = await getRuntimeEnvSnapshot();
  return {
    appName: env.NEXT_PUBLIC_APP_NAME,
    mapKit: {
      publicKey: env.NEXT_PUBLIC_MAPKIT_JS_KEY,
      teamId: env.MAPKIT_TEAM_ID,
      keyId: env.MAPKIT_KEY_ID,
      privateKey: env.MAPKIT_PRIVATE_KEY.replace(/\\n/g, "\n"),
      isConfigured: Boolean(
        env.NEXT_PUBLIC_MAPKIT_JS_KEY &&
          env.MAPKIT_TEAM_ID &&
          env.MAPKIT_KEY_ID &&
          env.MAPKIT_PRIVATE_KEY
      )
    }
  };
}
