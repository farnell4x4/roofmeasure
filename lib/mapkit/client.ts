"use client";

import { AddressSuggestion, MapKitTokenResponse } from "@/types/mapkit";

declare global {
  interface Window {
    mapkit?: {
      init: (options: { authorizationCallback: (done: (token: string) => void) => void; language: string }) => void;
      Map: new (element: HTMLElement, options: Record<string, unknown>) => unknown;
      FeatureVisibility: { Hidden: string };
      SearchAutocomplete?: new () => {
        search: (query: string, callback: (error: unknown, data: Array<Record<string, unknown>>) => void) => void;
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

export async function searchAddressSuggestions(query: string) {
  if (!query.trim()) return [];
  await loadMapKit();
  if (!window.mapkit?.SearchAutocomplete) return [];

  return new Promise<AddressSuggestion[]>((resolve) => {
    const autocomplete = new window.mapkit!.SearchAutocomplete!();
    autocomplete.search(query, (_error, results) => {
      const items = results.map((result, index) => ({
        id: `${query}-${index}`,
        title: String(result.title ?? query),
        subtitle: String(result.subtitle ?? "")
      }));
      resolve(items);
    });
  });
}
