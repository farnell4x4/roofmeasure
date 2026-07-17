"use client";

import { AddressSuggestion, MapKitEnvDiagnostics, MapKitTokenResponse } from "@/types/mapkit";

type MapKitCoordinate = {
  latitude?: number;
  longitude?: number;
};

type MapKitCoordinateSpan = {
  latitudeDelta: number;
  longitudeDelta: number;
};

type MapKitCoordinateRegion = {
  center: MapKitCoordinate;
  span: MapKitCoordinateSpan;
};

type MapKitAutocompleteResult = {
  displayLines?: string[];
  title?: string;
  subtitle?: string;
  name?: string;
  formattedAddress?: string;
  coordinate?: MapKitCoordinate;
};

type MapKitPlace = {
  name?: string;
  formattedAddress?: string;
  title?: string;
  subtitle?: string;
  displayLines?: string[];
  coordinate?: MapKitCoordinate;
};

declare global {
  interface Window {
    mapkit?: {
      init: (options: { authorizationCallback: (done: (token: string) => void) => void; language: string }) => void;
      Coordinate: new (latitude: number, longitude: number) => MapKitCoordinate;
      CoordinateSpan: new (latitudeDelta: number, longitudeDelta: number) => MapKitCoordinateSpan;
      CoordinateRegion: new (center: MapKitCoordinate, span: MapKitCoordinateSpan) => MapKitCoordinateRegion;
      MapType: {
        Satellite: "satellite";
        Hybrid: "hybrid";
        MutedStandard: "mutedStandard";
        Standard: "standard";
      };
      Map: new (
        element: HTMLElement,
        options: {
          showsCompass?: "visible" | "hidden" | "adaptive";
          showsMapTypeControl?: boolean;
          isRotationEnabled?: boolean;
          isPitchEnabled?: boolean;
          mapType?: "satellite" | "hybrid" | "mutedStandard" | "standard";
          region?: MapKitCoordinateRegion;
        }
      ) => {
        region: MapKitCoordinateRegion;
        mapType: "satellite" | "hybrid" | "mutedStandard" | "standard";
        addEventListener: (type: string, listener: (event: Record<string, unknown>) => void) => void;
        removeEventListener: (type: string, listener: (event: Record<string, unknown>) => void) => void;
        convertPointOnPageToCoordinate: (point: DOMPoint) => MapKitCoordinate;
        convertCoordinateToPointOnPage: (coordinate: MapKitCoordinate) => DOMPoint;
        destroy: () => void;
      };
      FeatureVisibility: { Hidden: string };
      Search?: new (options?: { language?: string }) => {
        autocomplete: (
          query: string,
          options?: {
            includeAddresses?: boolean;
            includePointsOfInterest?: boolean;
            includePhysicalFeatures?: boolean;
            signal?: AbortSignal;
          }
        ) => Promise<{ results?: MapKitAutocompleteResult[] }>;
        search: (
          query: string | MapKitAutocompleteResult,
          options?: {
            includeAddresses?: boolean;
            includePointsOfInterest?: boolean;
            includePhysicalFeatures?: boolean;
            signal?: AbortSignal;
          }
        ) => Promise<{ places?: MapKitPlace[] }>;
      };
    };
  }
}

let bootPromise: Promise<void> | null = null;

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function getMissingMapKitCredentials() {
  const response = await fetch("/api/mapkit/diagnostics");
  if (!response.ok) return [];

  const payload = (await response.json()) as { ok?: boolean; diagnostics?: MapKitEnvDiagnostics };
  const diagnostics = payload.diagnostics;
  if (!diagnostics) return [];

  return Object.entries(diagnostics)
    .filter(([, value]) => !value.exists)
    .map(([key]) => key);
}

function formatMapKitTokenFailure(tokenResponse: Extract<MapKitTokenResponse, { ok: false }>) {
  const diagnostics = tokenResponse.diagnostics;
  const failedStep = diagnostics?.failedStep;
  const privateKeyChecks = diagnostics?.privateKeyFormatChecks;

  if (failedStep === "import-private-key") {
    const privateKeyProblems: string[] = [];
    if (privateKeyChecks?.beginsWithBeginPrivateKey === false) {
      privateKeyProblems.push("missing BEGIN PRIVATE KEY header");
    }
    if (privateKeyChecks?.endsWithEndPrivateKey === false) {
      privateKeyProblems.push("missing END PRIVATE KEY footer");
    }
    if (privateKeyChecks?.containsEscapedNewlines === false && privateKeyChecks?.containsLiteralNewlines === false) {
      privateKeyProblems.push("no newline separators detected");
    }

    if (privateKeyProblems.length > 0) {
      return `MapKit token generation failed while importing MAPKIT_PRIVATE_KEY: ${privateKeyProblems.join(", ")}.`;
    }
  }

  if (failedStep === "sign-jwt") {
    return `MapKit token generation failed while signing the JWT: ${diagnostics?.message ?? tokenResponse.message}`;
  }

  if (diagnostics?.message) {
    return `MapKit search is unavailable: ${diagnostics.message}`;
  }

  return `MapKit search is unavailable: ${tokenResponse.message}`;
}

