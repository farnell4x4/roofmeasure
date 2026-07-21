"use client";

import { MapPin, Search } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  loadMapKit,
  lookupStreetAddressWithBias,
  searchAddressSuggestions,
  searchBestAddressMatch
} from "@/lib/mapkit/client";
import { AddressSuggestion } from "@/types/mapkit";

export default function MapKitTestPage() {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<InstanceType<NonNullable<NonNullable<Window["mapkit"]>["Map"]>> | null>(null);
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState<"idle" | "loading" | "error">("idle");
  const [searchMessage, setSearchMessage] = useState("");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [autocompleteState, setAutocompleteState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [autocompleteMessage, setAutocompleteMessage] = useState("");
  const [locationBias, setLocationBias] = useState<{
    centerLat: number;
    centerLng: number;
    latSpan: number;
    lngSpan: number;
    countryCode?: string;
  } | null>(null);
  const [locationState, setLocationState] = useState<"idle" | "requesting" | "granted" | "denied" | "unsupported">("idle");
  const [locationAlert, setLocationAlert] = useState("");

  async function requestLocationBias() {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setLocationState("unsupported");
      setLocationAlert("Location access is unavailable in this browser. Search will still work, but results may be less local.");
      return;
    }

    setLocationState("requesting");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocationBias({
          centerLat: position.coords.latitude,
          centerLng: position.coords.longitude,
          latSpan: 0.2,
          lngSpan: 0.2,
          countryCode: "US"
        });
        setLocationState("granted");
        setLocationAlert("");
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setLocationState("denied");
          setLocationAlert(
            "Location access is denied for this site. Enable Location Services for Safari and allow this website to improve nearby address suggestions."
          );
          return;
        }

        setLocationState("idle");
        setLocationAlert("We could not get your location right now. Search will continue without local bias.");
      },
      {
        enableHighAccuracy: false,
        maximumAge: 300000,
        timeout: 10000
      }
    );
  }

  useEffect(() => {
    let cancelled = false;
    const mapkitWindow = window as Window & { mapkit?: NonNullable<Window["mapkit"]> };

    async function run() {
      try {
        await loadMapKit();

        if (cancelled || !mapkitWindow.mapkit) {
          throw new Error("window.mapkit was not defined after script load.");
        }

        if (cancelled || !mapRef.current) return;

        const center = new mapkitWindow.mapkit.Coordinate(39.5501, -105.7821);
        const span = new mapkitWindow.mapkit.CoordinateSpan(0.04, 0.04);
        const region = new mapkitWindow.mapkit.CoordinateRegion(center, span);

        mapInstanceRef.current = new mapkitWindow.mapkit.Map(mapRef.current, {
          region,
          showsCompass: "visible",
          showsMapTypeControl: true,
          mapType: mapkitWindow.mapkit.MapType?.Standard
        });
      } catch (error) {
        console.error("MapKit test page failed to initialize.", error);
        setSearchState("error");
        setSearchMessage(error instanceof Error ? error.message : "Map initialization failed.");
      }
    }

    void run();

    return () => {
      cancelled = true;
      mapInstanceRef.current?.destroy?.();
      mapInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    async function requestLocation() {
      if (typeof navigator === "undefined") return;

      if ("permissions" in navigator && typeof navigator.permissions.query === "function") {
        try {
          const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
          if (status.state === "granted") {
            void requestLocationBias();
            return;
          }

          if (status.state === "prompt") {
            void requestLocationBias();
            return;
          }

          if (status.state === "denied") {
            setLocationState("denied");
            setLocationAlert(
              "Location access is denied for this site. Enable Location Services for Safari and allow this website to improve nearby address suggestions."
            );
            return;
          }
        } catch {
          void requestLocationBias();
          return;
        }
      }

      void requestLocationBias();
    }

    void requestLocation();
  }, []);

  useEffect(() => {
    const normalizedQuery = query.trim();

    if (normalizedQuery.length < 3) {
      setSuggestions([]);
      setAutocompleteState("idle");
      setAutocompleteMessage("");
      return;
    }

    const controller = new AbortController();
    setAutocompleteState("loading");
    setAutocompleteMessage("");

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const map = mapInstanceRef.current;
          const activeBias =
            locationBias ??
            (map
              ? {
                  centerLat: map.region.center.latitude ?? 39.5501,
                  centerLng: map.region.center.longitude ?? -105.7821,
                  latSpan: map.region.span.latitudeDelta ?? 0.2,
                  lngSpan: map.region.span.longitudeDelta ?? 0.2,
                  countryCode: "US"
                }
              : undefined);
          const results = await searchAddressSuggestions(normalizedQuery, controller.signal, activeBias);
          setSuggestions(results);
          setAutocompleteState("success");
          setAutocompleteMessage(results.length === 0 ? "No matching addresses found." : "");
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
          console.error("Autocomplete failed:", error);
          setSuggestions([]);
          setAutocompleteState("error");
          setAutocompleteMessage(error instanceof Error ? error.message : "Autocomplete failed.");
        }
      })();
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [locationBias, query]);

  function recenterMap(latitude: number, longitude: number) {
    const mapkitWindow = window as Window & { mapkit?: NonNullable<Window["mapkit"]> };
    const map = mapInstanceRef.current;
    if (!mapkitWindow.mapkit || !map) {
      throw new Error("Map is not ready yet.");
    }

    const span = map.region?.span;
    const region = new mapkitWindow.mapkit.CoordinateRegion(
      new mapkitWindow.mapkit.Coordinate(latitude, longitude),
      new mapkitWindow.mapkit.CoordinateSpan(span?.latitudeDelta ?? 0.01, span?.longitudeDelta ?? 0.01)
    );

    map.region = region;
  }

  async function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setSearchState("error");
      setSearchMessage("Address is required.");
      return;
    }

    setSearchState("loading");
    setSearchMessage("");

    try {
      const map = mapInstanceRef.current;
      const activeBias =
        locationBias ??
        (map
          ? {
              centerLat: map.region.center.latitude ?? 39.5501,
              centerLng: map.region.center.longitude ?? -105.7821,
              latSpan: map.region.span.latitudeDelta ?? 0.2,
              lngSpan: map.region.span.longitudeDelta ?? 0.2,
              countryCode: "US"
            }
          : undefined);
      const [bestMatch] = await lookupStreetAddressWithBias(normalizedQuery, activeBias);
      if (!bestMatch || typeof bestMatch.latitude !== "number" || typeof bestMatch.longitude !== "number") {
        setSearchState("error");
        setSearchMessage("No address found.");
        return;
      }

      recenterMap(bestMatch.latitude, bestMatch.longitude);
      setSuggestions([]);
      setAutocompleteState("idle");
      setAutocompleteMessage("");
      setSearchState("idle");
      setSearchMessage(bestMatch.formattedAddress || "Address found.");
    } catch (error) {
      console.error("Address lookup failed:", error);
      setSearchState("error");
      setSearchMessage(error instanceof Error ? error.message : "Address lookup failed.");
    }
  }

  async function handleSuggestionSelect(suggestion: AddressSuggestion) {
    setQuery(suggestion.formattedAddress || [suggestion.title, suggestion.subtitle].filter(Boolean).join(", "));
    setSearchState("loading");
    setSearchMessage("");

    try {
      if (typeof suggestion.latitude === "number" && typeof suggestion.longitude === "number" && !suggestion.mapkitResult) {
        recenterMap(suggestion.latitude, suggestion.longitude);
        setSuggestions([]);
        setAutocompleteState("idle");
        setAutocompleteMessage("");
        setSearchState("idle");
        setSearchMessage(suggestion.formattedAddress || "Address found.");
        return;
      }

      const map = mapInstanceRef.current;
      const activeBias =
        locationBias ??
        (map
          ? {
              centerLat: map.region.center.latitude ?? 39.5501,
              centerLng: map.region.center.longitude ?? -105.7821,
              latSpan: map.region.span.latitudeDelta ?? 0.2,
              lngSpan: map.region.span.longitudeDelta ?? 0.2,
              countryCode: "US"
            }
          : undefined);
      const bestMatch = await searchBestAddressMatch(suggestion, undefined, activeBias);
      if (!bestMatch || typeof bestMatch.latitude !== "number" || typeof bestMatch.longitude !== "number") {
        setSearchState("error");
        setSearchMessage("No address found.");
        return;
      }

      recenterMap(bestMatch.latitude, bestMatch.longitude);
      setSuggestions([]);
      setAutocompleteState("idle");
      setAutocompleteMessage("");
      setSearchState("idle");
      setSearchMessage(bestMatch.formattedAddress || "Address found.");
    } catch (error) {
      console.error("Suggestion lookup failed:", error);
      setSearchState("error");
      setSearchMessage(error instanceof Error ? error.message : "Address lookup failed.");
    }
  }

  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        background: "#d9ddd8"
      }}
    >
      <form
        onSubmit={handleSearchSubmit}
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          zIndex: 2,
          width: "min(420px, calc(100vw - 32px))",
          display: "grid",
          gap: 8
        }}
      >
        {locationAlert ? (
          <div
            role="alert"
            style={{
              display: "grid",
              gap: 8,
              padding: "12px 14px",
              borderRadius: 16,
              background: "rgba(255, 248, 235, 0.96)",
              border: "1px solid rgba(201, 111, 48, 0.25)",
              color: "#5f3b16",
              boxShadow: "0 10px 24px rgba(20, 24, 22, 0.12)"
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600 }}>
              <MapPin size={16} />
              Location access
            </div>
            <div style={{ fontSize: 14 }}>{locationAlert}</div>
            <button
              type="button"
              onClick={() => void requestLocationBias()}
              style={{
                justifySelf: "start",
                borderRadius: 12,
                border: "1px solid rgba(95, 59, 22, 0.18)",
                background: "rgba(255,255,255,0.9)",
                padding: "8px 10px",
                color: "#5f3b16",
                cursor: "pointer"
              }}
            >
              Try location again
            </button>
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 14px",
            borderRadius: 18,
            background: "rgba(255, 255, 255, 0.92)",
            border: "1px solid rgba(31, 37, 34, 0.12)",
            boxShadow: "0 14px 30px rgba(20, 24, 22, 0.16)"
          }}
        >
          <Search size={18} color="#5f685f" />
          <input
            aria-label="Search address"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search street address"
            style={{
              flex: 1,
              border: 0,
              outline: "none",
              background: "transparent",
              color: "#1f2522",
              fontSize: 16
            }}
          />
        </div>
        {suggestions.length > 0 ? (
          <div
            style={{
              display: "grid",
              gap: 6,
              padding: 8,
              borderRadius: 18,
              background: "rgba(255, 255, 255, 0.96)",
              border: "1px solid rgba(31, 37, 34, 0.12)",
              boxShadow: "0 14px 30px rgba(20, 24, 22, 0.16)"
            }}
          >
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                onClick={() => void handleSuggestionSelect(suggestion)}
                style={{
                  textAlign: "left",
                  border: 0,
                  background: "transparent",
                  borderRadius: 12,
                  padding: "10px 12px",
                  color: "#1f2522",
                  cursor: "pointer"
                }}
              >
                {(suggestion.mapkitResult as { displayLines?: string[] } | undefined)?.displayLines?.join(", ") ||
                  [suggestion.title, suggestion.subtitle].filter(Boolean).join(", ")}
              </button>
            ))}
          </div>
        ) : null}
        {autocompleteState !== "idle" && suggestions.length === 0 ? (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 14,
              background: "rgba(255, 255, 255, 0.92)",
              border: "1px solid rgba(31, 37, 34, 0.12)",
              color: autocompleteState === "error" ? "#b43f2d" : "#1f2522",
              fontSize: 14,
              boxShadow: "0 10px 24px rgba(20, 24, 22, 0.12)"
            }}
          >
            {autocompleteState === "loading" ? "Searching suggestions..." : autocompleteMessage}
          </div>
        ) : null}
        {locationState === "requesting" ? (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 14,
              background: "rgba(255, 255, 255, 0.92)",
              border: "1px solid rgba(31, 37, 34, 0.12)",
              color: "#1f2522",
              fontSize: 14,
              boxShadow: "0 10px 24px rgba(20, 24, 22, 0.12)"
            }}
          >
            Requesting your location for better nearby address results...
          </div>
        ) : null}
        {searchMessage ? (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 14,
              background: "rgba(255, 255, 255, 0.92)",
              border: "1px solid rgba(31, 37, 34, 0.12)",
              color: searchState === "error" ? "#b43f2d" : "#1f2522",
              fontSize: 14,
              boxShadow: "0 10px 24px rgba(20, 24, 22, 0.12)"
            }}
          >
            {searchState === "loading" ? "Searching..." : searchMessage}
          </div>
        ) : searchState === "loading" ? (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 14,
              background: "rgba(255, 255, 255, 0.92)",
              border: "1px solid rgba(31, 37, 34, 0.12)",
              color: "#1f2522",
              fontSize: 14,
              boxShadow: "0 10px 24px rgba(20, 24, 22, 0.12)"
            }}
          >
            Searching...
          </div>
        ) : null}
      </form>
      <div
        ref={mapRef}
        style={{
          width: "100%",
          height: "100%"
        }}
      />
    </main>
  );
}
