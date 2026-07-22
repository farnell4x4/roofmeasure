import { haversineDistanceFeet } from "@/lib/measurement/geometry"
import {
  EditableMeasurementPoint as MeasurementPoint,
  EditableMeasurementSegment,
  Project,
} from "@/types/models"

export function measurementPointKey(point: MeasurementPoint) {
  return `${point.latitude.toFixed(7)}:${point.longitude.toFixed(7)}`
}

export function measurementGeometrySignature(
  measurementSegments: EditableMeasurementSegment[],
  pendingLineStart?: MeasurementPoint | null,
) {
  return JSON.stringify({
    segments: measurementSegments.map((segment) => ({
      id: segment.id,
      start: {
        latitude: segment.start.latitude,
        longitude: segment.start.longitude,
      },
      end: {
        latitude: segment.end.latitude,
        longitude: segment.end.longitude,
      },
    })),
    pendingLineStart: pendingLineStart
      ? {
          latitude: pendingLineStart.latitude,
          longitude: pendingLineStart.longitude,
        }
      : null,
  })
}

export function toProjectMeasurementData(
  measurementSegments: EditableMeasurementSegment[],
  pendingLineStart?: MeasurementPoint | null,
) {
  const now = new Date().toISOString()
  const points = new Map<string, { id: string; lat: number; lng: number }>()

  function ensurePoint(point: MeasurementPoint) {
    const key = measurementPointKey(point)
    if (!points.has(key)) {
      points.set(key, {
        id: key,
        lat: point.latitude,
        lng: point.longitude,
      })
    }
    return points.get(key)!
  }

  if (pendingLineStart) {
    ensurePoint(pendingLineStart)
  }

  const segments = measurementSegments.map((segment) => {
    const startPoint = ensurePoint(segment.start)
    const endPoint = ensurePoint(segment.end)
    return {
      id: segment.id,
      type: "eave" as const,
      startPointId: startPoint.id,
      endPointId: endPoint.id,
      lengthFeet: haversineDistanceFeet(
        { lat: segment.start.latitude, lng: segment.start.longitude },
        { lat: segment.end.latitude, lng: segment.end.longitude },
      ),
      groupId: "mapkit-test",
      createdAt: now,
      updatedAt: now,
    }
  })

  return {
    measurementGeometry: {
      segments: measurementSegments.map((segment) => ({
        id: segment.id,
        start: { ...segment.start },
        end: { ...segment.end },
      })),
      pendingLineStart: pendingLineStart ? { ...pendingLineStart } : null,
    },
    points: Array.from(points.values()),
    segments,
  }
}

export function fromProjectMeasurementData(project: Project) {
  const canonicalGeometry = project.measurementGeometry
  if (canonicalGeometry?.segments) {
    return {
      segments: canonicalGeometry.segments.map((segment) => ({
        id: segment.id,
        start: { ...segment.start },
        end: { ...segment.end },
      })),
      pendingLineStart: canonicalGeometry.pendingLineStart
        ? { ...canonicalGeometry.pendingLineStart }
        : null,
    }
  }

  const pointsById = new Map(project.points.map((point) => [point.id, point]))
  const usedPointIds = new Set<string>()

  const segments = project.segments
    .map((segment) => {
      const startPoint = pointsById.get(segment.startPointId)
      const endPoint = pointsById.get(segment.endPointId)
      if (!startPoint || !endPoint) return null
      usedPointIds.add(segment.startPointId)
      usedPointIds.add(segment.endPointId)
      return {
        id: segment.id,
        start: {
          latitude: startPoint.lat,
          longitude: startPoint.lng,
        },
        end: {
          latitude: endPoint.lat,
          longitude: endPoint.lng,
        },
      }
    })
    .filter((segment): segment is EditableMeasurementSegment =>
      Boolean(segment),
    )

  const orphanPoint = [...project.points]
    .reverse()
    .find((point) => !usedPointIds.has(point.id))

  return {
    segments,
    pendingLineStart: orphanPoint
      ? {
          latitude: orphanPoint.lat,
          longitude: orphanPoint.lng,
        }
      : null,
  }
}
