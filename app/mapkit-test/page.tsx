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

type LocationPermission = PermissionState | "unsupported";

async function getLocationPermission(): Promise<LocationPermission> {
  if (typeof navigator === "undefined" || !navigator.permissions || typeof navigator.permissions.query !== "function") {
    return "unsupported";
  }

  try {
    const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    return status.state;
  } catch {
    return "unsupported";
  }
}

async function requestCurrentLocation() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10_000,
      maximumAge: 30_000
    });
  });
}

export default function MapKitTestPage() {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<InstanceType<NonNullable<NonNullable<Window["mapkit"]>["Map"]>> | null>(null);
  const hasCenteredOnUserLocationRef = useRef(false);
  const selectedPlaceAnnotationRef = useRef<unknown>(null);
  const currentLocationAnnotationRef = useRef<unknown>(null);
  const locationBiasRef = useRef<{
    centerLat: number;
    centerLng: number;
    latSpan: number;
    lngSpan: number;
    countryCode?: string;
  } | null>(null);
  const [mapReady, setMapReady] = useState(false);
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
  const [currentLocation, setCurrentLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationState, setLocationState] = useState<
    "idle" | "requesting" | "granted" | "denied" | "unsupported" | "error" | "prompt"
  >("idle");
  const [locationAlert, setLocationAlert] = useState("");

  const safariLocationHelp =
    'In Safari, open Website Settings for this page and change Location to "Allow", then reload this page.';

  useEffect(() => {
    locationBiasRef.current = locationBias;
  }, [locationBias]);

  function removeAnnotation(annotationRef: React.MutableRefObject<unknown>) {
    const map = mapInstanceRef.current;
    if (!map || !annotationRef.current) return;
    map.removeAnnotation(annotationRef.current);
    annotationRef.current = null;
  }

  function syncSelectedPlaceAnnotation(place: { latitude: number; longitude: number } | null) {
    const mapkit = window.mapkit;
    const map = mapInstanceRef.current;
    if (!mapkit?.MarkerAnnotation || !map) return;

    removeAnnotation(selectedPlaceAnnotationRef);

    if (!place) return;

    const annotation = new mapkit.MarkerAnnotation(new mapkit.Coordinate(place.latitude, place.longitude), {
      color: "#d94b3d"
    });
    selectedPlaceAnnotationRef.current = annotation;
    map.addAnnotation(annotation);
  }

  function syncCurrentLocationAnnotation(location: { latitude: number; longitude: number } | null) {
    const mapkit = window.mapkit;
    const map = mapInstanceRef.current;
    if (!mapkit?.Annotation || !map) return;

    removeAnnotation(currentLocationAnnotationRef);

    if (!location) return;

    const annotation = new mapkit.Annotation(
      new mapkit.Coordinate(location.latitude, location.longitude),
      () => {
        const element = document.createElement("div");
        element.style.width = "14px";
        element.style.height = "14px";
        element.style.borderRadius = "999px";
        element.style.background = "#0a84ff";
        element.style.border = "3px solid rgba(255,255,255,0.95)";
        element.style.boxShadow = "0 0 0 6px rgba(10, 132, 255, 0.18), 0 6px 18px rgba(10, 132, 255, 0.28)";
        return element;
      },
      {
        size: { width: 14, height: 14 }
      }
    );

    currentLocationAnnotationRef.current = annotation;
    map.addAnnotation(annotation);
  }

  async function loadCurrentLocation() {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setLocationState("unsupported");
      setLocationAlert("Location access is unavailable in this browser. Search will still work, but results may be less local.");
      return;
    }

    setLocationState("requesting");

    try {
      const position = await requestCurrentLocation();
      setLocationBias({
        centerLat: position.coords.latitude,
        centerLng: position.coords.longitude,
        latSpan: 0.2,
        lngSpan: 0.2,
        countryCode: "US"
      });
      setCurrentLocation({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      });
      setLocationState("granted");
      setLocationAlert("Using your current location to improve nearby address suggestions.");
    } catch (error) {
      const geolocationError =
        error && typeof error === "object" && "code" in error ? (error as GeolocationPositionError) : null;

      if (geolocationError) {
        if (geolocationError.code === geolocationError.PERMISSION_DENIED) {
          setLocationState("denied");
          setLocationAlert(`Location access is denied for this site. ${safariLocationHelp}`);
          return;
        }

        if (geolocationError.code === geolocationError.POSITION_UNAVAILABLE) {
          setLocationState("error");
          setLocationAlert("Your permission is granted, but your location is currently unavailable. Search will continue without local bias.");
          return;
        }

        if (geolocationError.code === geolocationError.TIMEOUT) {
          setLocationState("error");
          setLocationAlert("Location lookup timed out. Try again to improve nearby address suggestions.");
          return;
        }
      }

      setLocationState("error");
      setLocationAlert("We could not get your location right now. Search will continue without local bias.");
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        await loadMapKit();
        const mapkit = window.mapkit;

        if (cancelled || !mapRef.current) return;
        if (!mapkit) {
          setSearchState("error");
          setSearchMessage("MapKit did not finish loading.");
          return;
        }

        const center = new mapkit.Coordinate(39.5501, -105.7821);
        const span = new mapkit.CoordinateSpan(0.04, 0.04);
        const region = new mapkit.CoordinateRegion(center, span);

        mapInstanceRef.current = new mapkit.Map(mapRef.current, {
          region,
          showsCompass: "visible",
          showsMapTypeControl: true,
          mapType: mapkit.MapType?.Standard
        });
        setMapReady(true);
      } catch (error) {
        console.error("MapKit test page failed to initialize.", error);
        setSearchState("error");
        setSearchMessage(error instanceof Error ? error.message : "Map initialization failed.");
      }
    }

    void run();

    return () => {
      cancelled = true;
      setMapReady(false);
      selectedPlaceAnnotationRef.current = null;
      currentLocationAnnotationRef.current = null;
      mapInstanceRef.current?.destroy?.();
      mapInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    let permissionStatus: PermissionStatus | null = null;
    let cancelled = false;

    async function refreshLocationPermission() {
      const permission = await getLocationPermission();
      if (cancelled) return;

      if (permissionStatus) {
        permissionStatus.onchange = null;
        permissionStatus = null;
      }

      if (permission === "granted") {
        setLocationState("granted");
        if (!locationBiasRef.current) {
          setLocationAlert("Location access is allowed. Fetching your current location for nearby suggestions.");
          void loadCurrentLocation();
        } else {
          setLocationAlert("Using your current location to improve nearby address suggestions.");
        }
        return;
      }

      if (permission === "denied") {
        setLocationState("denied");
        setLocationAlert(`Location access is denied for this site. ${safariLocationHelp}`);
        return;
      }

      if (permission === "prompt") {
        setLocationState("prompt");
        setLocationAlert("Allow location to improve nearby address suggestions.");
      } else {
        setLocationState("unsupported");
        setLocationAlert("Location permission status is unavailable here. Use my location to try the browser geolocation API directly.");
      }

      if (!navigator.permissions || typeof navigator.permissions.query !== "function") {
        return;
      }

      try {
        permissionStatus = await navigator.permissions.query({ name: "geolocation" as PermissionName });
        if (cancelled) return;
        permissionStatus.onchange = () => {
          setLocationState(permissionStatus!.state);
          if (permissionStatus!.state === "granted") {
            void loadCurrentLocation();
            return;
          }

          if (permissionStatus!.state === "denied") {
            setLocationAlert(`Location access is denied for this site. ${safariLocationHelp}`);
            return;
          }

          setLocationAlert("Allow location to improve nearby address suggestions.");
        };
      } catch {
        if (!cancelled) {
          setLocationState("unsupported");
          setLocationAlert("Location permission status is unavailable here. Use my location to try the browser geolocation API directly.");
        }
      }
    }

    function handleReturnToPage() {
      if (document.visibilityState === "visible") {
        void refreshLocationPermission();
      }
    }

    void refreshLocationPermission();
    window.addEventListener("focus", handleReturnToPage);
    document.addEventListener("visibilitychange", handleReturnToPage);

    return () => {
      cancelled = true;
      if (permissionStatus) permissionStatus.onchange = null;
      window.removeEventListener("focus", handleReturnToPage);
      document.removeEventListener("visibilitychange", handleReturnToPage);
    };
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

  function recenterMap(latitude: number, longitude: number, latDelta?: number, lngDelta?: number) {
    const mapkitWindow = window as Window & { mapkit?: NonNullable<Window["mapkit"]> };
    const map = mapInstanceRef.current;
    if (!mapkitWindow.mapkit || !map) {
      throw new Error("Map is not ready yet.");
    }

    const span = map.region?.span;
    const region = new mapkitWindow.mapkit.CoordinateRegion(
      new mapkitWindow.mapkit.Coordinate(latitude, longitude),
      new mapkitWindow.mapkit.CoordinateSpan(latDelta ?? span?.latitudeDelta ?? 0.01, lngDelta ?? span?.longitudeDelta ?? 0.01)
    );

    map.region = region;
  }

  useEffect(() => {
    if (!mapReady || !currentLocation || selectedPlace || hasCenteredOnUserLocationRef.current) {
      return;
    }

    recenterMap(currentLocation.latitude, currentLocation.longitude, 0.02, 0.02);
    hasCenteredOnUserLocationRef.current = true;
  }, [currentLocation, mapReady, selectedPlace]);

  useEffect(() => {
    if (!mapReady) return;
    syncCurrentLocationAnnotation(currentLocation);
  }, [currentLocation, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    syncSelectedPlaceAnnotation(selectedPlace);
  }, [currentLocation, mapReady, selectedPlace]);

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

      recenterMap(bestMatch.latitude, bestMatch.longitude, 0.003, 0.003);
      setSelectedPlace({
        latitude: bestMatch.latitude,
        longitude: bestMatch.longitude
      });
      setSuggestions([]);
      setAutocompleteState("idle");
      setAutocompleteMessage("");
      setSearchState("idle");
      setSearchMessage("");
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
        recenterMap(suggestion.latitude, suggestion.longitude, 0.003, 0.003);
        setSelectedPlace({
          latitude: suggestion.latitude,
          longitude: suggestion.longitude
        });
        setSuggestions([]);
        setAutocompleteState("idle");
        setAutocompleteMessage("");
        setSearchState("idle");
        setSearchMessage("");
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

      recenterMap(bestMatch.latitude, bestMatch.longitude, 0.003, 0.003);
      setSelectedPlace({
        latitude: bestMatch.latitude,
        longitude: bestMatch.longitude
      });
      setSuggestions([]);
      setAutocompleteState("idle");
      setAutocompleteMessage("");
      setSearchState("idle");
      setSearchMessage("");
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
            {locationState === "prompt" || locationState === "error" || locationState === "idle" ? (
              <button
                type="button"
                onClick={() => void loadCurrentLocation()}
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
                Use my location
              </button>
            ) : null}
            {locationState === "granted" && locationBias ? (
              <div style={{ fontSize: 13, color: "#6d4a22" }}>
                Using location near {locationBias.centerLat.toFixed(4)}, {locationBias.centerLng.toFixed(4)}.
              </div>
            ) : null}
            {locationState === "denied" ? (
              <div style={{ fontSize: 13, color: "#6d4a22" }}>
                Open Safari page settings for `localhost`, allow Location, then reload.
              </div>
            ) : null}
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
          position: "absolute",
          inset: 0
        }}
      />
    </main>
  );
}
