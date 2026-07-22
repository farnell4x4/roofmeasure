import type { MeasurementType } from "@/types/models"

/** Coordinates are source-image pixels, never MapKit coordinates. */
export type ImagePoint = { x: number; y: number }

export type ImageMeasurementSegment = {
  id: string
  type?: MeasurementType
  start: ImagePoint
  end: ImagePoint
  /** Entered by the estimator; photo perspective makes automatic scale unreliable. */
  lengthFeet: number
}

export type ImageRoofPlane = {
  id: string
  pointKeys: string[]
  pitch?: string
}

export type ImageProject = {
  id: string
  schemaVersion: number
  kind: "image"
  name: string
  image: Blob
  imageName: string
  imageWidth: number
  imageHeight: number
  segments: ImageMeasurementSegment[]
  pendingLineStart: ImagePoint | null
  planes: ImageRoofPlane[]
  singlePitch: string
  createdAt: string
  updatedAt: string
  lastOpenedAt: string
}

export function imagePointKey(point: ImagePoint) {
  return `${Math.round(point.x * 100) / 100}:${Math.round(point.y * 100) / 100}`
}
