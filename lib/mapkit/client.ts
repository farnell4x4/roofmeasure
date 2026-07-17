"use client";

import { AddressSuggestion, MapKitTokenResponse } from "@/types/mapkit";

type MapKitCoordinate = {
  latitude?: number;
  longitude?: number;
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
      Map: new (element: HTMLElement, options: Record<string, unknown>) => unknown;
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

export async function loadMapKit() {
  if (typeof window === "undefined") return;
  if (window.mapkit) return;
  if (!bootPromise) {
    bootPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.core.js";
      script.async = true;
      script.onload = async () => {
        try {
          const response = await fetch("/api/mapkit/token");
          const tokenResponse = (await response.json()) as MapKitTokenResponse;
          if (!tokenResponse.ok || !window.mapkit) {
            reject(new Error("MapKit credentials missing"));
            return;
          }
          window.mapkit.init({
            language: "en",
            authorizationCallback: (done) => done(tokenResponse.token)
          });
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      script.onerror = () => reject(new Error("MapKit script failed to load"));
      document.head.appendChild(script);
    });
  }
  return bootPromise;
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
