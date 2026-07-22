import { polygonAreaSqFt } from "@/lib/measurement/geometry"
import { GeographicPoint, MeasurementSegment, RoofPlane } from "@/types/models"

type DirectedEdge = {
  from: string
  to: string
  angle: number
}

function signedArea(points: GeographicPoint[]) {
  const averageLatitude =
    points.reduce((sum, point) => sum + point.lat, 0) / points.length
  const longitudeScale = Math.cos((averageLatitude * Math.PI) / 180)

  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length]
    return area +
      point.lng * longitudeScale * next.lat -
      next.lng * longitudeScale * point.lat
  }, 0) / 2
}

function canonicalCycle(pointIds: string[]) {
  return pointIds.reduce<string[]>((best, _point, index) => {
    const candidate = [...pointIds.slice(index), ...pointIds.slice(0, index)]
    return candidate.join("|") < best.join("|") ? candidate : best
  }, pointIds).join("|")
}

/**
 * Finds bounded faces in the drawn segment graph. A face exists only when
 * every edge around it has been explicitly measured; open paths are ignored.
 */
export function detectRoofPlanes(
  points: GeographicPoint[],
  segments: MeasurementSegment[],
  existingPlanes: RoofPlane[] = [],
): RoofPlane[] {
  const pointsById = new Map(points.map((point) => [point.id, point]))
  const directedEdges: DirectedEdge[] = []
  const outgoing = new Map<string, DirectedEdge[]>()
  const seenUndirectedEdges = new Set<string>()

  function addDirectedEdge(from: string, to: string) {
    const start = pointsById.get(from)
    const end = pointsById.get(to)
    if (!start || !end) return
    const edge = {
      from,
      to,
      angle: Math.atan2(end.lat - start.lat, end.lng - start.lng),
    }
    directedEdges.push(edge)
    outgoing.set(from, [...(outgoing.get(from) ?? []), edge])
  }

  for (const segment of segments) {
    if (segment.startPointId === segment.endPointId) continue
    const edgeKey = [segment.startPointId, segment.endPointId].sort().join("|")
    if (seenUndirectedEdges.has(edgeKey)) continue
    seenUndirectedEdges.add(edgeKey)
    addDirectedEdge(segment.startPointId, segment.endPointId)
    addDirectedEdge(segment.endPointId, segment.startPointId)
  }

  for (const edges of outgoing.values()) {
    edges.sort((left, right) => left.angle - right.angle)
  }

  const previousPitchById = new Map(
    existingPlanes.map((plane) => [plane.id, plane.pitch]),
  )
  const visited = new Set<string>()
  const planes: RoofPlane[] = []

  for (const firstEdge of directedEdges) {
    const firstKey = `${firstEdge.from}>${firstEdge.to}`
    if (visited.has(firstKey)) continue

    const cycle: string[] = []
    let edge: DirectedEdge | undefined = firstEdge
    let closed = false

    while (edge) {
      const currentEdge = edge
      const edgeKey = `${currentEdge.from}>${currentEdge.to}`
      if (visited.has(edgeKey)) break
      visited.add(edgeKey)
      cycle.push(currentEdge.from)

      const choices: DirectedEdge[] = outgoing.get(currentEdge.to) ?? []
      const reverseIndex = choices.findIndex(
        (candidate) => candidate.to === currentEdge.from,
      )
      if (reverseIndex < 0) break
      const nextEdge =
        choices[(reverseIndex - 1 + choices.length) % choices.length]
      if (!nextEdge) break
      edge = nextEdge

      if (edge.from === firstEdge.from && edge.to === firstEdge.to) break
    }

    if (edge?.from === firstEdge.from && edge.to === firstEdge.to) {
      closed = true
    }
    if (cycle.length < 3 || !closed) {
      continue
    }

    const cyclePoints = cycle
      .map((pointId) => pointsById.get(pointId))
      .filter((point): point is GeographicPoint => Boolean(point))
    if (cyclePoints.length !== cycle.length || signedArea(cyclePoints) <= 0) {
      continue
    }

    const id = `plane_${canonicalCycle(cycle)}`
    planes.push({
      id,
      name: `Roof Plane ${planes.length + 1}`,
      pointIds: cycle,
      pitch: previousPitchById.get(id),
      planAreaSqFt: polygonAreaSqFt(cyclePoints),
      source: "auto",
    })
  }

  return planes
}
