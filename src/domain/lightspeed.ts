import { differenceInSeconds, parseISO } from "date-fns";
import { addCalendarMonths, dayKey, type DayKey } from "./calendar";
import type { LightspeedRules } from "./ruleset";

/**
 * Lightspeed evidence: ten sales (applications submitted) inside one continuous
 * 30-minute window, each surviving a 3-calendar-month retention checkpoint
 * that the user explicitly confirms. Missing confirmation is never treated as
 * "no chargeback".
 *
 * This module only judges the evidence. The achievement itself completes when
 * the evidence is complete; Speed's rank-5 gate separately requires the max
 * score and the sustained-effort conditions, so Lightspeed is only "earned"
 * when Speed reaches rank 5.
 */

export interface LightspeedSale {
  id: string;
  /** Application submission time (local ISO date-time). This is the sale. */
  submittedAt: string;
  /** Retention anchor entered by the user (issue / first draft), used when rules say "enteredDate". */
  anchorDate?: DayKey;
  /** The user's self-report, made at or after the checkpoint (a chargeback can be reported any time). */
  retention?: { status: "confirmedOk" | "chargeback"; reportedAt: string };
}

export interface LightspeedAttempt {
  id: string;
  windowStart: string;
  windowEnd: string;
  saleIds: string[];
}

export type CheckpointState = "anchorMissing" | "pending" | "awaiting" | "confirmedOk" | "chargeback";

export interface SaleEvaluation {
  saleId: string;
  inWindow: boolean;
  dueDate: DayKey | null;
  checkpoint: CheckpointState;
}

export type AttemptStatus = "invalid" | "collecting" | "waiting" | "failed" | "evidenceComplete";

export interface AttemptEvaluation {
  status: AttemptStatus;
  issues: string[];
  sales: SaleEvaluation[];
  /** When the last checkpoint was confirmed, if the evidence is complete. */
  evidenceCompleteAt: string | null;
}

export function retentionDueDate(sale: LightspeedSale, rules: LightspeedRules): DayKey | null {
  const anchor = rules.checkpointAnchor === "submission" ? dayKey(sale.submittedAt) : sale.anchorDate;
  return anchor ? addCalendarMonths(anchor, rules.retentionMonths) : null;
}

export function checkpointState(sale: LightspeedSale, rules: LightspeedRules, now: string): { dueDate: DayKey | null; state: CheckpointState } {
  const dueDate = retentionDueDate(sale, rules);
  if (sale.retention?.status === "chargeback") return { dueDate, state: "chargeback" };
  if (dueDate === null) return { dueDate, state: "anchorMissing" };
  if (dayKey(now) < dueDate) return { dueDate, state: "pending" };
  // A confirmation only counts if it was made on or after the checkpoint date.
  if (sale.retention?.status === "confirmedOk" && dayKey(sale.retention.reportedAt) >= dueDate) {
    return { dueDate, state: "confirmedOk" };
  }
  return { dueDate, state: "awaiting" };
}

export function evaluateAttempt(
  attempt: LightspeedAttempt,
  salesById: Record<string, LightspeedSale>,
  rules: LightspeedRules,
  now: string,
): AttemptEvaluation {
  const issues: string[] = [];
  const start = parseISO(attempt.windowStart);
  const end = parseISO(attempt.windowEnd);
  const windowSeconds = differenceInSeconds(end, start);

  if (windowSeconds < 0) issues.push("The window ends before it starts.");
  if (windowSeconds > rules.windowMinutes * 60) {
    issues.push(`The window is longer than ${rules.windowMinutes} minutes.`);
  }

  const seen = new Set<string>();
  const sales: SaleEvaluation[] = [];
  for (const saleId of attempt.saleIds) {
    if (seen.has(saleId)) {
      issues.push(`Sale "${saleId}" is listed more than once.`);
      continue;
    }
    seen.add(saleId);
    const sale = salesById[saleId];
    if (!sale) {
      issues.push(`Sale "${saleId}" does not exist.`);
      continue;
    }
    const t = parseISO(sale.submittedAt);
    const inWindow = t >= start && t <= end;
    if (!inWindow) issues.push(`Sale "${saleId}" was submitted outside this attempt's window.`);
    const { dueDate, state } = checkpointState(sale, rules, now);
    sales.push({ saleId, inWindow, dueDate, checkpoint: state });
  }
  if (sales.length > rules.salesRequired) issues.push(`An attempt holds exactly ${rules.salesRequired} sales.`);

  const base = { issues, sales, evidenceCompleteAt: null };
  if (issues.length > 0) return { status: "invalid", ...base };
  if (sales.some((s) => s.checkpoint === "chargeback")) return { status: "failed", ...base };
  if (sales.length < rules.salesRequired) return { status: "collecting", ...base };
  if (sales.every((s) => s.checkpoint === "confirmedOk")) {
    const evidenceCompleteAt = attempt.saleIds
      .map((id) => salesById[id]!.retention!.reportedAt)
      .reduce((a, b) => (a > b ? a : b));
    return { status: "evidenceComplete", issues, sales, evidenceCompleteAt };
  }
  return { status: "waiting", ...base };
}

/**
 * A sale may belong to only one attempt. Failed attempts keep their history
 * and keep holding their sales, unless substitution is enabled; then their
 * sales are released for a new attempt (whose own window rule still applies).
 */
export function findSaleConflicts(
  attempts: LightspeedAttempt[],
  statusById: Record<string, AttemptStatus>,
  rules: LightspeedRules,
): { saleId: string; attemptIds: string[] }[] {
  const owners = new Map<string, string[]>();
  for (const attempt of attempts) {
    if (rules.allowSubstitutionFromSameWindow && statusById[attempt.id] === "failed") continue;
    for (const saleId of new Set(attempt.saleIds)) {
      owners.set(saleId, [...(owners.get(saleId) ?? []), attempt.id]);
    }
  }
  return [...owners.entries()].filter(([, ids]) => ids.length > 1).map(([saleId, attemptIds]) => ({ saleId, attemptIds }));
}
