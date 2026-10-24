import { describe, expect, it } from "vitest";
import { creditThroughTiers } from "./tiers";

const t = (fullUpTo: number, reducedUpTo: number, reducedRate = 0.5) => ({ fullUpTo, reducedUpTo, reducedRate });

describe("creditThroughTiers", () => {
  it("credits fully inside the full band", () => {
    expect(creditThroughTiers(30, [{ tier: t(60, 120), used: 0 }])).toBe(30);
  });

  it("applies the reduced band and then zero", () => {
    // 60 full + 60 × 0.5 + 30 × 0
    expect(creditThroughTiers(150, [{ tier: t(60, 120), used: 0 }])).toBe(90);
  });

  it("respects prior usage", () => {
    expect(creditThroughTiers(30, [{ tier: t(60, 120), used: 45 }])).toBe(15 + 7.5);
    expect(creditThroughTiers(30, [{ tier: t(60, 120), used: 200 }])).toBe(0);
  });

  it("multiplies overlapping tiers so the strictest wins", () => {
    // Subject: 10 full, then 0. Overall: 5 used of 8 full, then half to 12.
    // Units 1-3: 1×1, units 4-7: 1×0.5, units 8-10: 1×0 (overall exhausted at 12), 11-12: 0
    const credited = creditThroughTiers(12, [
      { tier: t(10, 10), used: 0 },
      { tier: t(8, 12), used: 5 },
    ]);
    expect(credited).toBe(3 + 4 * 0.5);
  });

  it("returns 0 for non-positive amounts", () => {
    expect(creditThroughTiers(0, [])).toBe(0);
    expect(creditThroughTiers(-5, [])).toBe(0);
  });
});
