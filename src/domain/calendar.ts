import { differenceInCalendarDays, format, parseISO, startOfWeek } from "date-fns";

/** A local calendar date, "yyyy-MM-dd". */
export type DayKey = string;
export type WeekStartsOn = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Local calendar day of an ISO date or date-time. Strings without an offset are read as local time. */
export function dayKey(iso: string): DayKey {
  return format(parseISO(iso), "yyyy-MM-dd");
}

/** The first day of the week containing `iso`; used as the week's key. */
export function weekKey(iso: string, weekStartsOn: WeekStartsOn): DayKey {
  return format(startOfWeek(parseISO(iso), { weekStartsOn }), "yyyy-MM-dd");
}

/** Whole calendar days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return differenceInCalendarDays(parseISO(to), parseISO(from));
}

export function daysInMonth(year: number, month: number): number {
  // Day 0 of the following month is the last day of `month` (1-12).
  return new Date(year, month, 0).getDate();
}

/**
 * Add calendar months to a date, keeping the day of month. When the target
 * month is shorter, the result is that month's last day:
 * Jan 31 + 3 → Apr 30, Nov 30 + 3 → Feb 28 (Feb 29 in leap years).
 * This is deliberately not "90 days".
 */
export function addCalendarMonths(day: DayKey, months: number): DayKey {
  const match = DAY_RE.exec(day);
  if (!match) throw new Error(`Expected a yyyy-MM-dd date, got "${day}"`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const dom = Number(match[3]);

  const monthIndex = year * 12 + (month - 1) + months;
  const newYear = Math.floor(monthIndex / 12);
  const newMonth = monthIndex - newYear * 12 + 1;
  const newDom = Math.min(dom, daysInMonth(newYear, newMonth));

  return `${String(newYear).padStart(4, "0")}-${String(newMonth).padStart(2, "0")}-${String(newDom).padStart(2, "0")}`;
}
