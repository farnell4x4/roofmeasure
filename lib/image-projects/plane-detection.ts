import { imagePointKey, type ImageMeasurementSegment, type ImagePoint, type ImageRoofPlane } from "@/types/image-projects"

type Edge = { from: string; to: string; angle: number }

function signedArea(pointKeys: string[], points: Map<string, ImagePoint>) {
  return pointKeys.reduce((area, key, index) => {
    const point = points.get(key)
    const next = points.get(pointKeys[(index + 1) % pointKeys.length])
    return point && next ? area + point.x * next.y - next.x * point.y : area
  }, 0) / 2
}

/** Finds closed faces in a photo annotation graph. It deliberately has no area math. */
export function detectImageRoofPlanes(
  segments: ImageMeasurementSegment[],
  existingPlanes: ImageRoofPlane[] = [],
) {
  const points = new Map<string, ImagePoint>()
  const outgoing = new Map<string, Edge[]>()
  const seen = new Set<string>()

  for (const segment of segments) {
    const start = imagePointKey(segment.start)
    const end = imagePointKey(segment.end)
    if (start === end) continue
    points.set(start, segment.start)
    points.set(end, segment.end)
    const edgeKey = [start, end].sort().join("|")
    if (seen.has(edgeKey)) continue
    seen.add(edgeKey)
    for (const [from, to] of [[start, end], [end, start]] as const) {
      const a = points.get(from)!
      const b = points.get(to)!
      const edge = { from, to, angle: Math.atan2(b.y - a.y, b.x - a.x) }
      outgoing.set(from, [...(outgoing.get(from) ?? []), edge])
    }
  }
  for (const edges of outgoing.values()) edges.sort((a, b) => a.angle - b.angle)

  const previousPitches = new Map(existingPlanes.map((plane) => [plane.id, plane.pitch]))
  const visited = new Set<string>()
  const planes: ImageRoofPlane[] = []
  for (const first of [...outgoing.values()].flat()) {
    const firstKey = `${first.from}>${first.to}`
    if (visited.has(firstKey)) continue
    const cycle: string[] = []
    let edge: Edge | undefined = first
    while (edge && !visited.has(`${edge.from}>${edge.to}`)) {
      const currentEdge: Edge = edge
      visited.add(`${currentEdge.from}>${currentEdge.to}`)
      cycle.push(currentEdge.from)
      const choices: Edge[] = outgoing.get(currentEdge.to) ?? []
      const reverse: number = choices.findIndex((candidate: Edge) => candidate.to === currentEdge.from)
      edge = reverse < 0 ? undefined : choices[(reverse - 1 + choices.length) % choices.length]
    }
    if (!edge || edge.from !== first.from || edge.to !== first.to || cycle.length < 3) continue
    // A closed graph exposes each face in both directions. Keep the clockwise
    // image-space path only, which excludes the unbounded reverse face.
    if (signedArea(cycle, points) <= 0) continue
    const rotations = cycle.map((_, index) => [...cycle.slice(index), ...cycle.slice(0, index)].join("|"))
    const id = `image-plane_${rotations.sort()[0]}`
    if (planes.some((plane) => plane.id === id)) continue
    planes.push({ id, pointKeys: cycle, pitch: previousPitches.get(id) })
  }
  return planes
}
