import { getCloudflareContext } from "@opennextjs/cloudflare";

const DEFAULT_APP_NAME = "RoofMeasure";

export const requiredMapKitEnvKeys = [
  "NEXT_PUBLIC_MAPKIT_JS_KEY",
  "MAPKIT_TEAM_ID",
  "MAPKIT_KEY_ID",
  "MAPKIT_PRIVATE_KEY"
] as const;

type RequiredMapKitEnvKey = (typeof requiredMapKitEnvKeys)[number];
type RuntimeEnvKey =
  | "NEXT_PUBLIC_APP_NAME"
  | "NEXT_PUBLIC_MAPKIT_JS_KEY"
  | "MAPKIT_TEAM_ID"
  | "MAPKIT_KEY_ID"
  | "MAPKIT_PRIVATE_KEY";
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
      readProcessEnvValue("MAPKIT_PRIVATE_KEY")
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
