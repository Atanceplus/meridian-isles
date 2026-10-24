import { differenceInSeconds, parseISO } from "date-fns";
import { evaluateAttempt, findSaleConflicts, retentionDueDate, type AttemptEvaluation } from "../domain";
import type { LightspeedAttemptRow, SaleRow } from "../persistence/types";
import { LIGHTSPEED_ID, lightspeedSales } from "./achievements";
import type { CommandResult, CommandService, Transaction } from "./commands";
import { ValidationError } from "./errors";

/**
 * Lightspeed tracker. An attempt is up to ten itemized sales inside one
 * continuous window. Each sale's retention checkpoint must be confirmed by you
 * on or after its date; a chargeback fails that attempt (its history is kept).
 * When an attempt's evidence completes, the Lightspeed achievement is recorded;
 * Speed's rank-5 gate still requires the max score and the sustained-effort conditions.
 */

const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

export class LightspeedCommands {
  constructor(private svc: CommandService) {}

  async createAttempt(instanceId: string, input: { saleIds: string[]; windowStart?: string; windowEnd?: string; notes?: string }): Promise<LightspeedAttemptRow> {
    const tx = await this.svc.begin(instanceId);
    const sales = input.saleIds.map((id) => tx.bundle.sales.find((s) => s.id === id));
    if (sales.some((s) => !s)) throw new ValidationError(["One of those sales no longer exists."]);
    const times = (sales as SaleRow[]).map((s) => s.submittedAt).sort();
    const attempt: LightspeedAttemptRow = {
      id: tx.id(),
      instanceId,
      windowStart: normalize(input.windowStart) ?? times[0] ?? "",
      windowEnd: normalize(input.windowEnd) ?? times[times.length - 1] ?? "",
      saleIds: input.saleIds,
      notes: (input.notes ?? "").trim(),
      createdAt: tx.at,
      achievementRecordedAt: null,
      history: [{ at: tx.at, text: `Attempt started with ${input.saleIds.length} sale${input.saleIds.length === 1 ? "" : "s"}.` }],
    };
    this.validate(tx, attempt);
    tx.rows("lightspeedAttempts").push(attempt);
    tx.audit("lightspeed.create", attempt.id, "Started a Lightspeed attempt", undefined, attempt);
    await tx.commit();
    return attempt;
  }

  /** Change the sales in an attempt that is still collecting (fewer than ten, nothing confirmed yet). */
  async updateAttemptSales(instanceId: string, attemptId: string, saleIds: string[]): Promise<LightspeedAttemptRow> {
    const tx = await this.svc.begin(instanceId);
    const existing = tx.bundle.lightspeedAttempts.find((a) => a.id === attemptId);
    if (!existing) throw new ValidationError(["That attempt no longer exists."]);
    if (this.evaluate(tx, existing).status !== "collecting") throw new ValidationError(["Only an attempt that is still collecting sales can change its sales."]);
    const times = saleIds.map((id) => tx.bundle.sales.find((s) => s.id === id)?.submittedAt ?? "").sort();
    const attempt: LightspeedAttemptRow = {
      ...existing,
      saleIds,
      windowStart: times[0] ?? existing.windowStart,
      windowEnd: times[times.length - 1] ?? existing.windowEnd,
      history: [...existing.history, { at: tx.at, text: `Sales updated (${saleIds.length}).` }],
    };
    this.validate(tx, attempt);
    tx.rows("lightspeedAttempts").push(attempt);
    tx.audit("lightspeed.update", attemptId, "Updated a Lightspeed attempt's sales", existing, attempt);
    await tx.commit();
    return attempt;
  }

  /** Remove an attempt that is still collecting. Attempts with confirmations or a failure keep their history. */
  async deleteAttempt(instanceId: string, attemptId: string): Promise<void> {
    const tx = await this.svc.begin(instanceId);
    const attempt = tx.bundle.lightspeedAttempts.find((a) => a.id === attemptId);
    if (!attempt) throw new ValidationError(["That attempt no longer exists."]);
    const status = this.evaluate(tx, attempt).status;
    if (status !== "collecting" && status !== "invalid") throw new ValidationError(["Attempts waiting on checkpoints, failed or complete keep their history."]);
    tx.remove("lightspeedAttempts", attemptId);
    tx.audit("lightspeed.delete", attemptId, "Deleted a Lightspeed attempt", attempt);
    await tx.commit();
  }

