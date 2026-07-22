import {
  EditableMeasurementPoint as MeasurementPoint,
  EditableMeasurementSegment as MeasurementSegment,
} from "@/types/models"

const FEET_PER_DEGREE_LATITUDE = 364_000
const SNAP_DISTANCE_FEET = 1
const POINT_ON_LINE_TOLERANCE_FEET = 0.05
const ENDPOINT_RATIO_TOLERANCE = 0.000_001

type ClosestPoint = {
  point: MeasurementPoint
  distanceFeet: number
  ratio: number
}

function closestPointOnSegment(
  point: MeasurementPoint,
  segment: MeasurementSegment,
): ClosestPoint {
  const longitudeFeet =
    FEET_PER_DEGREE_LATITUDE *
    Math.cos((segment.start.latitude * Math.PI) / 180)
  const lineX = (segment.end.longitude - segment.start.longitude) * longitudeFeet
  const lineY =
    (segment.end.latitude - segment.start.latitude) * FEET_PER_DEGREE_LATITUDE
  const pointX = (point.longitude - segment.start.longitude) * longitudeFeet
  const pointY =
    (point.latitude - segment.start.latitude) * FEET_PER_DEGREE_LATITUDE
  const lineLengthSquared = lineX ** 2 + lineY ** 2
  const ratio =
    lineLengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, (pointX * lineX + pointY * lineY) / lineLengthSquared),
        )
  const snappedPoint = {
    latitude:
      segment.start.latitude +
      (segment.end.latitude - segment.start.latitude) * ratio,
    longitude:
      segment.start.longitude +
      (segment.end.longitude - segment.start.longitude) * ratio,
  }

  return {
    point: snappedPoint,
    distanceFeet: Math.hypot(
      (point.longitude - snappedPoint.longitude) * longitudeFeet,
      (point.latitude - snappedPoint.latitude) * FEET_PER_DEGREE_LATITUDE,
    ),
    ratio,
  }
}

/** Snaps a placed point to the closest existing segment within one foot. */
export function snapPointToMeasurementLine(
  point: MeasurementPoint,
  segments: MeasurementSegment[],
) {
  const nearest = segments.reduce<ClosestPoint | null>((best, segment) => {
    const candidate = closestPointOnSegment(point, segment)
    return !best || candidate.distanceFeet < best.distanceFeet ? candidate : best
  }, null)

  return nearest && nearest.distanceFeet <= SNAP_DISTANCE_FEET
    ? nearest.point
    : point
}

/**
 * Splits segments at points that are already on them, creating shared graph
 * vertices that bounded-face detection can use when it builds roof planes.
 */
export function splitMeasurementSegmentsAtKnownPoints(
  segments: MeasurementSegment[],
  knownPoints: MeasurementPoint[],
) {
  return segments.flatMap((segment) => {
    const splitPoints = knownPoints
      .map((point) => closestPointOnSegment(point, segment))
      .filter(
        (candidate) =>
          candidate.distanceFeet <= POINT_ON_LINE_TOLERANCE_FEET &&
          candidate.ratio > ENDPOINT_RATIO_TOLERANCE &&
          candidate.ratio < 1 - ENDPOINT_RATIO_TOLERANCE,
      )
      .sort((left, right) => left.ratio - right.ratio)
      .filter(
        (candidate, index, candidates) =>
          index === 0 ||
          Math.abs(candidate.ratio - candidates[index - 1].ratio) >
            ENDPOINT_RATIO_TOLERANCE,
      )

    if (splitPoints.length === 0) return [segment]

    const points = [
      segment.start,
      ...splitPoints.map((candidate) => candidate.point),
      segment.end,
    ]
    return points.slice(0, -1).map((start, index) => ({
      id: `${segment.id}:split:${index + 1}`,
      start,
      end: points[index + 1],
    }))
  })
}
