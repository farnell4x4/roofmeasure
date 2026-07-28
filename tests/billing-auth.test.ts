import { describe, expect, it } from "vitest";
import { generateMagicLinkToken } from "@/lib/billing/auth";

describe("billing auth helpers", () => {
  it("generates non-empty magic-link tokens", () => {
    const first = generateMagicLinkToken();
    const second = generateMagicLinkToken();

    expect(first.length).toBeGreaterThan(20);
    expect(second.length).toBeGreaterThan(20);
    expect(first).not.toBe(second);
  });
});
