import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@/lib/project-factory";
import { deserializeProject, serializeProject } from "@/lib/serialization";

describe("serialization", () => {
  it("serializes and deserializes a project", () => {
    const project = createEmptyProject("Roof 1");
    const payload = serializeProject(project);
    expect(deserializeProject(payload).name).toBe("Roof 1");
  });
});
