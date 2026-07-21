import { describe, expect, it } from "vitest";
import { feetToMeters, formatArea, formatLength } from "@/lib/measurement/units";

describe("unit formatting", () => {
  it("converts feet to meters", () => {
    expect(feetToMeters(10)).toBeCloseTo(3.048, 3);
  });

  it("formats imperial length", () => {
    expect(formatLength(10.5, "imperial", false)).toBe(`10' 6"`);
  });

  it("formats areas", () => {
    expect(formatArea(100, "metric")).toContain("m²");
  });
});
