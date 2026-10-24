import { describe, expect, it } from "vitest";
import { carrierLevel, categoryLevel, type CategoryEvidence } from "./carrierLevels";
import { registry } from "../test/helpers";

const levels = registry.seeds.categoryLevels;
const today = "2027-06-01";

const evidence = (overrides: Partial<CategoryEvidence> = {}): CategoryEvidence => ({
  applicable: true,
  creditedMinutes: 0,
  summaryWritten: false,
  checklistItems: 0,
  checklistDone: 0,
  lastReviewedOn: null,
  explainedWithoutNotes: false,
  resourceCount: 0,
  ...overrides,
});

describe("categoryLevel", () => {
  it("starts Uncharted", () => {
    expect(categoryLevel(evidence(), levels, today)).toBe(0);
  });

  it("needs minutes AND the written evidence for each level", () => {
    expect(categoryLevel(evidence({ creditedMinutes: 600 }), levels, today)).toBe(0); // no summary
    expect(categoryLevel(evidence({ creditedMinutes: 30, summaryWritten: true }), levels, today)).toBe(1);
    expect(categoryLevel(evidence({ creditedMinutes: 120, summaryWritten: true, checklistItems: 3 }), levels, today)).toBe(2);
  });

  it("requires a recent review for Fluent", () => {
    const base = { creditedMinutes: 300, summaryWritten: true, checklistItems: 3, checklistDone: 3 };
    expect(categoryLevel(evidence({ ...base, lastReviewedOn: "2027-04-01" }), levels, today)).toBe(3);
    expect(categoryLevel(evidence({ ...base, lastReviewedOn: "2027-01-01" }), levels, today)).toBe(2);
  });

  it("reaches Mastered with everything in place", () => {
    const e = evidence({
      creditedMinutes: 540,
      summaryWritten: true,
      checklistItems: 4,
      checklistDone: 4,
      lastReviewedOn: "2027-05-20",
      explainedWithoutNotes: true,
      resourceCount: 2,
    });
    expect(categoryLevel(e, levels, today)).toBe(4);
  });
});

describe("carrierLevel", () => {
  it("is the weakest applicable category, so one heavy subject can't carry a carrier", () => {
    const mastered = evidence({
      creditedMinutes: 2000,
      summaryWritten: true,
      checklistItems: 3,
      checklistDone: 3,
      lastReviewedOn: today,
      explainedWithoutNotes: true,
      resourceCount: 1,
    });
    expect(carrierLevel([mastered, evidence()], levels, today)).toBe(0);
  });

  it("ignores categories marked not applicable", () => {
    const surveyed = evidence({ creditedMinutes: 30, summaryWritten: true });
    expect(carrierLevel([surveyed, evidence({ applicable: false })], levels, today)).toBe(1);
    expect(carrierLevel([evidence({ applicable: false })], levels, today)).toBe(0);
  });
});
