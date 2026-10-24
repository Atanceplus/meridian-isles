import { format } from "date-fns";

/** Local ISO date-time without offset, the format every record uses. */
export function nowLocal(): string {
  return format(new Date(), "yyyy-MM-dd'T'HH:mm:ss");
}

export function todayLocal(): string {
  return format(new Date(), "yyyy-MM-dd");
}

/** The later of two local ISO strings (same format, so string order is time order). */
export function laterOf(a: string, b: string | null): string {
  return b !== null && b > a ? b : a;
}