  /**
   * Record a sale's retention result. "No chargeback" can only be confirmed on
   * or after the checkpoint date; a chargeback can be reported at any time.
   */
  async confirmRetention(instanceId: string, saleId: string, status: "confirmedOk" | "chargeback"): Promise<CommandResult> {
    const tx = await this.svc.begin(instanceId);
    const sale = tx.bundle.sales.find((s) => s.id === saleId);
    if (!sale) throw new ValidationError(["That sale no longer exists."]);
    if (sale.retention?.status === "chargeback") throw new ValidationError(["A chargeback is already recorded for this sale."]);
    if (status === "confirmedOk") {
      const due = retentionDueDate({ id: sale.id, submittedAt: sale.submittedAt, ...(sale.anchorDate ? { anchorDate: sale.anchorDate } : {}) }, tx.ruleset.lightspeed);
      if (!due) throw new ValidationError(["Enter this sale's anchor date first."]);
      if (tx.at.slice(0, 10) < due) throw new ValidationError([`This sale's checkpoint is ${due}. Confirm it on or after that date.`]);
    }
    tx.rows("sales").push({ ...sale, retention: { status, reportedAt: tx.at }, updatedAt: tx.at });
    tx.audit("sale.retention", saleId, status === "chargeback" ? "Reported a chargeback" : "Confirmed no chargeback at the checkpoint");
    this.afterRetentionChange(tx, saleId, status === "chargeback" ? "Chargeback reported" : "Checkpoint confirmed");
    await tx.commit();
    return { lines: tx.lines, promotions: tx.promotions };
  }

  /** Undo a mistaken retention entry, unless it already completed a recorded Lightspeed. */
  async clearRetention(instanceId: string, saleId: string): Promise<void> {
    const tx = await this.svc.begin(instanceId);
    const sale = tx.bundle.sales.find((s) => s.id === saleId);
    if (!sale?.retention) throw new ValidationError(["Nothing to undo for this sale."]);
    if (tx.bundle.lightspeedAttempts.some((a) => a.saleIds.includes(saleId) && a.achievementRecordedAt)) {
      throw new ValidationError(["This sale is part of a recorded Lightspeed, so its checkpoint can't be changed."]);
    }
    tx.rows("sales").push({ ...sale, retention: null, updatedAt: tx.at });
    tx.audit("sale.retention.clear", saleId, "Cleared a retention entry", sale.retention);
    this.afterRetentionChange(tx, saleId, "Checkpoint entry cleared");
    await tx.commit();
  }

  evaluate(tx: Transaction, attempt: LightspeedAttemptRow): AttemptEvaluation {
    return evaluateAttempt(attempt, lightspeedSales(tx.merged().sales), tx.ruleset.lightspeed, tx.at);
  }

  private validate(tx: Transaction, attempt: LightspeedAttemptRow): void {
    const errors: string[] = [];
    if (attempt.saleIds.length === 0) errors.push("Choose at least one sale.");
    if (!DATETIME_RE.test(attempt.windowStart) || !DATETIME_RE.test(attempt.windowEnd)) errors.push("Enter the session's start and end.");
    else if (differenceInSeconds(parseISO(attempt.windowEnd), parseISO(attempt.windowStart)) > tx.ruleset.lightspeed.windowMinutes * 60) {
      errors.push(`The session is longer than ${tx.ruleset.lightspeed.windowMinutes} minutes. Sales from separate windows can't be combined.`);
    }
    const evaluation = this.evaluate(tx, attempt);
    errors.push(...evaluation.issues);
    const others = tx.merged().lightspeedAttempts.filter((a) => a.id !== attempt.id);
    const statuses = Object.fromEntries(others.map((a) => [a.id, this.evaluate(tx, a).status]));
    const conflicts = findSaleConflicts([...others, attempt], { ...statuses, [attempt.id]: evaluation.status }, tx.ruleset.lightspeed).filter((c) => c.attemptIds.includes(attempt.id));
    if (conflicts.length) errors.push(`${conflicts.length} of these sales already belong to another attempt.`);
    if (errors.length) throw new ValidationError([...new Set(errors)]);
  }

  /** Note the change on each affected attempt, and record Lightspeed if an attempt's evidence just completed. */
  private afterRetentionChange(tx: Transaction, saleId: string, text: string): void {
    for (const attempt of tx.bundle.lightspeedAttempts.filter((a) => a.saleIds.includes(saleId))) {
      const evaluation = this.evaluate(tx, attempt);
      const history = [...attempt.history, { at: tx.at, text }];
      if (evaluation.status === "failed") history.push({ at: tx.at, text: "Attempt ineligible: a policy was charged back." });
      let achievementRecordedAt = attempt.achievementRecordedAt;
      if (evaluation.status === "evidenceComplete" && !achievementRecordedAt && tx.state.achievements[LIGHTSPEED_ID] === undefined) {
        tx.achievement(LIGHTSPEED_ID);
        tx.achievementRows.push({
          id: `${tx.bundle.instance.id}|${LIGHTSPEED_ID}`,
          instanceId: tx.bundle.instance.id,
          achievementId: LIGHTSPEED_ID,
          completedAt: tx.at,
          evidenceNote: `Attempt ${attempt.windowStart} – ${attempt.windowEnd}: all ${attempt.saleIds.length} checkpoints confirmed.`,
          evidence: [{ text: "Confirmed checkpoints", current: attempt.saleIds.length, required: tx.ruleset.lightspeed.salesRequired }],
        });
        achievementRecordedAt = tx.at;
        history.push({ at: tx.at, text: "Evidence complete: Lightspeed achievement recorded." });
      }
      tx.rows("lightspeedAttempts").push({ ...attempt, history, achievementRecordedAt });
    }
  }
}

function normalize(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.length === 16 ? `${value}:00` : value;
}
