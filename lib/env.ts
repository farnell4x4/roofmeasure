import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_APP_NAME: z.string().default("RoofMeasure"),
  NEXT_PUBLIC_MAPKIT_JS_KEY: z.string().optional().default(""),
  MAPKIT_TEAM_ID: z.string().optional().default(""),
  MAPKIT_KEY_ID: z.string().optional().default(""),
  MAPKIT_PRIVATE_KEY: z.string().optional().default("")
});

export function getEnv() {
  const parsed = envSchema.parse(process.env);
  return {
    appName: parsed.NEXT_PUBLIC_APP_NAME,
    mapKit: {
      publicKey: parsed.NEXT_PUBLIC_MAPKIT_JS_KEY,
      teamId: parsed.MAPKIT_TEAM_ID,
      keyId: parsed.MAPKIT_KEY_ID,
      privateKey: parsed.MAPKIT_PRIVATE_KEY.replace(/\\n/g, "\n"),
      isConfigured: Boolean(
        parsed.NEXT_PUBLIC_MAPKIT_JS_KEY &&
          parsed.MAPKIT_TEAM_ID &&
          parsed.MAPKIT_KEY_ID &&
          parsed.MAPKIT_PRIVATE_KEY
      )
    }
  };
}
