import { imagePointKey, type ImageMeasurementSegment, type ImageProject } from "@/types/image-projects"
import type { ProjectCalculations } from "@/types/models"

export type ImageProjectCalculations = ProjectCalculations & {
  unassignedLength: number
  unassignedSlopeAdjustedLength: number
  planeSquaresById: Record<string, number>
}

function emptyMeasurementTotals() {
  return { eave: 0, valley: 0, rake: 0, hip: 0, ridge: 0, wall: 0 }
}

function boundaryKey(start: string, end: string) {
  return [start, end].sort().join("|")
}

function pixelDistance(start: { x: number; y: number }, end: { x: number; y: number }) {
  return Math.hypot(end.x - start.x, end.y - start.y)
}

function pixelPolygonArea(points: Array<{ x: number; y: number }>) {
  return Math.abs(points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length]
    return area + point.x * next.y - next.x * point.y
  }, 0) / 2)
}

/**
 * Image projects use entered line lengths as their source of truth. For a
 * completed plane, the image outline supplies its shape and each entered edge
 * calibrates that shape to feet. Those entered lengths already include slope,
 * so an optional pitch is displayed but never applied to image calculations.
 */
export function calculateImageProjectTotals(project: ImageProject): ImageProjectCalculations {
  const totals = emptyMeasurementTotals()
  const slopeAdjustedTotals = emptyMeasurementTotals()
  const segmentByBoundary = new Map<string, ImageMeasurementSegment>()
  const pointByKey = new Map<string, { x: number; y: number }>()

  for (const segment of project.segments) {
    segmentByBoundary.set(boundaryKey(imagePointKey(segment.start), imagePointKey(segment.end)), segment)
    pointByKey.set(imagePointKey(segment.start), segment.start)
    pointByKey.set(imagePointKey(segment.end), segment.end)
  }

  let totalPlanAreaSqFt = 0
  let totalSlopeAreaSqFt = 0
  const planeSquaresById: Record<string, number> = {}
  for (const plane of project.planes) {
    planeSquaresById[plane.id] = 0
    const boundarySegments = plane.pointKeys.map((pointKey, index) =>
      segmentByBoundary.get(boundaryKey(pointKey, plane.pointKeys[(index + 1) % plane.pointKeys.length])),
    )
    const points = plane.pointKeys.map((key) => pointByKey.get(key))
    const hasCompleteBoundary = boundarySegments.length === plane.pointKeys.length &&
      boundarySegments.every((segment) => segment && segment.lengthFeet > 0) &&
      points.every((point): point is { x: number; y: number } => Boolean(point))
    if (!hasCompleteBoundary) continue

    const calibrationScales = boundarySegments.map((segment) => {
      const pixelLength = pixelDistance(segment!.start, segment!.end)
      return pixelLength > 0 ? segment!.lengthFeet / pixelLength : 0
    }).filter((scale) => scale > 0)
    if (!calibrationScales.length) continue

    const feetPerPixel = calibrationScales.reduce((sum, scale) => sum + scale, 0) / calibrationScales.length
    const planAreaSqFt = pixelPolygonArea(points) * feetPerPixel ** 2
    totalPlanAreaSqFt += planAreaSqFt
    const slopeAreaSqFt = planAreaSqFt
    totalSlopeAreaSqFt += slopeAreaSqFt
    planeSquaresById[plane.id] = slopeAreaSqFt / 100
  }

  let unassignedLength = 0
  let unassignedSlopeAdjustedLength = 0
  for (const segment of project.segments) {
    const measuredLength = segment.lengthFeet
    if (!segment.type) {
      unassignedLength += measuredLength
      unassignedSlopeAdjustedLength += measuredLength
      continue
    }

    totals[segment.type] += measuredLength
    slopeAdjustedTotals[segment.type] += measuredLength
  }

  const totalMeasuredLength = Object.values(totals).reduce((sum, length) => sum + length, 0) + unassignedLength
  const totalSlopeAdjustedLength = Object.values(slopeAdjustedTotals).reduce((sum, length) => sum + length, 0) + unassignedSlopeAdjustedLength

  return {
    totals,
    slopeAdjustedTotals,
    totalMeasuredLength,
    totalSlopeAdjustedLength,
    totalPlanAreaSqFt,
    totalSlopeAreaSqFt,
    totalSquares: totalSlopeAreaSqFt / 100,
    planeCount: project.planes.length,
    segmentCount: project.segments.length,
    unassignedLength,
    unassignedSlopeAdjustedLength,
    planeSquaresById,
  }
}
