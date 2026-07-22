import {
  EditableMeasurementPoint,
  EditableMeasurementSegment,
} from "@/types/models"

export function createTieInSegment(
  start: EditableMeasurementPoint,
  end: EditableMeasurementPoint,
  id: string,
): EditableMeasurementSegment {
  return { id, start, end }
}
