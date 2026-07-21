import { DEFAULT_CAMERA, DEFAULT_PROJECT_PREFERENCES } from "@/lib/measurement/constants";
import { generateId, nowIso } from "@/lib/utils";
import { Project, SCHEMA_VERSION } from "@/types/models";

export function createEmptyProject(name: string): Project {
  const timestamp = nowIso();
  return {
    id: generateId("project"),
    schemaVersion: SCHEMA_VERSION,
    name,
    mapCamera: DEFAULT_CAMERA,
    points: [],
    segments: [],
    groups: [],
    planes: [],
    pitchMode: "single",
    singlePitch: "6/12",
    reportSettings: {
      showMeasurementTypes: ["eave", "valley", "rake", "hip", "ridge"],
      notes: "",
      includeWaste: true
    },
    preferences: {
      ...DEFAULT_PROJECT_PREFERENCES
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    lastOpenedAt: timestamp
  };
}
