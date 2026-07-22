import { describe, expect, it } from "vitest"
import { workersDevRedirectUrl } from "@/lib/routing/canonical-host"

describe("workers.dev canonical host redirect", () => {
  it("redirects every workers.dev path and query to the canonical domain", () => {
    expect(workersDevRedirectUrl("https://roofmeasure.example.workers.dev/projects?sort=recent"))
      .toBe("https://rooftapemeasure.com/projects?sort=recent")
  })

  it("does not redirect the canonical domain", () => {
    expect(workersDevRedirectUrl("https://rooftapemeasure.com/image?new=1")).toBeNull()
  })
})
