import { Project, SCHEMA_VERSION } from "@/types/models";

export function serializeProject(project: Project) {
  return JSON.stringify(project, null, 2);
}

export function deserializeProject(source: string): Project {
  const parsed = JSON.parse(source) as Project;
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    return {
      ...parsed,
      schemaVersion: SCHEMA_VERSION
    };
  }
  return parsed;
}
