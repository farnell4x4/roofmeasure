export type Point2D = {
  x: number
  y: number
}

export type ViewportRect = Point2D & {
  width: number
  height: number
}

export type PrecisionZoomTransform = {
  scale: number
  offsetX: number
  offsetY: number
}

export const PRECISION_ZOOM_LEVELS = [1, 1.5, 2, 3, 5] as const

export const DEFAULT_PRECISION_ZOOM: PrecisionZoomTransform = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
}

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback
}

export function clampPrecisionZoomTransform(
  transform: PrecisionZoomTransform,
  viewport: Pick<ViewportRect, "width" | "height">,
): PrecisionZoomTransform {
  const scale = Math.max(1, finiteOr(transform.scale, 1))
  if (scale === 1 || viewport.width <= 0 || viewport.height <= 0) {
    return DEFAULT_PRECISION_ZOOM
  }

  const minOffsetX = viewport.width - viewport.width * scale
  const minOffsetY = viewport.height - viewport.height * scale

  return {
    scale,
    offsetX: Math.min(0, Math.max(minOffsetX, finiteOr(transform.offsetX, 0))),
    offsetY: Math.min(0, Math.max(minOffsetY, finiteOr(transform.offsetY, 0))),
  }
}

export function baseViewportPointToVisualViewportPoint(
  point: Point2D,
  transform: PrecisionZoomTransform,
): Point2D {
  return {
    x: point.x * transform.scale + transform.offsetX,
    y: point.y * transform.scale + transform.offsetY,
  }
}

export function visualViewportPointToBaseViewportPoint(
  point: Point2D,
  transform: PrecisionZoomTransform,
): Point2D {
  const scale = Math.max(1, transform.scale)
  return {
    x: (point.x - transform.offsetX) / scale,
    y: (point.y - transform.offsetY) / scale,
  }
}

export function pagePointToViewportPoint(
  point: Point2D,
  viewport: Pick<ViewportRect, "x" | "y">,
  pageOffset: Point2D,
): Point2D {
  return {
    x: point.x - (viewport.x + pageOffset.x),
    y: point.y - (viewport.y + pageOffset.y),
  }
}

export function viewportPointToPagePoint(
  point: Point2D,
  viewport: Pick<ViewportRect, "x" | "y">,
  pageOffset: Point2D,
): Point2D {
  return {
    x: viewport.x + pageOffset.x + point.x,
    y: viewport.y + pageOffset.y + point.y,
  }
}

export function mapPagePointToBaseViewportPoint(
  mapPagePoint: Point2D,
  mapPageOrigin: Point2D,
): Point2D {
  return {
    x: mapPagePoint.x - mapPageOrigin.x,
    y: mapPagePoint.y - mapPageOrigin.y,
  }
}

export function visualPagePointToMapPagePoint(
  visualPagePoint: Point2D,
  viewport: Pick<ViewportRect, "x" | "y">,
  pageOffset: Point2D,
  mapPageOrigin: Point2D,
  transform: PrecisionZoomTransform,
): Point2D {
  const visualViewportPoint = pagePointToViewportPoint(
    visualPagePoint,
    viewport,
    pageOffset,
  )
  const baseViewportPoint = visualViewportPointToBaseViewportPoint(
    visualViewportPoint,
    transform,
  )
  return {
    x: mapPageOrigin.x + baseViewportPoint.x,
    y: mapPageOrigin.y + baseViewportPoint.y,
  }
}

export function zoomAroundViewportCenter(
  current: PrecisionZoomTransform,
  nextScale: number,
  viewport: Pick<ViewportRect, "width" | "height">,
): PrecisionZoomTransform {
  if (nextScale <= 1) return DEFAULT_PRECISION_ZOOM

  const center = {
    x: viewport.width / 2,
    y: viewport.height / 2,
  }
  const baseCenter = visualViewportPointToBaseViewportPoint(center, current)

  return clampPrecisionZoomTransform(
    {
      scale: nextScale,
      offsetX: center.x - baseCenter.x * nextScale,
      offsetY: center.y - baseCenter.y * nextScale,
    },
    viewport,
  )
}
