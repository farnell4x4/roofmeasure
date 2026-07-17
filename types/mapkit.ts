export type MapKitTokenResponse =
  | { ok: true; token: string; expiresAt: number; key: string }
  | { ok: false; message: string };

export type AddressSuggestion = {
  id: string;
  title: string;
  subtitle?: string;
  formattedAddress?: string;
  latitude?: number;
  longitude?: number;
  mapkitResult?: unknown;
};