export async function loadMapKit() {
  if (typeof window === "undefined") return;
  if (window.mapkit) return;
  if (!bootPromise) {
    bootPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js";
      script.async = true;
      script.onload = async () => {
        try {
          const response = await fetch("/api/mapkit/token");
          const tokenResponse = (await response.json()) as MapKitTokenResponse;
          if (!tokenResponse.ok || !window.mapkit) {
            bootPromise = null;
            reject(
              new Error(
                !tokenResponse.ok
                  ? formatMapKitTokenFailure(tokenResponse)
                  : "MapKit script loaded but window.mapkit was unavailable."
              )
            );
            return;
          }
          window.mapkit.init({
            language: "en",
            authorizationCallback: (done) => done(tokenResponse.token)
          });
          resolve();
        } catch (error) {
          bootPromise = null;
          reject(error);
        }
      };
      script.onerror = () => {
        bootPromise = null;
        reject(new Error("MapKit script failed to load from Apple CDN."));
      };
      document.head.appendChild(script);
    });
  }
  return bootPromise;
}

export async function getMapKitConfigurationErrorMessage() {
  const missingKeys = await getMissingMapKitCredentials();
  if (missingKeys.length > 0) {
    return `MapKit search is unavailable. Missing: ${missingKeys.join(", ")}.`;
  }

  try {
    const response = await fetch("/api/mapkit/token");
    const tokenResponse = (await response.json()) as MapKitTokenResponse;
    if (!tokenResponse.ok) {
      return formatMapKitTokenFailure(tokenResponse);
    }
  } catch {
    return "MapKit search is unavailable: unable to reach /api/mapkit/token.";
  }

  return "MapKit search is unavailable for an unknown MapKit initialization reason.";
}

export function getMapKitRuntimeErrorMessage(error: unknown) {
  return getErrorMessage(error, "MapKit search is unavailable.");
}

export function createMapKitRegion(centerLat: number, centerLng: number, latSpan: number, lngSpan: number) {
  if (!window.mapkit) return null;

  const center = new window.mapkit.Coordinate(centerLat, centerLng);
  const span = new window.mapkit.CoordinateSpan(latSpan, lngSpan);
  return new window.mapkit.CoordinateRegion(center, span);
}

function createSearch() {
  if (!window.mapkit?.Search) return null;
  return new window.mapkit.Search({ language: "en" });
}

function toAddressSuggestion(
  result: MapKitAutocompleteResult | MapKitPlace,
  id: string
): AddressSuggestion {
  const title = String(result.name ?? result.displayLines?.[0] ?? result.title ?? result.formattedAddress ?? "");
  const subtitle = String(result.formattedAddress ?? result.displayLines?.[1] ?? result.subtitle ?? "");

  return {
    id,
    title,
    subtitle,
    formattedAddress: "formattedAddress" in result ? result.formattedAddress : undefined,
    latitude: typeof result.coordinate?.latitude === "number" ? result.coordinate.latitude : undefined,
    longitude: typeof result.coordinate?.longitude === "number" ? result.coordinate.longitude : undefined,
    mapkitResult: "displayLines" in result ? result : undefined
  };
}

export async function searchAddressSuggestions(query: string, signal?: AbortSignal) {
  if (!query.trim()) return [];
  await loadMapKit();
  const search = createSearch();
  if (!search) return [];

  const response = await search.autocomplete(query, {
    includeAddresses: true,
    includePointsOfInterest: false,
    includePhysicalFeatures: false,
    signal
  });

  return (response.results ?? []).map((result, index) => toAddressSuggestion(result, `${query}-${index}`));
}

export async function searchBestAddressMatch(
  query: string | AddressSuggestion,
  signal?: AbortSignal
): Promise<AddressSuggestion | null> {
  const normalizedQuery = typeof query === "string" ? query.trim() : [query.title, query.subtitle].filter(Boolean).join(" ").trim();
  if (!normalizedQuery) return null;

  await loadMapKit();
  const search = createSearch();
  if (!search) return null;

  const response = await search.search(
    typeof query === "string" ? normalizedQuery : (query.mapkitResult as MapKitAutocompleteResult | undefined) ?? normalizedQuery,
    {
      includeAddresses: true,
      includePointsOfInterest: false,
      includePhysicalFeatures: false,
      signal
    }
  );

  const bestPlace = response.places?.[0];
  return bestPlace ? toAddressSuggestion(bestPlace, `place-${normalizedQuery}`) : null;
}
