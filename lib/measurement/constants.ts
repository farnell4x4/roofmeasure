import { MeasurementType } from "@/types/models";

export const PRODUCT_NAME = "Roof Tape Measure";

export const MEASUREMENT_TYPES: Array<{
  type: MeasurementType;
  label: string;
  color: string;
}> = [
  { type: "eave", label: "Eave", color: "#ca7b45" },
  { type: "valley", label: "Valley", color: "#4d8f87" },
  { type: "rake", label: "Rake", color: "#7f6ab3" },
  { type: "hip", label: "Hip", color: "#cb4e59" },
  { type: "ridge", label: "Ridge", color: "#2863b6" },
  { type: "wall", label: "Wall", color: "#5d7183" }
];

export const DEFAULT_CAMERA = {
  centerLat: 39.7392,
  centerLng: -104.9903,
  latSpan: 0.0025,
  lngSpan: 0.0025
};

export const DEFAULT_PROJECT_PREFERENCES = {
  unitSystem: "imperial",
  displayDecimalFeet: false,
  measurementPromptDismissed: false,
  menuPreference: "show-once",
  continuationMode: "continuous",
  wastePercentage: 10
} as const;
