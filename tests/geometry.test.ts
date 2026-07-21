import { describe, expect, it } from "vitest";
import { haversineDistanceFeet, pitchFactor, polygonAreaSqFt, slopeAdjustedAreaSqFt } from "@/lib/measurement/geometry";

describe("geometry helpers", () => {
  it("calculates haversine distance in feet", () => {
    const distance = haversineDistanceFeet(
      { lat: 39.7392, lng: -104.9903 },
      { lat: 39.7393, lng: -104.9903 }
    );
    expect(distance).toBeGreaterThan(30);
    expect(distance).toBeLessThan(40);
  });

  it("calculates polygon area in square feet", () => {
    const area = polygonAreaSqFt([
      { lat: 39.7392, lng: -104.9903 },
      { lat: 39.7392, lng: -104.9901 },
      { lat: 39.73935, lng: -104.9901 },
      { lat: 39.73935, lng: -104.9903 }
    ]);
    expect(area).toBeGreaterThan(2500);
  });

  it("calculates pitch factors and slope-adjusted area", () => {
    expect(pitchFactor("6/12")).toBeCloseTo(1.118, 2);
    expect(slopeAdjustedAreaSqFt(1000, "6/12")).toBeCloseTo(1118, 0);
  });
});
