import {
  MeasurementSegment,
  Project,
  ProjectCalculations,
  RoofPlane,
} from "@/types/models";
import {
  pitchFactor,
  polygonAreaSqFt,
  slopeAdjustedAreaSqFt,
} from "@/lib/measurement/geometry";

const SLOPE_ADJUSTED_LINE_TYPES = new Set(["rake", "hip", "valley"]);

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
  return SLOPE_ADJUSTED_LINE_TYPES.has(segment.type)
    ? segment.lengthFeet * pitchFactor(segmentPitch(project, segment))
    : segment.lengthFeet;
}

export function calculateProjectTotals(project: Project): ProjectCalculations {
  const totals = emptyMeasurementTotals();
  const slopeAdjustedTotals = emptyMeasurementTotals();

  for (const segment of project.segments) {
    totals[segment.type] += segment.lengthFeet;
    slopeAdjustedTotals[segment.type] += slopeAdjustedSegmentLength(
      project,
      segment,
    );
  }

  let totalPlanAreaSqFt = 0;
  let totalSlopeAreaSqFt = 0;
  const pointMap = new Map(project.points.map((point) => [point.id, point]));

  for (const plane of project.planes) {
    const points = plane.pointIds
      .map((id) => pointMap.get(id))
      .filter((point): point is NonNullable<typeof point> => Boolean(point));
    const area = points.length >= 3 ? polygonAreaSqFt(points) : plane.planAreaSqFt;
    totalPlanAreaSqFt += area;
    totalSlopeAreaSqFt += slopeAdjustedAreaSqFt(area, plane.pitch ?? project.singlePitch ?? "0/12");
  }

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
