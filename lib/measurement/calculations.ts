import {
  MeasurementSegment,
  Project,
  ProjectCalculations,
} from "@/types/models";
import {
  pitchFactor,
  roundedPolygonAreaSqFt,
} from "@/lib/measurement/geometry";
import { roundMeasurement } from "@/lib/measurement/rounding";

const SLOPE_ADJUSTED_LINE_TYPES = new Set(["rake", "hip", "valley", "wall"]);

export type ProjectCalculationBreakdown = {
  planes: Array<{
    id: string;
    pitch: string;
    pitchApplied: boolean;
    planAreaSqFt: number;
    slopeFactor: number;
    slopeAreaSqFt: number;
    boundarySegments: Array<{
      id: string | null;
      type: MeasurementSegment["type"] | null;
      measuredLengthFeet: number;
    }>;
  }>;
  segments: Array<{
    id: string;
    type: MeasurementSegment["type"];
    measuredLengthFeet: number;
    pitch: string | null;
    slopeFactor: number;
    slopeAdjustedLengthFeet: number;
  }>;
};

function emptyMeasurementTotals() {
  return {
    eave: 0,
    valley: 0,
    rake: 0,
    hip: 0,
    ridge: 0,
    wall: 0,
  };
}

function boundaryKey(startPointId: string, endPointId: string) {
  return [startPointId, endPointId].sort().join("|");
}

export function slopeAdjustedSegmentLength(
  project: Project,
  segment: MeasurementSegment,
) {
  return getProjectCalculationBreakdown(project).segments.find(
    (item) => item.id === segment.id,
  )?.slopeAdjustedLengthFeet ?? roundMeasurement(segment.lengthFeet);
}

export function getProjectCalculationBreakdown(
  project: Project,
): ProjectCalculationBreakdown {
  const pointMap = new Map(project.points.map((point) => [point.id, point]));
  const segmentByBoundary = new Map(
    project.segments.map((segment) => [
      boundaryKey(segment.startPointId, segment.endPointId),
      segment,
    ]),
  );
  const rawTypeBySegmentId = new Map(
    project.measurementGeometry?.segments.map((segment) => [
      segment.id,
      segment.type,
    ]) ?? [],
  );
  const pitchesBySlopeSegmentId = new Map<string, string[]>();

  const planes = project.planes.map((plane) => {
    const points = plane.pointIds
      .map((id) => pointMap.get(id))
      .filter((point): point is NonNullable<typeof point> => Boolean(point));
    const planAreaSqFt =
      points.length >= 3
        ? roundedPolygonAreaSqFt(points)
        : roundMeasurement(plane.planAreaSqFt);
    const pitch = plane.pitch ?? project.singlePitch ?? "0/12";
    const boundarySegments = plane.pointIds.map((pointId, index) => {
      const nextPointId = plane.pointIds[(index + 1) % plane.pointIds.length];
      const segment = segmentByBoundary.get(boundaryKey(pointId, nextPointId));
      const type = segment
        ? rawTypeBySegmentId.has(segment.id)
          ? rawTypeBySegmentId.get(segment.id) ?? null
          : segment.type
        : null;
      return {
        id: segment?.id ?? null,
        type,
        measuredLengthFeet: segment ? roundMeasurement(segment.lengthFeet) : 0,
      };
    });
    const pitchApplied =
      boundarySegments.length > 0 &&
      boundarySegments.every((segment) => segment.id && segment.type) &&
      boundarySegments.filter(
        (segment) => segment.type && SLOPE_ADJUSTED_LINE_TYPES.has(segment.type),
      ).length >= 2;
    const slopeFactor = pitchApplied ? pitchFactor(pitch) : 1;

    if (pitchApplied) {
      for (const segment of boundarySegments) {
        if (
          !segment.id ||
          !segment.type ||
          !SLOPE_ADJUSTED_LINE_TYPES.has(segment.type)
        ) {
          continue;
        }
        pitchesBySlopeSegmentId.set(segment.id, [
          ...(pitchesBySlopeSegmentId.get(segment.id) ?? []),
          pitch,
        ]);
      }
    }

    return {
      id: plane.id,
      pitch,
      pitchApplied,
      planAreaSqFt,
      slopeFactor,
      slopeAreaSqFt: planAreaSqFt * slopeFactor,
      boundarySegments,
    };
  });

  return {
    planes,
    segments: project.segments.map((segment) => {
      const measuredLengthFeet = roundMeasurement(segment.lengthFeet);
      const pitches = pitchesBySlopeSegmentId.get(segment.id) ?? [];
      const pitch = SLOPE_ADJUSTED_LINE_TYPES.has(segment.type) && pitches.length
        ? pitches.sort((left, right) => pitchFactor(right) - pitchFactor(left))[0]
        : null;
      const slopeFactor = pitch ? pitchFactor(pitch) : 1;
      return {
        id: segment.id,
        type: segment.type,
        measuredLengthFeet,
        pitch,
        slopeFactor,
        slopeAdjustedLengthFeet: measuredLengthFeet * slopeFactor,
      };
    }),
  };
}

export function calculateProjectTotals(project: Project): ProjectCalculations {
  const totals = emptyMeasurementTotals();
  const slopeAdjustedTotals = emptyMeasurementTotals();
  const breakdown = getProjectCalculationBreakdown(project);

  for (const segment of breakdown.segments) {
    totals[segment.type] += segment.measuredLengthFeet;
    slopeAdjustedTotals[segment.type] += segment.slopeAdjustedLengthFeet;
  }

  const totalPlanAreaSqFt = breakdown.planes.reduce(
    (sum, plane) => sum + plane.planAreaSqFt,
    0,
  );
  const totalSlopeAreaSqFt = breakdown.planes.reduce(
    (sum, plane) => sum + plane.slopeAreaSqFt,
    0,
  );

  return {
    totals,
    slopeAdjustedTotals,
    totalMeasuredLength: Object.values(totals).reduce(
      (sum, length) => sum + length,
      0,
    ),
    totalSlopeAdjustedLength: Object.values(slopeAdjustedTotals).reduce(
      (sum, length) => sum + length,
      0,
    ),
    totalPlanAreaSqFt,
    totalSlopeAreaSqFt,
    totalSquares: totalSlopeAreaSqFt / 100,
    planeCount: project.planes.length,
    segmentCount: project.segments.length,
  };
}
