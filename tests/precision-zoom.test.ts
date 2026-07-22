import { describe, expect, it } from "vitest"
import {
  baseViewportPointToVisualViewportPoint,
  mapPagePointToBaseViewportPoint,
  visualPagePointToMapPagePoint,
  visualViewportPointToBaseViewportPoint,
  zoomAroundViewportCenter,
} from "@/lib/mapkit/precision-zoom"

describe("precision zoom transform", () => {
  const viewport = { x: 120, y: 80, width: 400, height: 280 }
  const pageOffset = { x: 18, y: 44 }

  it("round-trips base and visual points at five times zoom with a pan offset", () => {
    const transform = { scale: 5, offsetX: -860, offsetY: -510 }
    const basePoint = { x: 221.25, y: 143.5 }

    const visualPoint = baseViewportPointToVisualViewportPoint(
      basePoint,
      transform,
    )

    expect(
      visualViewportPointToBaseViewportPoint(visualPoint, transform),
    ).toEqual(basePoint)
  })

  it("converts a visual page click back to the exact MapKit base page point", () => {
    const transform = { scale: 5, offsetX: -860, offsetY: -510 }
    const mapPageOrigin = { x: 120 + 18 - 860, y: 80 + 44 - 510 }
    const mapPagePoint = {
      x: mapPageOrigin.x + 221.25,
      y: mapPageOrigin.y + 143.5,
    }
    const basePoint = mapPagePointToBaseViewportPoint(
      mapPagePoint,
      mapPageOrigin,
    )
    const visualPoint = baseViewportPointToVisualViewportPoint(
      basePoint,
      transform,
    )
    const visualPagePoint = {
      x: viewport.x + pageOffset.x + visualPoint.x,
      y: viewport.y + pageOffset.y + visualPoint.y,
    }

    expect(
      visualPagePointToMapPagePoint(
        visualPagePoint,
        viewport,
        pageOffset,
        mapPageOrigin,
        transform,
      ),
    ).toEqual(mapPagePoint)
  })

  it("keeps the viewport center anchored when changing the zoom level", () => {
    const current = { scale: 3, offsetX: -400, offsetY: -250 }
    const center = { x: viewport.width / 2, y: viewport.height / 2 }
    const baseCenter = visualViewportPointToBaseViewportPoint(center, current)
    const next = zoomAroundViewportCenter(current, 5, viewport)

    expect(baseViewportPointToVisualViewportPoint(baseCenter, next)).toEqual(
      center,
    )
  })
})
