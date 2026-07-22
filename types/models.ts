export const SCHEMA_VERSION = 1;

export type MeasurementType = "eave" | "valley" | "rake" | "hip" | "ridge";
export type UnitSystem = "imperial" | "metric";
export type PitchMode = "single" | "multiple";
export type MeasureContinuationMode = "continuous" | "new-line";
export type SaveState = "idle" | "saving" | "saved" | "offline" | "recovery";

export type GeographicPoint = {
  id: string;
  lat: number;
  lng: number;
};

export type EditableMeasurementPoint = {
  latitude: number;
  longitude: number;
};

export type EditableMeasurementSegment = {
  id: string;
  start: EditableMeasurementPoint;
  end: EditableMeasurementPoint;
};

export type SavedMeasurementGeometry = {
  segments: EditableMeasurementSegment[];
  pendingLineStart: EditableMeasurementPoint | null;
};

export type MeasurementSegment = {
  id: string;
  type: MeasurementType;
  startPointId: string;
  endPointId: string;
  lengthFeet: number;
  groupId: string;
  createdAt: string;
  updatedAt: string;
};

export type MeasurementGroup = {
  id: string;
  name: string;
  type: MeasurementType;
  segmentIds: string[];
  continuationMode: MeasureContinuationMode;
  createdAt: string;
};

export type RoofPlane = {
  id: string;
  name: string;
  pointIds: string[];
  pitch?: string;
  planAreaSqFt: number;
  slopeAreaSqFt?: number;
  source: "auto" | "manual";
};

export type PropertyLocation = {
  formattedAddress: string;
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  latitude: number;
  longitude: number;
};

export type ProjectPreferences = {
  unitSystem: UnitSystem;
  displayDecimalFeet: boolean;
  measurementPromptDismissed: boolean;
  menuPreference: "show-once" | "always" | "never";
  continuationMode: MeasureContinuationMode;
  wastePercentage: number;
};

export type ReportSettings = {
  showMeasurementTypes: MeasurementType[];
  notes: string;
  includeWaste: boolean;
};

export type Project = {
  id: string;
  schemaVersion: number;
  name: string;
  location?: PropertyLocation;
  mapCamera?: MapCameraState;
  measurementGeometry?: SavedMeasurementGeometry;
  points: GeographicPoint[];
  segments: MeasurementSegment[];
  groups: MeasurementGroup[];
  planes: RoofPlane[];
  pitchMode: PitchMode;
  singlePitch?: string;
  reportSettings: ReportSettings;
  preferences: ProjectPreferences;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
};

export type MapCameraState = {
  centerLat: number;
  centerLng: number;
  latSpan: number;
  lngSpan: number;
  altitude?: number;
};

export type AppPreferences = {
  unitSystem: UnitSystem;
  displayDecimalFeet: boolean;
  darkMode: "system" | "light" | "dark";
};

export type ProjectCalculations = {
  totals: Record<MeasurementType, number>;
  totalPlanAreaSqFt: number;
  totalSlopeAreaSqFt: number;
  totalSquares: number;
  planeCount: number;
  segmentCount: number;
};
