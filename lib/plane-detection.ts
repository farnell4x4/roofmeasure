import { MeasurementSegment, RoofPlane } from "@/types/models";

export function detectRoofPlanes(pointIds: string[], segments: MeasurementSegment[]): RoofPlane[] {
  if (pointIds.length < 3 || segments.length < 3) return [];
  return [
    {
      id: `plane_${pointIds.join("_")}`,
      name: "Roof Plane 1",
      pointIds,
      pitch: undefined,
      planAreaSqFt: 0,
      slopeAreaSqFt: 0,
      source: "auto"
    }
  ];
}
