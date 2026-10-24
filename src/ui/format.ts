import { format, parseISO } from "date-fns";
import type { ContentRegistry } from "../content";
import type { AwardLine } from "../domain";

export function fmtXp(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return rounded.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export function fmtSigned(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtXp(Math.abs(n))}`;
}

export function fmtMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function fmtDate(day: string): string {
  return format(parseISO(day), "EEE, MMM d, yyyy");
}

export function fmtDateTime(iso: string): string {
  return format(parseISO(iso), "MMM d, yyyy · h:mm a");
}

export function fmtPercent(n: number | null, digits = 0): string {
  return n === null ? "—" : `${(n * 100).toFixed(digits)}%`;
}

export function fmtRate(n: number | null, digits = 1): string {
  return n === null ? "—" : n.toFixed(digits);
}

/** Value for a datetime-local input. */
export function toInputDateTime(iso: string): string {
  return iso.slice(0, 16);
}

/** XP that changed a skill's score (gains and reversals), per skill. */
export function netBySkill(lines: AwardLine[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines) {
    if (l.status === "awarded" || l.status === "reduced" || l.status === "reversed") {
      out.set(l.skillId, (out.get(l.skillId) ?? 0) + l.amount);
    }
  }
  return out;
}

export const STATUS_LABEL: Record<AwardLine["status"], string> = {
  awarded: "Earned",
  reduced: "Earned (reduced)",
  legacy: "Legacy",
  "blocked:limit": "Over limit",
  "blocked:cap": "Blocked by cap",
  "ineligible:backdated": "Too late to count",
  reversed: "Removed",
};

export function skillName(registry: ContentRegistry, id: string): string {
  return registry.skillById[id]?.name ?? id;
}

export function rankName(registry: ContentRegistry, skillId: string, rank: number): string {
  return registry.skillById[skillId]?.ranks[rank - 1]?.name ?? `Rank ${rank}`;
}
