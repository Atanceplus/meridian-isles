import { describe, expect, it } from "vitest";
import { reconcileDays, summarize } from "./production";
import type { DailyReportRow, SaleRow } from "../persistence/types";

const report = (date: string, applicationsSubmitted: number, issuePaid: number | null, calls = 100, hours = 5): DailyReportRow => ({
  id: `r-${date}`,
  instanceId: "i",
  date,
  calls,
  hours,
  applicationsSubmitted,
  issuePaid,
  currency: "USD",
  notes: "",
  activityId: null,
  createdAt: "",
  updatedAt: "",
  source: { kind: "manual" },
});

let s = 0;
const sale = (submittedAt: string, issuePaid: number | null = null): SaleRow => ({
  id: `s${++s}`,
  instanceId: "i",
  submittedAt,
  carrierId: null,
  product: "",
  issuePaid,
  currency: "USD",
  policyRef: "",
  notes: "",
  createdAt: "",
  updatedAt: "",
  source: { kind: "manual" },
});

describe("reconcileDays", () => {
  it("classifies each day without ever adding records to totals", () => {
    const days = reconcileDays(
      [report("2027-01-04", 2, null), report("2027-01-05", 2, 900), report("2027-01-06", 1, null), report("2027-01-07", 3, null)],
      [
        sale("2027-01-05T10:00:00", 400),
        sale("2027-01-05T11:00:00", 500),
        sale("2027-01-06T10:00:00"),
        sale("2027-01-06T10:30:00"),
        sale("2027-01-07T09:00:00"),
        sale("2027-01-08T09:00:00", 300),
      ],
    );
    const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
    expect(days.map((d) => d.date)).toEqual(["2027-01-08", "2027-01-07", "2027-01-06", "2027-01-05", "2027-01-04"]);
    expect(byDate["2027-01-04"]).toMatchObject({ status: "totalsOnly", applications: 2 });
    expect(byDate["2027-01-05"]).toMatchObject({ status: "matched", applications: 2, issuePaid: 900, itemizedIssuePaid: 900 });
    expect(byDate["2027-01-06"]).toMatchObject({ status: "conflict", applications: 1, itemizedCount: 2 });
    expect(byDate["2027-01-07"]).toMatchObject({ status: "partial", applications: 3, itemizedCount: 1 });
    expect(byDate["2027-01-08"]).toMatchObject({ status: "derived", applications: 1, issuePaid: 300, calls: null });
  });

  it("flags Issue Paid that exceeds or doesn't yet match the report", () => {
    const over = reconcileDays([report("2027-01-05", 1, 300)], [sale("2027-01-05T10:00:00", 400)]);
    expect(over[0]).toMatchObject({ status: "conflict" });
    const under = reconcileDays([report("2027-01-05", 1, 500)], [sale("2027-01-05T10:00:00", 400)]);
    expect(under[0]).toMatchObject({ status: "partial" });
    expect(under[0]!.issues[0]).toMatch(/doesn't add up/);
  });
});

describe("summarize", () => {
  it("totals a date range and computes rates from reported days only", () => {
    const days = reconcileDays(
      [report("2027-01-04", 2, 1000, 100, 5), report("2027-01-05", 1, null, 60, 3), report("2026-12-31", 9, 9999)],
      [sale("2027-01-06T10:00:00", 200)],
    );
    const sum = summarize(days, "2027-01-01", "2027-01-31");
    expect(sum).toMatchObject({ days: 3, calls: 160, hours: 8, applications: 4, issuePaid: 1200, issuePaidIncomplete: true });
    expect(sum.callsPerHour).toBe(20);
    expect(sum.salesPerHour).toBe(3 / 8);
    expect(sum.closingRate).toBe(3 / 160);
  });

  it("returns null rates when there are no hours or calls", () => {
    expect(summarize([], "2027-01-01", "2027-01-31")).toMatchObject({ days: 0, callsPerHour: null, closingRate: null });
  });
});
