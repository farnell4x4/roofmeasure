const DEFAULT_APP_NAME = "RoofMeasure";

export const requiredMapKitEnvKeys = [
  "NEXT_PUBLIC_MAPKIT_JS_KEY",
  "MAPKIT_TEAM_ID",
  "MAPKIT_KEY_ID",
  "MAPKIT_PRIVATE_KEY"
] as const;

type RequiredMapKitEnvKey = (typeof requiredMapKitEnvKeys)[number];

function readEnvValue(key: string) {
  const value = process.env[key];
  return typeof value === "string" ? value : "";
}

export function getRuntimeEnvSnapshot() {
  return {
    NEXT_PUBLIC_APP_NAME: readEnvValue("NEXT_PUBLIC_APP_NAME") || DEFAULT_APP_NAME,
    NEXT_PUBLIC_MAPKIT_JS_KEY: readEnvValue("NEXT_PUBLIC_MAPKIT_JS_KEY"),
    MAPKIT_TEAM_ID: readEnvValue("MAPKIT_TEAM_ID"),
    MAPKIT_KEY_ID: readEnvValue("MAPKIT_KEY_ID"),
    MAPKIT_PRIVATE_KEY: readEnvValue("MAPKIT_PRIVATE_KEY")
  };
}

export function getMapKitEnvDiagnostics() {
  const env = getRuntimeEnvSnapshot();
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

export function getEnv() {
  const env = getRuntimeEnvSnapshot();
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
