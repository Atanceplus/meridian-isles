import { dayKey } from "../domain/calendar";
import type { DailyReportRow, SaleRow } from "../persistence/types";

/**
 * Production reporting. The daily report is the authoritative total for its
 * date; itemized sales are a subset of it. The two are reconciled, never added.
 */

export type ReconciliationStatus =
  | "totalsOnly" // a report, no itemized sales (normal)
  | "matched" // itemized sales account for the whole report
  | "partial" // fewer itemized sales than reported (normal)
  | "conflict" // itemized sales exceed the report: one of them needs fixing
  | "derived"; // itemized sales, no report: totals come from the sales

export interface DayProduction {
  date: string;
  calls: number | null;
  hours: number | null;
  applications: number;
  issuePaid: number | null;
  itemizedCount: number;
  itemizedIssuePaid: number | null;
  status: ReconciliationStatus;
  issues: string[];
  report: DailyReportRow | null;
  sales: SaleRow[];
}

const CENT = 0.005;

export function reconcileDays(reports: DailyReportRow[], sales: SaleRow[]): DayProduction[] {
  const salesByDate = new Map<string, SaleRow[]>();
  for (const sale of sales) {
    const date = dayKey(sale.submittedAt);
    salesByDate.set(date, [...(salesByDate.get(date) ?? []), sale]);
  }
  const reportByDate = new Map(reports.map((r) => [r.date, r]));
  const dates = [...new Set([...reportByDate.keys(), ...salesByDate.keys()])].sort().reverse();

  return dates.map((date) => {
    const report = reportByDate.get(date) ?? null;
    const daySales = (salesByDate.get(date) ?? []).sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : 1));
    const itemizedIssuePaid = sumKnown(daySales.map((s) => s.issuePaid));
    const issues: string[] = [];

    if (!report) {
      return {
        date,
        calls: null,
        hours: null,
        applications: daySales.length,
        issuePaid: itemizedIssuePaid,
        itemizedCount: daySales.length,
        itemizedIssuePaid,
        status: "derived",
        issues: ["No daily report: totals are derived from itemized sales."],
        report,
        sales: daySales,
      };
    }

    let status: ReconciliationStatus = "totalsOnly";
    if (daySales.length > 0) {
      status = daySales.length === report.applicationsSubmitted ? "matched" : daySales.length < report.applicationsSubmitted ? "partial" : "conflict";
      if (status === "conflict") {
        issues.push(`${daySales.length} sales are itemized but the report says ${report.applicationsSubmitted}. Raise the report's total or fix the sales.`);
      }
      if (report.issuePaid !== null && itemizedIssuePaid !== null && itemizedIssuePaid > report.issuePaid + CENT) {
        status = "conflict";
        issues.push("Itemized Issue Paid is more than the report's Issue Paid.");
      } else if (status === "matched" && report.issuePaid !== null && itemizedIssuePaid !== null && Math.abs(itemizedIssuePaid - report.issuePaid) > CENT) {
        status = "partial";
        issues.push("Every sale is itemized, but itemized Issue Paid doesn't add up to the report yet.");
      }
    }

    return {
      date,
      calls: report.calls,
      hours: report.hours,
      applications: report.applicationsSubmitted,
      issuePaid: report.issuePaid,
      itemizedCount: daySales.length,
      itemizedIssuePaid,
      status,
      issues,
      report,
      sales: daySales,
    };
  });
}

export interface ProductionSummary {
  days: number;
  calls: number;
  hours: number;
  applications: number;
  issuePaid: number;
  /** True when some days in the range have no Issue Paid figure yet. */
  issuePaidIncomplete: boolean;
  callsPerHour: number | null;
  salesPerHour: number | null;
  /** Applications per call, from days that have call counts. */
  closingRate: number | null;
}

/** Totals for days within [from, to] (inclusive, yyyy-MM-dd). Rates only use days that report calls and hours. */
export function summarize(days: DayProduction[], from: string, to: string): ProductionSummary {
  const inRange = days.filter((d) => d.date >= from && d.date <= to);
  const reported = inRange.filter((d) => d.calls !== null && d.hours !== null);
  const calls = reported.reduce((a, d) => a + d.calls!, 0);
  const hours = reported.reduce((a, d) => a + d.hours!, 0);
  const reportedApps = reported.reduce((a, d) => a + d.applications, 0);
  return {
    days: inRange.length,
    calls,
    hours,
    applications: inRange.reduce((a, d) => a + d.applications, 0),
    issuePaid: inRange.reduce((a, d) => a + (d.issuePaid ?? 0), 0),
    issuePaidIncomplete: inRange.some((d) => d.applications > 0 && d.issuePaid === null),
    callsPerHour: hours > 0 ? calls / hours : null,
    salesPerHour: hours > 0 ? reportedApps / hours : null,
    closingRate: calls > 0 ? reportedApps / calls : null,
  };
}

function sumKnown(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length > 0 ? known.reduce((a, b) => a + b, 0) : null;
}
