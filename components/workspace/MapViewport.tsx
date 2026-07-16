"use client";

import { RefObject, useMemo } from "react";
import { projectToViewport } from "@/lib/geometry";
import { formatLength } from "@/lib/units";
import { MapCameraState, MeasurementSegment, MeasurementType, Project, UnitSystem } from "@/types/models";
import { MEASUREMENT_TYPES } from "@/lib/constants";

export function MapViewport({
  mapRef,
  project,
  camera,
  selectedType,
  activeStartPointId,
  onCanvasTap,
  unitSystem,
  decimalFeet,
  promptVisible
}: {
  mapRef: RefObject<HTMLDivElement | null>;
  project: Project;
  camera: MapCameraState;
  selectedType: MeasurementType | null;
  activeStartPointId: string | null;
  onCanvasTap: (event: React.PointerEvent<HTMLDivElement>) => void;
  unitSystem: UnitSystem;
  decimalFeet: boolean;
  promptVisible: boolean;
}) {
  const pointMap = useMemo(
    () => new Map(project.points.map((point) => [point.id, point])),
    [project.points]
  );

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
      <div
        ref={mapRef}
        onPointerDown={onCanvasTap}
        role="presentation"
        style={{ position: "absolute", inset: 0 }}
      />
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
        <svg width="100%" height="100%" viewBox="0 0 1000 1000" preserveAspectRatio="none">
          {project.planes.map((plane) => {
            const points = plane.pointIds
              .map((id) => pointMap.get(id))
              .filter(Boolean)
              .map((point) => projectToViewport(point!, 1000, 1000, camera));
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
              pointMap={pointMap}
              camera={camera}
              unitSystem={unitSystem}
              decimalFeet={decimalFeet}
            />
          ))}
          {project.points.map((point) => {
            const projected = projectToViewport(point, 1000, 1000, camera);
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
  pointMap,
  camera,
  unitSystem,
  decimalFeet
}: {
  segment: MeasurementSegment;
  pointMap: Map<string, Project["points"][number]>;
  camera: MapCameraState;
  unitSystem: UnitSystem;
  decimalFeet: boolean;
}) {
  const start = pointMap.get(segment.startPointId);
  const end = pointMap.get(segment.endPointId);
  if (!start || !end) return null;
  const a = projectToViewport(start, 1000, 1000, camera);
  const b = projectToViewport(end, 1000, 1000, camera);
  const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const color = MEASUREMENT_TYPES.find((item) => item.type === segment.type)?.color ?? "#fff";

  return (
    <g>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={4} strokeLinecap="round" />
      <rect x={midpoint.x - 46} y={midpoint.y - 18} width={92} height={28} rx={14} fill="rgba(31,37,34,0.78)" />
      <text x={midpoint.x} y={midpoint.y + 4} fill="#fff" textAnchor="middle" fontSize={13} fontWeight={600}>
        {formatLength(segment.lengthFeet, unitSystem, decimalFeet)}
      </text>
    </g>
  );
}
