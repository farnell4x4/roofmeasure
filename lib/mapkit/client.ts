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
  fullThoroughfare?: string;
  thoroughfare?: string;
  subThoroughfare?: string;
  locality?: string;
  postCode?: string;
  coordinate?: MapKitCoordinate;
};

type MapKitPlace = {
  name?: string;
  formattedAddress?: string;
  title?: string;
  subtitle?: string;
  displayLines?: string[];
  fullThoroughfare?: string;
  thoroughfare?: string;
  subThoroughfare?: string;
  locality?: string;
  postCode?: string;
  coordinate?: MapKitCoordinate;
};

type MapKitGeocoderResult = {
  name?: string;
  formattedAddress?: string;
  fullThoroughfare?: string;
  thoroughfare?: string;
  subThoroughfare?: string;
  locality?: string;
  postCode?: string;
  coordinate: {
    latitude: number;
    longitude: number;
  };
};

type MapKitSearchOptions = {
  includeAddresses?: boolean;
  includePointsOfInterest?: boolean;
  includePhysicalFeatures?: boolean;
  includeQueries?: boolean;
  signal?: AbortSignal;
  region?: MapKitCoordinateRegion;
  limitToCountries?: string | string[];
  regionPriority?: "default" | "required";
};

type MapKitSearchConstructorOptions = {
  language?: string;
  includeAddresses?: boolean;
  includePointsOfInterest?: boolean;
  includePhysicalFeatures?: boolean;
  includeQueries?: boolean;
  limitToCountries?: string | string[];
  getsUserLocation?: boolean;
  region?: MapKitCoordinateRegion;
  regionPriority?: "default" | "required";
};

type SearchBias = {
  centerLat: number;
  centerLng: number;
  latSpan: number;
  lngSpan: number;
  countryCode?: string;
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
      Search?: new (options?: MapKitSearchConstructorOptions) => {
        autocomplete: {
          (
            query: string,
            callback: (
              error: Error | null,
              data: { results?: MapKitAutocompleteResult[] } | null
            ) => void,
            options?: MapKitSearchOptions
          ): Promise<{ results?: MapKitAutocompleteResult[] }>;
          (
            query: string,
            options?: MapKitSearchOptions
          ): Promise<{ results?: MapKitAutocompleteResult[] }>;
        };
        search: {
          (
            query: string | MapKitAutocompleteResult,
            callback: (
              error: Error | null,
              data: { places?: MapKitPlace[] } | null
            ) => void,
            options?: MapKitSearchOptions
          ): Promise<{ places?: MapKitPlace[] }>;
          (
            query: string | MapKitAutocompleteResult,
            options?: MapKitSearchOptions
          ): Promise<{ places?: MapKitPlace[] }>;
        };
      };
      Geocoder?: new (options?: { language?: string }) => {
        lookup: {
          (
            query: string,
            callback: (
              error: Error | null,
              data: { results?: MapKitGeocoderResult[] } | null
            ) => void,
            options?: {
              coordinate?: MapKitCoordinate;
              region?: MapKitCoordinateRegion;
              language?: string;
            }
          ): Promise<{ results?: MapKitGeocoderResult[] }>;
          (
            query: string,
            options?: {
              coordinate?: MapKitCoordinate;
              region?: MapKitCoordinateRegion;
              language?: string;
            }
          ): Promise<{ results?: MapKitGeocoderResult[] }>;
        };
      };
    };
  }
}

