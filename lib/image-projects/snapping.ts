import type { ImageMeasurementSegment, ImagePoint } from "@/types/image-projects"

const IMAGE_SNAP_RATIO = 0.0015
// Keep snapping easy to use without pulling points onto a nearby line too early.
const MIN_IMAGE_SNAP_SCREEN_PIXELS = 4
const POINT_ON_LINE_TOLERANCE_PIXELS = 0.01
const ENDPOINT_RATIO_TOLERANCE = 0.000_001

type ClosestPoint = {
  point: ImagePoint
  distancePixels: number
  ratio: number
}

export function imageSnapTolerance(
  imageWidth: number,
  imageHeight: number,
  sourcePixelsPerScreenPixel = 1,
) {
  return Math.max(
    Math.hypot(imageWidth, imageHeight) * IMAGE_SNAP_RATIO,
    MIN_IMAGE_SNAP_SCREEN_PIXELS * sourcePixelsPerScreenPixel,
  )
}

function closestPointOnSegment(point: ImagePoint, segment: ImageMeasurementSegment): ClosestPoint {
  const lineX = segment.end.x - segment.start.x
  const lineY = segment.end.y - segment.start.y
  const pointX = point.x - segment.start.x
  const pointY = point.y - segment.start.y
  const lineLengthSquared = lineX ** 2 + lineY ** 2
  const ratio = lineLengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, (pointX * lineX + pointY * lineY) / lineLengthSquared))
  const snappedPoint = {
    x: segment.start.x + lineX * ratio,
    y: segment.start.y + lineY * ratio,
  }

  return {
    point: snappedPoint,
    distancePixels: Math.hypot(point.x - snappedPoint.x, point.y - snappedPoint.y),
    ratio,
  }
}

/** Snaps a placed image point to the closest existing image line. */
export function snapImagePointToMeasurementLine(
  point: ImagePoint,
  segments: ImageMeasurementSegment[],
  imageWidth: number,
  imageHeight: number,
  sourcePixelsPerScreenPixel = 1,
) {
  const nearest = segments.reduce<ClosestPoint | null>((best, segment) => {
    const candidate = closestPointOnSegment(point, segment)
    return !best || candidate.distancePixels < best.distancePixels ? candidate : best
  }, null)

  return nearest && nearest.distancePixels <= imageSnapTolerance(imageWidth, imageHeight, sourcePixelsPerScreenPixel)
    ? nearest.point
    : point
}

/**
 * Splits image lines at existing points on their interior. This makes the
 * snapped point a shared graph vertex, which lets image plane detection close
 * faces exactly like the map measurement flow.
 */
export function splitImageMeasurementSegmentsAtKnownPoints(
  segments: ImageMeasurementSegment[],
  knownPoints: ImagePoint[],
) {
  return segments.flatMap((segment) => {
    const splitPoints = knownPoints
      .map((point) => closestPointOnSegment(point, segment))
      .filter((candidate) =>
        candidate.distancePixels <= POINT_ON_LINE_TOLERANCE_PIXELS &&
        candidate.ratio > ENDPOINT_RATIO_TOLERANCE &&
        candidate.ratio < 1 - ENDPOINT_RATIO_TOLERANCE,
      )
      .sort((left, right) => left.ratio - right.ratio)
      .filter((candidate, index, candidates) =>
        index === 0 || Math.abs(candidate.ratio - candidates[index - 1].ratio) > ENDPOINT_RATIO_TOLERANCE,
      )

    if (!splitPoints.length) return [segment]

    const points = [segment.start, ...splitPoints.map((candidate) => candidate.point), segment.end]
    return points.slice(0, -1).map((start, index) => {
      const end = points[index + 1]
      const startRatio = index === 0 ? 0 : splitPoints[index - 1].ratio
      const endRatio = index === splitPoints.length ? 1 : splitPoints[index].ratio
      return {
        id: `${segment.id}:split:${index + 1}`,
        ...(segment.type ? { type: segment.type } : {}),
        start,
        end,
        lengthFeet: segment.lengthFeet * (endRatio - startRatio),
      }
    })
  })
}
