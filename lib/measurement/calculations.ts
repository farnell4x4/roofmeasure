import { Project, ProjectCalculations } from "@/types/models";
import { polygonAreaSqFt, slopeAdjustedAreaSqFt } from "@/lib/measurement/geometry";

export function calculateProjectTotals(project: Project): ProjectCalculations {
  const totals = {
    eave: 0,
    valley: 0,
    rake: 0,
    hip: 0,
    ridge: 0
  };

  for (const segment of project.segments) {
    totals[segment.type] += segment.lengthFeet;
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
    totalPlanAreaSqFt,
    totalSlopeAreaSqFt,
    totalSquares: totalSlopeAreaSqFt / 100,
    planeCount: project.planes.length,
    segmentCount: project.segments.length
  };
}
