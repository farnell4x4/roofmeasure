export type MapKitTokenResponse =
  | { ok: true; token: string; expiresAt: number; key: string }
  | {
      ok: false;
      message: string;
      diagnostics?: {
        failedStep?: "load-env" | "import-private-key" | "sign-jwt";
        message?: string;
        privateKeyFormatChecks?: {
          beginsWithBeginPrivateKey?: boolean;
          endsWithEndPrivateKey?: boolean;
          containsEscapedNewlines?: boolean;
          containsLiteralNewlines?: boolean;
        };
      };
    };

export type MapKitEnvDiagnostics = Record<
  "NEXT_PUBLIC_MAPKIT_JS_KEY" | "MAPKIT_TEAM_ID" | "MAPKIT_KEY_ID" | "MAPKIT_PRIVATE_KEY",
  { exists: boolean; length: number }
>;

export type AddressSuggestion = {
  id: string;
  title: string;
  subtitle?: string;
  formattedAddress?: string;
  latitude?: number;
  longitude?: number;
  mapkitResult?: unknown;
};
