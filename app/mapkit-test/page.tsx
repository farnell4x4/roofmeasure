"use client";

import { MapPin, Search } from "lucide-react";
import { FormEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  loadMapKit,
  lookupStreetAddressWithBias,
  searchAddressSuggestions,
  searchBestAddressMatch
} from "@/lib/mapkit/client";
import { haversineDistanceFeet } from "@/lib/measurement/geometry";
import { AddressSuggestion } from "@/types/mapkit";

type LocationPermission = PermissionState | "unsupported";
const LOCATION_ALERT_DISMISSED_KEY = "roofmeasure.mapkit-test.location-alert-dismissed";
const SEARCH_MAX_ZOOM_SPAN = 0.00005;
type MeasurementPoint = { latitude: number; longitude: number };
type MeasurementSegment = { id: string; start: MeasurementPoint; end: MeasurementPoint };
type DecisionAnchor = { x: number; y: number };
type ProjectedMeasurementPoint = MeasurementPoint & {
  key: string;
  x: number;
  y: number;
  tone: "solid" | "pending";
};

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
  const mapViewportRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<InstanceType<NonNullable<NonNullable<Window["mapkit"]>["Map"]>> | null>(null);
  const superZoomDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    dragging: boolean;
  } | null>(null);
  const measurementPointDragRef = useRef<{
    pointerId: number;
    sourcePoint: MeasurementPoint;
  } | null>(null);
  const hasCenteredOnUserLocationRef = useRef(false);
  const selectedPlaceAnnotationRef = useRef<unknown>(null);
  const currentLocationAnnotationRef = useRef<unknown>(null);
  const measurementPointAnnotationRefs = useRef<unknown[]>([]);
  const measurementLineOverlayRefs = useRef<unknown[]>([]);
  const measurementLabelAnnotationRefs = useRef<unknown[]>([]);
  const locationBiasRef = useRef<{
    centerLat: number;
    centerLng: number;
    latSpan: number;
    lngSpan: number;
    countryCode?: string;
  } | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [query, setQuery] = useState("");
  const [suppressSuggestionsUntilTyping, setSuppressSuggestionsUntilTyping] = useState(false);
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
  const [measurementSegments, setMeasurementSegments] = useState<MeasurementSegment[]>([]);
  const [pendingLineStart, setPendingLineStart] = useState<MeasurementPoint | null>(null);
  const [pendingModeDecisionPoint, setPendingModeDecisionPoint] = useState<MeasurementPoint | null>(null);
  const [pendingModeDecisionAnchor, setPendingModeDecisionAnchor] = useState<DecisionAnchor | null>(null);
  const [isMeasurementSettingsOpen, setIsMeasurementSettingsOpen] = useState(false);
  const [superZoomScale, setSuperZoomScale] = useState(1);
  const [superZoomOffsetX, setSuperZoomOffsetX] = useState(0);
  const [superZoomOffsetY, setSuperZoomOffsetY] = useState(0);
  const [projectionRevision, setProjectionRevision] = useState(0);
  const [locationState, setLocationState] = useState<
    "idle" | "requesting" | "granted" | "denied" | "unsupported" | "error" | "prompt"
  >("idle");
  const [locationAlert, setLocationAlert] = useState("");
  const [isLocationAlertDismissed, setIsLocationAlertDismissed] = useState(false);
  const superZoomActive = superZoomScale > 1;

  const safariLocationHelp =
    'In Safari, open Website Settings for this page and change Location to "Allow", then reload this page.';

  useEffect(() => {
    locationBiasRef.current = locationBias;
  }, [locationBias]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsLocationAlertDismissed(window.localStorage.getItem(LOCATION_ALERT_DISMISSED_KEY) === "1");
  }, []);

  function dismissLocationAlert() {
    setIsLocationAlertDismissed(true);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LOCATION_ALERT_DISMISSED_KEY, "1");
    }
  }

  function restoreLocationAlert() {
    setIsLocationAlertDismissed(false);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(LOCATION_ALERT_DISMISSED_KEY);
    }
  }

  function resetMeasurementSession() {
    setMeasurementSegments([]);
    setPendingLineStart(null);
    setPendingModeDecisionPoint(null);
    setPendingModeDecisionAnchor(null);
    setIsMeasurementSettingsOpen(false);
  }

  function clampSuperZoomOffsets(scale: number, offsetX: number, offsetY: number) {
    const bounds = mapViewportRef.current?.getBoundingClientRect();
    if (!bounds || scale <= 1) {
      return { x: 0, y: 0 };
    }

    const minX = bounds.width - bounds.width * scale;
    const minY = bounds.height - bounds.height * scale;

    return {
      x: Math.min(0, Math.max(minX, offsetX)),
      y: Math.min(0, Math.max(minY, offsetY))
    };
  }

  function resetSuperZoom() {
    setSuperZoomScale(1);
    setSuperZoomOffsetX(0);
    setSuperZoomOffsetY(0);
    superZoomDragRef.current = null;
  }

  function setSuperZoomLevel(nextScale: number) {
    if (nextScale <= 1) {
      resetSuperZoom();
      return;
    }

    const clampedOffsets = clampSuperZoomOffsets(nextScale, superZoomOffsetX, superZoomOffsetY);
    setSuperZoomScale(nextScale);
    setSuperZoomOffsetX(clampedOffsets.x);
    setSuperZoomOffsetY(clampedOffsets.y);
  }

  function appendMeasurementSegment(start: MeasurementPoint, end: MeasurementPoint) {
    setMeasurementSegments((currentSegments) => [
      ...currentSegments,
      {
        id: `${Date.now()}-${currentSegments.length}`,
        start,
        end
      }
    ]);
  }

  function pointKey(point: MeasurementPoint) {
    return `${point.latitude.toFixed(7)}:${point.longitude.toFixed(7)}`;
  }

  function updateMeasurementPointsMatching(sourcePoint: MeasurementPoint, nextPoint: MeasurementPoint) {
    const sourceKey = pointKey(sourcePoint);

    setMeasurementSegments((currentSegments) =>
      currentSegments.map((segment) => ({
        ...segment,
        start: pointKey(segment.start) === sourceKey ? nextPoint : segment.start,
        end: pointKey(segment.end) === sourceKey ? nextPoint : segment.end
      }))
    );
    setPendingLineStart((currentPoint) => (currentPoint && pointKey(currentPoint) === sourceKey ? nextPoint : currentPoint));
    setPendingModeDecisionPoint((currentPoint) => (currentPoint && pointKey(currentPoint) === sourceKey ? nextPoint : currentPoint));
  }

  function getViewportAnchorFromPagePoint(pointOnPage: DOMPoint): DecisionAnchor | null {
    const bounds = mapViewportRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    return {
      x: pointOnPage.x - bounds.left,
      y: pointOnPage.y - bounds.top
    };
  }

  function projectSuperZoomX(x: number) {
    return x * superZoomScale + superZoomOffsetX;
  }

  function projectSuperZoomY(y: number) {
    return y * superZoomScale + superZoomOffsetY;
  }

  function handleTappedCoordinate(tappedPoint: MeasurementPoint, anchor: DecisionAnchor | null) {
    if (!pendingLineStart) {
      setPendingLineStart(tappedPoint);
      setPendingModeDecisionPoint(null);
      setPendingModeDecisionAnchor(null);
      return;
    }

    setPendingModeDecisionPoint(tappedPoint);
    setPendingModeDecisionAnchor(anchor);
  }

  function handlePointOnPage(pointOnPage: DOMPoint, anchor?: DecisionAnchor | null) {
    const map = mapInstanceRef.current;
    if (!map || pendingModeDecisionPoint) return;

    const coordinate = map.convertPointOnPageToCoordinate(pointOnPage);
    handleTappedCoordinate({
      latitude: coordinate.latitude ?? 0,
      longitude: coordinate.longitude ?? 0
    }, anchor ?? getViewportAnchorFromPagePoint(pointOnPage));
  }

  function applyMeasurementModeChoice(mode: "continue" | "start-new") {
    const decisionPoint = pendingModeDecisionPoint;
    setPendingModeDecisionPoint(null);
    setPendingModeDecisionAnchor(null);
    setIsMeasurementSettingsOpen(false);

    if (!decisionPoint) return;

    if (mode === "continue" && pendingLineStart) {
      appendMeasurementSegment(pendingLineStart, decisionPoint);
      setPendingLineStart(decisionPoint);
      return;
    }

    setPendingLineStart(decisionPoint);
  }

  function removeAnnotation(annotationRef: React.MutableRefObject<unknown>) {
    const map = mapInstanceRef.current;
    if (!map || !annotationRef.current) return;
    map.removeAnnotation(annotationRef.current);
    annotationRef.current = null;
  }

  function clearMeasurementVisuals() {
    const map = mapInstanceRef.current;
    if (!map) {
      measurementPointAnnotationRefs.current = [];
      measurementLineOverlayRefs.current = [];
      measurementLabelAnnotationRefs.current = [];
      return;
    }

    measurementPointAnnotationRefs.current.forEach((annotation) => map.removeAnnotation(annotation));
    measurementLabelAnnotationRefs.current.forEach((annotation) => map.removeAnnotation(annotation));
    measurementLineOverlayRefs.current.forEach((overlay) => map.removeOverlay(overlay));
    measurementPointAnnotationRefs.current = [];
    measurementLineOverlayRefs.current = [];
    measurementLabelAnnotationRefs.current = [];
  }

  function syncMeasurementVisuals() {
    const mapkit = window.mapkit;
    const map = mapInstanceRef.current;
    if (!mapkit || !map) return;

    clearMeasurementVisuals();
  }

  const projectedMeasurementOverlay = useMemo(() => {
    const mapkit = window.mapkit;
    const map = mapInstanceRef.current;
    const bounds = mapViewportRef.current?.getBoundingClientRect();
    if (!mapkit || !map || !bounds) {
      return {
        segments: [] as Array<{
          id: string;
          startX: number;
          startY: number;
          endX: number;
          endY: number;
          labelX: number;
          labelY: number;
          label: string;
        }>,
        points: [] as ProjectedMeasurementPoint[]
      };
    }

    const coordinateCtor = mapkit.Coordinate;
    const points = new Map<string, ProjectedMeasurementPoint>();
    const segments = measurementSegments.map((segment) => {
      const startPagePoint = map.convertCoordinateToPointOnPage(
        new coordinateCtor(segment.start.latitude, segment.start.longitude)
      );
      const endPagePoint = map.convertCoordinateToPointOnPage(
        new coordinateCtor(segment.end.latitude, segment.end.longitude)
      );
      const startX = startPagePoint.x - bounds.left;
      const startY = startPagePoint.y - bounds.top;
      const endX = endPagePoint.x - bounds.left;
      const endY = endPagePoint.y - bounds.top;
      const dx = endX - startX;
      const dy = endY - startY;
      const length = Math.hypot(dx, dy) || 1;
      const offsetX = (-dy / length) * 34;
      const offsetY = (dx / length) * 34;
      const startKey = pointKey(segment.start);
      const endKey = pointKey(segment.end);

      if (!points.has(startKey)) {
        points.set(startKey, {
          ...segment.start,
          key: startKey,
          x: startX,
          y: startY,
          tone: "solid"
        });
      }

      if (!points.has(endKey)) {
        points.set(endKey, {
          ...segment.end,
          key: endKey,
          x: endX,
          y: endY,
          tone: "solid"
        });
      }

      return {
        id: segment.id,
        startX,
        startY,
        endX,
        endY,
        labelX: (startX + endX) / 2 + offsetX,
        labelY: (startY + endY) / 2 + offsetY,
        label: `${Math.round(
          haversineDistanceFeet(
            { lat: segment.start.latitude, lng: segment.start.longitude },
            { lat: segment.end.latitude, lng: segment.end.longitude }
          )
        )}'`
      };
    });

    if (pendingLineStart) {
      const pendingPagePoint = map.convertCoordinateToPointOnPage(
        new coordinateCtor(pendingLineStart.latitude, pendingLineStart.longitude)
      );
      points.set(pointKey(pendingLineStart), {
        ...pendingLineStart,
        key: pointKey(pendingLineStart),
        x: pendingPagePoint.x - bounds.left,
        y: pendingPagePoint.y - bounds.top,
        tone: "pending"
      });
    }

    return {
      segments,
      points: Array.from(points.values())
    };
  }, [measurementSegments, pendingLineStart, projectionRevision]);

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
      restoreLocationAlert();
      setLocationState("granted");
      setLocationAlert("");
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
      clearMeasurementVisuals();
      selectedPlaceAnnotationRef.current = null;
      currentLocationAnnotationRef.current = null;
      mapInstanceRef.current?.destroy?.();
      mapInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapReady || !mapViewportRef.current || !mapInstanceRef.current) return;

    function refreshProjectionMetrics() {
      setProjectionRevision((current) => current + 1);
    }

    const map = mapInstanceRef.current;
    map.addEventListener("region-change-end", refreshProjectionMetrics);
    map.addEventListener("scroll-end", refreshProjectionMetrics);
    map.addEventListener("zoom-end", refreshProjectionMetrics);

    const resizeObserver = new ResizeObserver(refreshProjectionMetrics);
    resizeObserver.observe(mapViewportRef.current);
    refreshProjectionMetrics();

    return () => {
      map.removeEventListener("region-change-end", refreshProjectionMetrics);
      map.removeEventListener("scroll-end", refreshProjectionMetrics);
      map.removeEventListener("zoom-end", refreshProjectionMetrics);
      resizeObserver.disconnect();
    };
  }, [mapReady]);

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
        restoreLocationAlert();
        if (!locationBiasRef.current) {
          setLocationAlert("");
          void loadCurrentLocation();
        } else {
          setLocationAlert("");
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
            setLocationAlert("");
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

    if (suppressSuggestionsUntilTyping || normalizedQuery.length < 3) {
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

  function switchMapToSatelliteAfterSearch() {
    window.setTimeout(() => {
      const mapkit = window.mapkit;
      const map = mapInstanceRef.current;
      if (!mapkit || !map) return;

      map.mapType =
        (mapkit.Map as { MapTypes?: { Satellite?: typeof map.mapType } } | undefined)?.MapTypes?.Satellite ??
        mapkit.MapType?.Satellite ??
        map.mapType;
    }, 250);
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

  useEffect(() => {
    if (!mapReady || !mapRef.current || !mapInstanceRef.current) return;

    function handleMapTap(event: Record<string, unknown>) {
      const pointOnPage = event.pointOnPage as DOMPoint | undefined;
      if (!pointOnPage) return;
      handlePointOnPage(pointOnPage);
    }

    const map = mapInstanceRef.current;
    if (superZoomActive) {
      return;
    }
    map.addEventListener("single-tap", handleMapTap);

    return () => {
      map.removeEventListener("single-tap", handleMapTap);
    };
  }, [mapReady, pendingModeDecisionPoint, pendingLineStart, measurementSegments, superZoomActive]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    map.isScrollEnabled = !superZoomActive;
    map.isZoomEnabled = !superZoomActive;
    map.isRotationEnabled = !superZoomActive;
    map.isPitchEnabled = !superZoomActive;
  }, [superZoomActive]);

  useEffect(() => {
    if (!mapReady) return;
    syncMeasurementVisuals();
  }, [mapReady, measurementSegments, pendingLineStart, superZoomActive]);

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

      resetSuperZoom();
      recenterMap(bestMatch.latitude, bestMatch.longitude, SEARCH_MAX_ZOOM_SPAN, SEARCH_MAX_ZOOM_SPAN);
      switchMapToSatelliteAfterSearch();
      setSelectedPlace({
        latitude: bestMatch.latitude,
        longitude: bestMatch.longitude
      });
      setSuppressSuggestionsUntilTyping(true);
      resetMeasurementSession();
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
    setSuppressSuggestionsUntilTyping(true);
    setSearchState("loading");
    setSearchMessage("");

    try {
      if (typeof suggestion.latitude === "number" && typeof suggestion.longitude === "number" && !suggestion.mapkitResult) {
        resetSuperZoom();
        recenterMap(suggestion.latitude, suggestion.longitude, SEARCH_MAX_ZOOM_SPAN, SEARCH_MAX_ZOOM_SPAN);
        switchMapToSatelliteAfterSearch();
        setSelectedPlace({
          latitude: suggestion.latitude,
          longitude: suggestion.longitude
        });
        setSuppressSuggestionsUntilTyping(true);
        resetMeasurementSession();
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

      resetSuperZoom();
      recenterMap(bestMatch.latitude, bestMatch.longitude, SEARCH_MAX_ZOOM_SPAN, SEARCH_MAX_ZOOM_SPAN);
      switchMapToSatelliteAfterSearch();
      setSelectedPlace({
        latitude: bestMatch.latitude,
        longitude: bestMatch.longitude
      });
      setSuppressSuggestionsUntilTyping(true);
      resetMeasurementSession();
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

  function handleSuperZoomPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!superZoomActive) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    superZoomDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: superZoomOffsetX,
      originY: superZoomOffsetY,
      dragging: false
    };
  }

  function handleSuperZoomPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = superZoomDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !superZoomActive) return;

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.dragging && Math.hypot(deltaX, deltaY) > 4) {
      drag.dragging = true;
    }

    if (!drag.dragging) return;

    const clampedOffsets = clampSuperZoomOffsets(superZoomScale, drag.originX + deltaX, drag.originY + deltaY);
    setSuperZoomOffsetX(clampedOffsets.x);
    setSuperZoomOffsetY(clampedOffsets.y);
  }

  function handleSuperZoomPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = superZoomDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !superZoomActive) return;

    event.currentTarget.releasePointerCapture(event.pointerId);
    superZoomDragRef.current = null;

    if (drag.dragging) return;

    const originalPoint = getSuperZoomOriginalPagePoint(event.clientX, event.clientY);
    if (!originalPoint) return;
    const bounds = mapViewportRef.current?.getBoundingClientRect();
    handlePointOnPage(
      originalPoint,
      bounds
        ? {
            x: event.clientX - bounds.left,
            y: event.clientY - bounds.top
          }
        : null
    );
  }

  function handleSuperZoomPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    if (superZoomDragRef.current?.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      superZoomDragRef.current = null;
    }
  }

  function getSuperZoomOriginalPagePoint(clientX: number, clientY: number) {
    const bounds = mapViewportRef.current?.getBoundingClientRect();
    if (!bounds) return null;

    const originalX = (clientX - bounds.left - superZoomOffsetX) / superZoomScale;
    const originalY = (clientY - bounds.top - superZoomOffsetY) / superZoomScale;
    return new DOMPoint(bounds.left + originalX, bounds.top + originalY);
  }

  function handleMeasurementPointPointerDown(event: ReactPointerEvent<HTMLButtonElement>, point: MeasurementPoint) {
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    measurementPointDragRef.current = {
      pointerId: event.pointerId,
      sourcePoint: point
    };
  }

  function handleMeasurementPointPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = measurementPointDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !superZoomActive) return;

    event.stopPropagation();
    event.preventDefault();

    const map = mapInstanceRef.current;
    const originalPoint = getSuperZoomOriginalPagePoint(event.clientX, event.clientY);
    if (!map || !originalPoint) return;

    const coordinate = map.convertPointOnPageToCoordinate(originalPoint);
    const nextPoint = {
      latitude: coordinate.latitude ?? drag.sourcePoint.latitude,
      longitude: coordinate.longitude ?? drag.sourcePoint.longitude
    };
    updateMeasurementPointsMatching(drag.sourcePoint, nextPoint);
    drag.sourcePoint = nextPoint;
  }

  function handleMeasurementPointPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = measurementPointDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.releasePointerCapture(event.pointerId);
    measurementPointDragRef.current = null;
  }

  function handleMeasurementPointPointerCancel(event: ReactPointerEvent<HTMLButtonElement>) {
    if (measurementPointDragRef.current?.pointerId === event.pointerId) {
      event.stopPropagation();
      event.preventDefault();
      event.currentTarget.releasePointerCapture(event.pointerId);
      measurementPointDragRef.current = null;
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
          zIndex: 3,
          width: "min(420px, calc(100vw - 32px))",
          display: "grid",
          gap: 8
        }}
      >
        {locationAlert && !isLocationAlertDismissed ? (
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
            <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600 }}>
                <MapPin size={16} />
                Location access
              </div>
              <button
                type="button"
                aria-label="Dismiss location access message"
                onClick={dismissLocationAlert}
                style={{
                  border: 0,
                  background: "transparent",
                  color: "#8a6030",
                  cursor: "pointer",
                  fontSize: 18,
                  lineHeight: 1,
                  padding: 0
                }}
              >
                ×
              </button>
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
            onChange={(event) => {
              setSuppressSuggestionsUntilTyping(false);
              setQuery(event.target.value);
            }}
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
        style={{
          position: "absolute",
          top: 16,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 3,
          display: "grid",
          justifyItems: "center",
          gap: 8
        }}
      >
        <button
          type="button"
          onClick={() => setIsMeasurementSettingsOpen((current) => !current)}
          style={{
            border: "1px solid rgba(31, 37, 34, 0.12)",
            background: "rgba(255, 255, 255, 0.94)",
            color: "#1f2522",
            borderRadius: 999,
            padding: "10px 14px",
            fontSize: 13,
            fontWeight: 600,
            boxShadow: "0 14px 30px rgba(20, 24, 22, 0.16)",
            cursor: "pointer"
          }}
        >
          Settings
        </button>
        {isMeasurementSettingsOpen ? (
          <div
            style={{
              display: "grid",
              gap: 8,
              padding: 10,
              borderRadius: 16,
              background: "rgba(255, 255, 255, 0.96)",
              border: "1px solid rgba(31, 37, 34, 0.12)",
              boxShadow: "0 14px 30px rgba(20, 24, 22, 0.16)"
            }}
          >
            <div style={{ padding: "2px 4px", fontSize: 12, fontWeight: 700, color: "#5f685f", letterSpacing: "0.04em", textTransform: "uppercase" }}>
              Super Zoom
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
              {[1, 1.5, 2, 3].map((scale) => {
                const active = superZoomScale === scale;
                return (
                  <button
                    key={scale}
                    type="button"
                    onClick={() => setSuperZoomLevel(scale)}
                    style={{
                      border: 0,
                      borderRadius: 12,
                      padding: "10px 12px",
                      background: active ? "#1f2522" : "rgba(31, 37, 34, 0.08)",
                      color: active ? "#fff" : "#1f2522",
                      cursor: "pointer"
                    }}
                  >
                    {scale}x
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={resetSuperZoom}
              style={{
                border: 0,
                borderRadius: 12,
                padding: "10px 12px",
                background: "rgba(31, 37, 34, 0.08)",
                color: "#1f2522",
                cursor: "pointer"
              }}
            >
              Reset View
            </button>
          </div>
        ) : null}
        {superZoomActive ? (
          <div
            style={{
              padding: "8px 12px",
              borderRadius: 999,
              background: "rgba(31, 37, 34, 0.88)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 700,
              boxShadow: "0 14px 30px rgba(20, 24, 22, 0.16)"
            }}
          >
            Super Zoom {superZoomScale}x
          </div>
        ) : null}
      </div>
      {pendingModeDecisionPoint && pendingModeDecisionAnchor ? (
        <div
          style={{
            position: "absolute",
            left:
              pendingModeDecisionAnchor.x > window.innerWidth - 176
                ? pendingModeDecisionAnchor.x - 156
                : pendingModeDecisionAnchor.x + 20,
            top: Math.min(
              Math.max(pendingModeDecisionAnchor.y - 44, 12),
              window.innerHeight - 108
            ),
            zIndex: 3,
            display: "grid",
            gap: 8,
            width: 136,
            padding: 12,
            borderRadius: 16,
            background: "rgba(255, 255, 255, 0.97)",
            border: "1px solid rgba(31, 37, 34, 0.12)",
            boxShadow: "0 14px 30px rgba(20, 24, 22, 0.16)"
          }}
        >
          <button
            type="button"
            onClick={() => applyMeasurementModeChoice("continue")}
            style={{
              border: 0,
              borderRadius: 12,
              padding: "10px 12px",
              background: "#1f2522",
              color: "#fff",
              cursor: "pointer"
            }}
          >
            Continue
          </button>
          <button
            type="button"
            onClick={() => applyMeasurementModeChoice("start-new")}
            style={{
              border: 0,
              borderRadius: 12,
              padding: "10px 12px",
              background: "rgba(31, 37, 34, 0.08)",
              color: "#1f2522",
              cursor: "pointer"
            }}
          >
            Start New
          </button>
        </div>
      ) : null}
      <div
        ref={mapViewportRef}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
          overflow: "hidden"
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: `translate(${superZoomOffsetX}px, ${superZoomOffsetY}px) scale(${superZoomScale})`,
            transformOrigin: "top left",
            willChange: superZoomActive ? "transform" : undefined
          }}
        >
          <div
            ref={mapRef}
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 0
            }}
          />
        </div>
        {(measurementSegments.length > 0 || pendingLineStart) ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 2,
              pointerEvents: "none"
            }}
          >
            <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, overflow: "visible" }}>
              {projectedMeasurementOverlay.segments.map((segment) => (
                <g key={segment.id}>
                  <line
                    x1={projectSuperZoomX(segment.startX)}
                    y1={projectSuperZoomY(segment.startY)}
                    x2={projectSuperZoomX(segment.endX)}
                    y2={projectSuperZoomY(segment.endY)}
                    stroke="#e0b93b"
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeDasharray="6 6"
                  />
                  <g transform={`translate(${projectSuperZoomX(segment.labelX)} ${projectSuperZoomY(segment.labelY)})`}>
                    <rect
                      x={-24}
                      y={-10}
                      width={48}
                      height={20}
                      rx={10}
                      fill="rgba(31, 37, 34, 0.82)"
                    />
                    <text
                      x={0}
                      y={3.5}
                      fill="#fff"
                      textAnchor="middle"
                      fontSize="10pt"
                      fontWeight={700}
                    >
                      {segment.label}
                    </text>
                  </g>
                </g>
              ))}
            </svg>
            {projectedMeasurementOverlay.points.map((point) => (
              <button
                key={`${point.key}:${point.tone}`}
                type="button"
                onPointerDown={(event) => handleMeasurementPointPointerDown(event, point)}
                onPointerMove={handleMeasurementPointPointerMove}
                onPointerUp={handleMeasurementPointPointerUp}
                onPointerCancel={handleMeasurementPointPointerCancel}
                style={{
                  position: "absolute",
                  left: projectSuperZoomX(point.x),
                  top: projectSuperZoomY(point.y),
                  width: 28,
                  height: 28,
                  transform: "translate(-50%, -50%)",
                  borderRadius: 999,
                  border: 0,
                  background: "transparent",
                  padding: 0,
                  cursor: "grab",
                  pointerEvents: "auto",
                  touchAction: "none",
                  display: "grid",
                  placeItems: "center"
                }}
                aria-label="Move measurement point"
              >
                <span
                  style={{
                    display: "block",
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    border: point.tone === "pending" ? "2px solid #1f2522" : "2px solid rgba(255,255,255,0.95)",
                    background: point.tone === "pending" ? "#ffffff" : "#1f2522",
                    boxShadow: "0 6px 18px rgba(20, 24, 22, 0.22)"
                  }}
                />
              </button>
            ))}
          </div>
        ) : null}
        {superZoomActive ? (
          <div
            onPointerDown={handleSuperZoomPointerDown}
            onPointerMove={handleSuperZoomPointerMove}
            onPointerUp={handleSuperZoomPointerUp}
            onPointerCancel={handleSuperZoomPointerCancel}
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 1,
              touchAction: "none",
              cursor: superZoomDragRef.current?.dragging ? "grabbing" : "grab"
            }}
          />
        ) : null}
      </div>
    </main>
  );
}
