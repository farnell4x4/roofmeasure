import {
  MeasurementSegment,
  Project,
  ProjectCalculations,
  RoofPlane,
} from "@/types/models";
import {
  pitchFactor,
  roundedPolygonAreaSqFt,
  slopeAdjustedAreaSqFt,
} from "@/lib/measurement/geometry";
import { roundMeasurement } from "@/lib/measurement/rounding";

const SLOPE_ADJUSTED_LINE_TYPES = new Set(["rake", "hip", "valley"]);

export type ProjectCalculationBreakdown = {
  planes: Array<{
    id: string;
    pitch: string;
    planAreaSqFt: number;
    slopeFactor: number;
    slopeAreaSqFt: number;
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
  };
}

function planeContainsSegment(plane: RoofPlane, segment: MeasurementSegment) {
  return plane.pointIds.some((pointId, index) => {
    const nextPointId = plane.pointIds[(index + 1) % plane.pointIds.length];
    return (
      (pointId === segment.startPointId && nextPointId === segment.endPointId) ||
      (pointId === segment.endPointId && nextPointId === segment.startPointId)
    );
  });
}

/**
 * A hip or valley can belong to two planes. Until full 3D intersections are
 * modeled, use the steeper adjoining plane so the calculated material length
 * is never understated.
 */
function segmentPitch(project: Project, segment: MeasurementSegment) {
  const pitches = project.planes
    .filter((plane) => planeContainsSegment(plane, segment))
    .map((plane) => plane.pitch ?? project.singlePitch ?? "0/12");

  return pitches.sort((left, right) => pitchFactor(right) - pitchFactor(left))[0] ??
    project.singlePitch ??
    "0/12";
}

export function slopeAdjustedSegmentLength(
  project: Project,
  segment: MeasurementSegment,
) {
  const measuredLengthFeet = roundMeasurement(segment.lengthFeet);
  return SLOPE_ADJUSTED_LINE_TYPES.has(segment.type)
    ? measuredLengthFeet * pitchFactor(segmentPitch(project, segment))
    : measuredLengthFeet;
}

export function getProjectCalculationBreakdown(
  project: Project,
): ProjectCalculationBreakdown {
  const pointMap = new Map(project.points.map((point) => [point.id, point]));

  return {
    segments: project.segments.map((segment) => {
      const measuredLengthFeet = roundMeasurement(segment.lengthFeet);
      const pitch = SLOPE_ADJUSTED_LINE_TYPES.has(segment.type)
        ? segmentPitch(project, segment)
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
    planes: project.planes.map((plane) => {
      const points = plane.pointIds
        .map((id) => pointMap.get(id))
        .filter((point): point is NonNullable<typeof point> => Boolean(point));
      const planAreaSqFt =
        points.length >= 3
          ? roundedPolygonAreaSqFt(points)
          : roundMeasurement(plane.planAreaSqFt);
      const pitch = plane.pitch ?? project.singlePitch ?? "0/12";
      const slopeFactor = pitchFactor(pitch);
      return {
        id: plane.id,
        pitch,
        planAreaSqFt,
        slopeFactor,
        slopeAreaSqFt: slopeAdjustedAreaSqFt(planAreaSqFt, pitch),
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
    segmentCount: project.segments.length
  };
}