let bootPromise: Promise<void> | null = null;
const MAPKIT_SCRIPT_SRC = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js";
const MAPKIT_SCRIPT_SELECTOR = 'script[data-mapkit-script="true"]';

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function waitForMapKitGlobal() {
  if (window.mapkit) return window.mapkit;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    if (window.mapkit) return window.mapkit;
  }

  throw new Error("MapKit script loaded but window.mapkit was unavailable.");
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
      async function boot() {
        try {
          await new Promise<void>((resolveScript, rejectScript) => {
            if (window.mapkit) {
              resolveScript();
              return;
            }

            const existing = document.querySelector<HTMLScriptElement>(MAPKIT_SCRIPT_SELECTOR);
            if (existing) {
              existing.addEventListener("load", () => resolveScript(), { once: true });
              existing.addEventListener(
                "error",
                () => rejectScript(new Error("Existing MapKit script failed to load.")),
                { once: true }
              );
              return;
            }

            const script = document.createElement("script");
            script.src = MAPKIT_SCRIPT_SRC;
            script.async = true;
            script.dataset.mapkitScript = "true";
            script.onload = () => resolveScript();
            script.onerror = () => rejectScript(new Error("MapKit script failed to load from Apple CDN."));
            document.head.appendChild(script);
          });

          await waitForMapKitGlobal();

          const response = await fetch("/api/mapkit/token", { cache: "no-store" });
          const tokenResponse = (await response.json()) as MapKitTokenResponse;
          if (!response.ok || !tokenResponse.ok || !tokenResponse.token || !window.mapkit) {
            throw new Error(
              !tokenResponse.ok
                ? formatMapKitTokenFailure(tokenResponse)
                : !window.mapkit
                  ? "MapKit script loaded but window.mapkit was unavailable."
                  : `MapKit token request failed with status ${response.status}.`
            );
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
      }

      void boot();
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

function createSearch(bias?: SearchBias) {
  if (!window.mapkit?.Search) return null;
  return new window.mapkit.Search({
    language: "en",
    includeAddresses: true,
    includePointsOfInterest: false,
    includeQueries: false,
    limitToCountries: "US",
    region: createBiasRegion(bias) ?? undefined,
    regionPriority: "default"
  });
}

function createGeocoder() {
  if (!window.mapkit?.Geocoder) return null;
  return new window.mapkit.Geocoder({ language: "en" });
}

function createBiasRegion(bias?: SearchBias) {
  if (!bias || !window.mapkit) return undefined;

  return createMapKitRegion(bias.centerLat, bias.centerLng, bias.latSpan, bias.lngSpan) ?? undefined;
}

function createSearchOptions(signal?: AbortSignal, bias?: SearchBias): MapKitSearchOptions {
  return {
    includeAddresses: true,
    includePointsOfInterest: false,
    includePhysicalFeatures: false,
    includeQueries: false,
    signal,
    region: createBiasRegion(bias),
    limitToCountries: bias?.countryCode ?? "US"
  };
}

function createAbortError() {
  return new DOMException("The operation was aborted.", "AbortError");
}

function bindAbortSignal<T>(
  signal: AbortSignal | undefined,
  executor: (resolve: (value: T) => void, reject: (reason?: unknown) => void) => void
) {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const onAbort = () => reject(createAbortError());
    signal?.addEventListener("abort", onAbort, { once: true });

    executor(
      (value) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (reason) => {
        signal?.removeEventListener("abort", onAbort);
        reject(reason);
      }
    );
  });
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

export async function searchAddressSuggestions(query: string, signal?: AbortSignal, bias?: SearchBias) {
  if (!query.trim()) return [];
  await loadMapKit();
  const search = createSearch(bias);
  if (!search) return [];

  const autocompletePromise = bindAbortSignal<{ results?: MapKitAutocompleteResult[] }>(signal, (resolve, reject) => {
    void search.autocomplete(
      query,
      (error, data) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(data ?? {});
      },
      createSearchOptions(undefined, bias)
    );
  });
  const autocompleteResponse = await autocompletePromise;

  return (autocompleteResponse.results ?? [])
    .map((result, index) => toAddressSuggestion(result, `${query}-${index}`))
    .slice(0, 8);
}

export async function searchBestAddressMatch(
  query: string | AddressSuggestion,
  signal?: AbortSignal,
  bias?: SearchBias
): Promise<AddressSuggestion | null> {
  const normalizedQuery = typeof query === "string" ? query.trim() : [query.title, query.subtitle].filter(Boolean).join(" ").trim();
  if (!normalizedQuery) return null;

  await loadMapKit();
  const search = createSearch(bias);
  if (!search) return null;

  const response = await bindAbortSignal<{ places?: MapKitPlace[] }>(signal, (resolve, reject) => {
    void search.search(
      typeof query === "string" ? normalizedQuery : (query.mapkitResult as MapKitAutocompleteResult | undefined) ?? normalizedQuery,
      (error, data) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(data ?? {});
      },
      createSearchOptions(undefined, bias)
    );
  });

  const bestPlace = response.places?.[0];
  return bestPlace ? toAddressSuggestion(bestPlace, `place-${normalizedQuery}`) : null;
}

export async function lookupStreetAddress(address: string): Promise<AddressSuggestion[]> {
  return lookupStreetAddressWithBias(address);
}

export async function lookupStreetAddressWithBias(address: string, bias?: SearchBias): Promise<AddressSuggestion[]> {
  const trimmedAddress = address.trim();
  if (!trimmedAddress) {
    throw new Error("Address is required.");
  }

  await loadMapKit();
  const geocoder = createGeocoder();
  if (!geocoder) {
    throw new Error("MapKit Geocoder is unavailable.");
  }

  const response = await new Promise<{ results?: MapKitGeocoderResult[] }>((resolve, reject) => {
    const options = bias
      ? {
          coordinate: { latitude: bias.centerLat, longitude: bias.centerLng },
          region: createBiasRegion(bias) ?? undefined,
          language: "en"
        }
      : undefined;
    void geocoder.lookup(
      trimmedAddress,
      (error, data) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(data ?? {});
      },
      options
    );
  });
  const places = response.results ?? [];

  return places.map((place, index) => ({
    id: `geocoder-${trimmedAddress}-${index}`,
    title: place.name ?? place.formattedAddress ?? trimmedAddress,
    subtitle: place.formattedAddress ?? "",
    formattedAddress: place.formattedAddress ?? "",
    latitude: place.coordinate.latitude,
    longitude: place.coordinate.longitude,
    mapkitResult: place
  }));
}
