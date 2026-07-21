import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@/lib/projects/project-factory";
import { deserializeProject, serializeProject } from "@/lib/projects/serialization";

describe("serialization", () => {
  it("serializes and deserializes a project", () => {
    const project = createEmptyProject("Roof 1");
    const payload = serializeProject(project);
    expect(deserializeProject(payload).name).toBe("Roof 1");
  });
});
