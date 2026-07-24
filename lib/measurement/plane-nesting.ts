export type PlaneNestingPoint = { x: number; y: number }

export type PlaneNestingRegion = {
  id: string
  points: PlaneNestingPoint[]
  area: number
}

function polygonArea(points: PlaneNestingPoint[]) {
  return Math.abs(
    points.reduce((area, point, index) => {
      const next = points[(index + 1) % points.length]
      return area + point.x * next.y - next.x * point.y
    }, 0) / 2,
  )
}

function isPointOnSegment(
  point: PlaneNestingPoint,
  start: PlaneNestingPoint,
  end: PlaneNestingPoint,
) {
  const cross =
    (point.y - start.y) * (end.x - start.x) -
    (point.x - start.x) * (end.y - start.y)
  if (Math.abs(cross) > 1e-9) return false

  const dot =
    (point.x - start.x) * (end.x - start.x) +
    (point.y - start.y) * (end.y - start.y)
  if (dot < 0) return false

  const segmentLengthSquared =
    (end.x - start.x) ** 2 + (end.y - start.y) ** 2
  return dot <= segmentLengthSquared
}

function isStrictlyInsidePolygon(point: PlaneNestingPoint, polygon: PlaneNestingPoint[]) {
  let inside = false

  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index]
    const previousPoint = polygon[previous]
    if (isPointOnSegment(point, previousPoint, currentPoint)) return false

    const crossesRay =
      (currentPoint.y > point.y) !== (previousPoint.y > point.y) &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x
    if (crossesRay) inside = !inside
  }

  return inside
}

function strictlyContains(
  outer: PlaneNestingRegion,
  inner: PlaneNestingRegion,
) {
  return (
    outer.points.length >= 3 &&
    inner.points.length >= 3 &&
    inner.points.every((point) => isStrictlyInsidePolygon(point, outer.points))
  )
}

/**
 * Converts nested plane outlines into non-overlapping areas. Each plane loses
 * only its direct children; grandchildren remain part of their parent plane.
 * Summing every returned value therefore counts each nested region exactly once.
 */
export function calculateNestedPlaneAreas(regions: PlaneNestingRegion[]) {
  const validRegions = regions.filter(
    (region) =>
      region.points.length >= 3 &&
      Number.isFinite(region.area) &&
      region.area > 0 &&
      polygonArea(region.points) > 0,
  )
  const parentById = new Map<string, string>()

  for (const child of validRegions) {
    const parent = validRegions
      .filter((candidate) => candidate.id !== child.id && strictlyContains(candidate, child))
      .sort((left, right) => polygonArea(left.points) - polygonArea(right.points))[0]
    if (parent) parentById.set(child.id, parent.id)
  }

  const directChildAreaByParentId = new Map<string, number>()
  for (const child of validRegions) {
    const parentId = parentById.get(child.id)
    if (!parentId) continue
    directChildAreaByParentId.set(
      parentId,
      (directChildAreaByParentId.get(parentId) ?? 0) + child.area,
    )
  }

  return new Map(
    regions.map((region) => [
      region.id,
      Math.max(0, region.area - (directChildAreaByParentId.get(region.id) ?? 0)),
    ]),
  )
}
