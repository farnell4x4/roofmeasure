"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createMapKitRegion,
  getMapKitConfigurationErrorMessage,
  getMapKitRuntimeErrorMessage,
  loadMapKit
} from "@/lib/mapkit/client";
import { formatLength } from "@/lib/units";
import { MapCameraState, MeasurementSegment, MeasurementType, Project, UnitSystem } from "@/types/models";
import { MEASUREMENT_TYPES } from "@/lib/constants";

export function MapViewport({
  project,
  camera,
  selectedType,
  activeStartPointId,
  onMapTap,
  onCameraChange,
  unitSystem,
  decimalFeet,
  promptVisible
}: {
  project: Project;
  camera: MapCameraState;
  selectedType: MeasurementType | null;
  activeStartPointId: string | null;
  onMapTap: (coordinate: { lat: number; lng: number }) => void;
  onCameraChange: (camera: MapCameraState) => void;
  unitSystem: UnitSystem;
  decimalFeet: boolean;
  promptVisible: boolean;
}) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<InstanceType<NonNullable<NonNullable<Window["mapkit"]>["Map"]>> | null>(null);
  const syncRegionRef = useRef(false);
  const initialCameraRef = useRef(camera);
  const onCameraChangeRef = useRef(onCameraChange);
  const onMapTapRef = useRef(onMapTap);
  const [mapError, setMapError] = useState<string | null>(null);
  const [pageRect, setPageRect] = useState({ left: 0, top: 0, width: 0, height: 0 });

  useEffect(() => {
    onCameraChangeRef.current = onCameraChange;
  }, [onCameraChange]);

  useEffect(() => {
    onMapTapRef.current = onMapTap;
  }, [onMapTap]);

  useEffect(() => {
    if (!mapRef.current) return;

    let cancelled = false;
    const mapkitWindow = window as Window & { mapkit?: NonNullable<Window["mapkit"]> };

    async function setupMap() {
      try {
        await loadMapKit();
        if (cancelled || !mapRef.current || !mapkitWindow.mapkit) return;

        const initialCamera = initialCameraRef.current;
        const region = createMapKitRegion(
          initialCamera.centerLat,
          initialCamera.centerLng,
          initialCamera.latSpan,
          initialCamera.lngSpan
        );
        if (!region) return;

        const map = new mapkitWindow.mapkit.Map(mapRef.current, {
          region,
          showsCompass: "visible",
          showsMapTypeControl: true,
          mapType: mapkitWindow.mapkit.MapType.Standard
        });

        mapInstanceRef.current = map;
        setMapError(null);

        const syncBounds = () => {
          const bounds = mapRef.current?.getBoundingClientRect();
          if (!bounds) return;
          setPageRect({
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
            height: bounds.height
          });
        };

        const handleRegionChange = () => {
          syncBounds();
          if (syncRegionRef.current) return;

          const currentRegion = map.region;
          onCameraChangeRef.current({
            centerLat: currentRegion.center.latitude ?? initialCamera.centerLat,
            centerLng: currentRegion.center.longitude ?? initialCamera.centerLng,
            latSpan: currentRegion.span.latitudeDelta ?? initialCamera.latSpan,
            lngSpan: currentRegion.span.longitudeDelta ?? initialCamera.lngSpan
          });
        };

        const handleSingleTap = (event: Record<string, unknown>) => {
          const point = event.pointOnPage;
          if (!(point instanceof DOMPoint)) return;
          const coordinate = map.convertPointOnPageToCoordinate(point);
          if (
            typeof coordinate.latitude !== "number" ||
            typeof coordinate.longitude !== "number"
          ) {
            return;
          }
          onMapTapRef.current({
            lat: coordinate.latitude,
            lng: coordinate.longitude
          });
        };

        syncBounds();
        map.addEventListener("region-change-end", handleRegionChange);
        map.addEventListener("scroll-end", handleRegionChange);
        map.addEventListener("zoom-end", handleRegionChange);
        map.addEventListener("single-tap", handleSingleTap);

        const resizeObserver = new ResizeObserver(syncBounds);
        resizeObserver.observe(mapRef.current);

        return () => {
          resizeObserver.disconnect();
          map.removeEventListener("region-change-end", handleRegionChange);
          map.removeEventListener("scroll-end", handleRegionChange);
          map.removeEventListener("zoom-end", handleRegionChange);
          map.removeEventListener("single-tap", handleSingleTap);
          map.destroy();
          mapInstanceRef.current = null;
        };
      } catch (error) {
        if (cancelled) return;
        setMapError(getMapKitRuntimeErrorMessage(error) || (await getMapKitConfigurationErrorMessage()));
      }
    }

    let cleanup: (() => void) | undefined;
    setupMap().then((nextCleanup) => {
      cleanup = nextCleanup;
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const currentRegion = map.region;
    const nextValues = [camera.centerLat, camera.centerLng, camera.latSpan, camera.lngSpan];
    const currentValues = [
      currentRegion.center.latitude ?? camera.centerLat,
      currentRegion.center.longitude ?? camera.centerLng,
      currentRegion.span.latitudeDelta ?? camera.latSpan,
      currentRegion.span.longitudeDelta ?? camera.lngSpan
    ];
    const changed = nextValues.some((value, index) => Math.abs(value - currentValues[index]) > 0.000001);
    if (!changed) return;

    const nextRegion = createMapKitRegion(camera.centerLat, camera.centerLng, camera.latSpan, camera.lngSpan);
    if (!nextRegion) return;

    syncRegionRef.current = true;
    map.region = nextRegion;
    queueMicrotask(() => {
      syncRegionRef.current = false;
    });
  }, [camera.centerLat, camera.centerLng, camera.latSpan, camera.lngSpan]);

  const projectedPoints = useMemo(() => {
    const map = mapInstanceRef.current;
    if (!map || pageRect.width === 0 || pageRect.height === 0) return null;

    return new Map(
      project.points.map((point) => {
        const pagePoint = map.convertCoordinateToPointOnPage({
          latitude: point.lat,
          longitude: point.lng
        });

        return [
          point.id,
          {
            x: pagePoint.x - pageRect.left,
            y: pagePoint.y - pageRect.top
          }
        ];
      })
    );
  }, [pageRect.height, pageRect.left, pageRect.top, pageRect.width, project.points]);

  return (
    <div
      className="glass"
      style={{
        position: "relative",
        minHeight: "62vh",
        borderRadius: 28,
        overflow: "hidden",
        background:
          "linear-gradient(180deg, rgba(31,37,34,0.14), rgba(31,37,34,0.05)), repeating-linear-gradient(45deg, rgba(42,63,43,0.25), rgba(42,63,43,0.25) 18px, rgba(66,85,56,0.35) 18px, rgba(66,85,56,0.35) 36px)"
      }}
    >
      <div ref={mapRef} role="presentation" style={{ position: "absolute", inset: 0 }} />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {promptVisible ? (
          <div
            className="glass"
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              right: 12,
              zIndex: 2,
              borderRadius: 18,
              padding: "10px 14px",
              fontSize: 14
            }}
          >
            Pinch to zoom • One finger to drag • Tap to place tape
          </div>
        ) : null}
        {mapError ? (
          <div
            className="glass"
            style={{
              position: "absolute",
              left: 12,
              right: 12,
              bottom: 12,
              zIndex: 2,
              borderRadius: 18,
              padding: "10px 14px",
              fontSize: 14,
              color: "var(--danger)"
            }}
          >
            {mapError}
          </div>
        ) : null}
        <svg width="100%" height="100%">
          {project.planes.map((plane) => {
            const points = plane.pointIds
              .map((id) => projectedPoints?.get(id))
              .filter(Boolean)
              .map((point) => point!);
            if (points.length < 3) return null;
            return (
              <polygon
                key={plane.id}
                points={points.map((point) => `${point.x},${point.y}`).join(" ")}
                fill="rgba(201,111,48,0.16)"
                stroke="rgba(201,111,48,0.42)"
                strokeWidth={2}
              />
            );
          })}
          {project.segments.map((segment) => (
            <SegmentLine
              key={segment.id}
              segment={segment}
              projectedPoints={projectedPoints}
              unitSystem={unitSystem}
              decimalFeet={decimalFeet}
            />
          ))}
          {project.points.map((point) => {
            const projected = projectedPoints?.get(point.id);
            if (!projected) return null;
            const active = point.id === activeStartPointId;
            return (
              <g key={point.id}>
                <circle cx={projected.x} cy={projected.y} r={active ? 8 : 6} fill={active ? "#fff" : "#f4f1ea"} stroke="var(--accent)" strokeWidth={2} />
              </g>
            );
          })}
        </svg>
      </div>
      {!selectedType ? (
        <div style={{ position: "absolute", bottom: 14, left: 14 }} className="chip">
          Select a measurement type to begin
        </div>
      ) : null}
    </div>
  );
}

function SegmentLine({
  segment,
  projectedPoints,
  unitSystem,
  decimalFeet
}: {
  segment: MeasurementSegment;
  projectedPoints: Map<string, { x: number; y: number }> | null;
  unitSystem: UnitSystem;
  decimalFeet: boolean;
}) {
  const start = projectedPoints?.get(segment.startPointId);
  const end = projectedPoints?.get(segment.endPointId);
  if (!start || !end) return null;
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const color = MEASUREMENT_TYPES.find((item) => item.type === segment.type)?.color ?? "#fff";

  return (
    <g>
      <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={color} strokeWidth={4} strokeLinecap="round" />
      <rect x={midpoint.x - 46} y={midpoint.y - 18} width={92} height={28} rx={14} fill="rgba(31,37,34,0.78)" />
      <text x={midpoint.x} y={midpoint.y + 4} fill="#fff" textAnchor="middle" fontSize={13} fontWeight={600}>
        {formatLength(segment.lengthFeet, unitSystem, decimalFeet)}
      </text>
    </g>
  );
}
