import { describe, expect, it } from "vitest";
import { addCalendarMonths, dayKey, daysBetween, weekKey } from "./calendar";

describe("addCalendarMonths", () => {
  it.each([
    ["2027-01-15", 3, "2027-04-15"],
    ["2027-01-31", 3, "2027-04-30"], // April has 30 days
    ["2027-08-31", 3, "2027-11-30"],
    ["2026-11-30", 3, "2027-02-28"], // non-leap February
    ["2027-11-30", 3, "2028-02-29"], // leap February
    ["2027-11-29", 3, "2028-02-29"],
    ["2027-10-31", 3, "2028-01-31"], // year wrap keeps the day
    ["2027-12-15", 3, "2028-03-15"],
    ["2027-05-31", -3, "2027-02-28"],
    ["2027-03-31", 0, "2027-03-31"],
  ])("%s + %i months = %s", (from, months, expected) => {
    expect(addCalendarMonths(from, months)).toBe(expected);
  });

  it("is not the same as adding 90 days", () => {
    // Jan 1 + 90 days is Apr 1; three calendar months is also Apr 1, but Feb 1 differs:
    expect(addCalendarMonths("2027-02-01", 3)).toBe("2027-05-01"); // 89 days later
  });

  it("rejects non-date input", () => {
    expect(() => addCalendarMonths("2027-1-5", 3)).toThrow();
  });
});

describe("day and week keys", () => {
  it("reads local date-times as local days", () => {
    expect(dayKey("2027-03-14T23:59:00")).toBe("2027-03-14");
  });

  it("keys weeks by their first day (Monday by default)", () => {
    expect(weekKey("2027-03-14T12:00:00", 1)).toBe("2027-03-08"); // Sunday belongs to the week starting Mon 8th
    expect(weekKey("2027-03-15T00:00:00", 1)).toBe("2027-03-15");
    expect(weekKey("2027-03-14T12:00:00", 0)).toBe("2027-03-14"); // Sunday-start weeks
  });

  it("counts calendar days", () => {
    expect(daysBetween("2027-01-01", "2028-01-01")).toBe(365);
    expect(daysBetween("2028-01-01", "2029-01-01")).toBe(366);
  });
});
