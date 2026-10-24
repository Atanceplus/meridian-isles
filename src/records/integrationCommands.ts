import { PAYLOAD_SCHEMAS, envelopeSchema, payloadHash, type DailyReportPayload, type SalePayload } from "../integrations/contracts";
import { SUBMISSION_CATEGORIES, type IntegrationSourceRow, type Permission, type SubmissionCategory, type SubmissionRow } from "../persistence/types";
import type { CommandResult, CommandService } from "./commands";
import { ValidationError } from "./errors";

/**
 * Submissions from outside sources (Grokbot today; banks, APIs or MCP later).
 *
 * - A source can't do anything until you grant it a permission per category.
 * - "Submit for approval" puts it in the inbox; nothing changes until you approve.
 * - "Automatic" applies at once, and only exists if you turn it on.
 * - Delivery is idempotent: the same (source, external id) is never applied twice,
 *   and a changed payload under an id already accepted is refused. Refused
 *   deliveries can be retried.
 * - Approval writes through the ordinary commands, so progress is awarded once,
 *   exactly as if you had entered it yourself, with the source recorded.
 */

export interface ReceiveResult {
  submission: SubmissionRow;
  outcome: "pending" | "applied" | "duplicate" | "refused";
}

export class IntegrationCommands {
  constructor(private svc: CommandService) {}

  async addSource(instanceId: string, input: { name: string; adapter: string }): Promise<IntegrationSourceRow> {
    const tx = await this.svc.begin(instanceId);
    const name = input.name.trim();
    if (!name || name.length > 60) throw new ValidationError(["Give the source a name under 60 characters."]);
    const row: IntegrationSourceRow = {
      id: tx.id(),
      instanceId,
      name,
      adapter: input.adapter,
      // Every new source starts with no access.
      permissions: Object.fromEntries(SUBMISSION_CATEGORIES.map((c) => [c, "none"])) as Record<SubmissionCategory, Permission>,
      enabled: true,
      createdAt: tx.at,
      updatedAt: tx.at,
      lastReceivedAt: null,
    };
    tx.rows("integrationSources").push(row);
    tx.audit("integration.add", row.id, `Added source "${name}" with no access`);
    await tx.commit();
    return row;
  }

  /** Change one permission. Automatic acceptance has to be confirmed explicitly. */
  async setPermission(instanceId: string, sourceId: string, category: SubmissionCategory, permission: Permission, opts: { confirmAutoAccept?: boolean } = {}): Promise<IntegrationSourceRow> {
    const tx = await this.svc.begin(instanceId);
    const source = tx.bundle.integrationSources.find((s) => s.id === sourceId);
    if (!source) throw new ValidationError(["That source no longer exists."]);
    if (!SUBMISSION_CATEGORIES.includes(category)) throw new ValidationError(["Unknown category."]);
    if (permission === "autoAccept" && !opts.confirmAutoAccept) {
      throw new ValidationError(["Automatic acceptance changes your records without review. Confirm it to turn it on."]);
    }
    const row = { ...source, permissions: { ...source.permissions, [category]: permission }, updatedAt: tx.at };
    tx.rows("integrationSources").push(row);
    tx.audit("integration.permission", sourceId, `${source.name}: ${category} → ${permission}`, source.permissions, row.permissions);
    await tx.commit();
    return row;
  }

  async setEnabled(instanceId: string, sourceId: string, enabled: boolean): Promise<void> {
    const tx = await this.svc.begin(instanceId);
    const source = tx.bundle.integrationSources.find((s) => s.id === sourceId);
    if (!source) throw new ValidationError(["That source no longer exists."]);
    tx.rows("integrationSources").push({ ...source, enabled, updatedAt: tx.at });
    tx.audit(enabled ? "integration.enable" : "integration.disable", sourceId, `${enabled ? "Enabled" : "Disabled"} ${source.name}`);
    await tx.commit();
  }

  /** Accept one envelope from a source. Never throws for bad input from the source: it's recorded as refused. */
  async receive(instanceId: string, sourceId: string, envelope: unknown): Promise<ReceiveResult> {
    const tx = await this.svc.begin(instanceId);
    const source = tx.bundle.integrationSources.find((s) => s.id === sourceId);
    if (!source) throw new ValidationError(["Unknown source."]);

    const env = envelopeSchema.safeParse(envelope);
    const externalId = env.success ? env.data.externalId : `invalid:${tx.id()}`;
    const category: SubmissionCategory = env.success ? env.data.category : "dailyReport";
    const payload = env.success ? env.data.payload : envelope;
    const hash = await payloadHash(payload);

    // Idempotent delivery: same id + same payload → the existing submission, untouched.
    // Refused deliveries don't count, so a source can retry once you grant access or it fixes the payload.
    const prior = tx.bundle.submissions.find((s) => s.sourceId === sourceId && s.externalId === externalId && s.status !== "refused");
    if (prior && prior.payloadHash === hash) return { submission: prior, outcome: "duplicate" };

    const errors: string[] = [];
    const warnings: string[] = [];
    let clean: unknown = payload;
    if (!env.success) errors.push("The submission isn't a valid envelope (it needs an externalId, a category and a payload).");
    else {
      const parsed = PAYLOAD_SCHEMAS[category].safeParse(payload);
      if (!parsed.success) errors.push(...parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "payload"}: ${i.message}`));
      else clean = parsed.data;
    }
    if (prior) errors.push(`A different payload was already received under "${externalId}". Changed resubmissions need a new id.`);
    if (!source.enabled) errors.push(`${source.name} is disabled.`);
    const permission = source.permissions[category] ?? "none";
    if (permission === "none") errors.push(`${source.name} has no access to ${category === "dailyReport" ? "daily reports" : "sales"}.`);
    if (errors.length === 0) warnings.push(...duplicateWarnings(tx.bundle, category, clean));

    const submission: SubmissionRow = {
      id: tx.id(),
      instanceId,
      sourceId,
      externalId,
      category,
      payload: clean,
      payloadHash: hash,
      receivedAt: tx.at,
      status: errors.length ? "refused" : "pending",
      decidedAt: errors.length ? tx.at : null,
      decidedBy: null,
      note: "",
      warnings,
      errors,
      resultingRecordIds: [],
    };
    tx.actor = sourceId;
    tx.rows("submissions").push(submission);
    tx.rows("integrationSources").push({ ...source, lastReceivedAt: tx.at });
    tx.audit(errors.length ? "submission.refused" : "submission.received", submission.id, `${source.name} sent ${category} ${externalId}${errors.length ? ` (refused: ${errors[0]})` : ""}`);
    await tx.commit();

    if (submission.status === "pending" && permission === "autoAccept") {
      const applied = await this.approve(instanceId, submission.id, { auto: true });
      return { submission: applied.submission, outcome: "applied" };
    }
    return { submission, outcome: submission.status === "refused" ? "refused" : "pending" };
  }

  /** Apply a pending submission through the ordinary commands. */
  async approve(instanceId: string, submissionId: string, opts: { note?: string; auto?: boolean } = {}): Promise<CommandResult & { submission: SubmissionRow }> {
    const { bundle } = await this.svc.load(instanceId);
    const sub = bundle.submissions.find((s) => s.id === submissionId);
    if (!sub) throw new ValidationError(["That submission no longer exists."]);
    if (sub.status !== "pending") throw new ValidationError([`This submission is already ${sub.status}.`]);
    const source = { kind: "integration" as const, sourceId: sub.sourceId, externalId: sub.externalId };

    let result: CommandResult = { lines: [], promotions: [] };
    let recordIds: string[];
    if (sub.category === "dailyReport") {
      const p = sub.payload as DailyReportPayload;
      const r = await this.svc.saveDailyReport(instanceId, { ...p, source });
      result = r;
      recordIds = [r.report.id];
    } else {
      const p = sub.payload as SalePayload;
      const carrier = p.carrier ? bundle.carriers.find((c) => c.label.toLowerCase() === p.carrier!.toLowerCase()) : undefined;
      const sale = await this.svc.saveSale(instanceId, { submittedAt: p.submittedAt, carrierId: carrier?.key ?? null, product: p.product, issuePaid: p.issuePaid, policyRef: p.policyRef, source });
      recordIds = [sale.id];
    }

    const tx = await this.svc.begin(instanceId);
    const current = tx.bundle.submissions.find((s) => s.id === submissionId)!;
    const decided: SubmissionRow = { ...current, status: "approved", decidedAt: tx.at, decidedBy: opts.auto ? "auto" : "user", note: (opts.note ?? "").trim(), resultingRecordIds: recordIds };
    tx.rows("submissions").push(decided);
    tx.actor = opts.auto ? sub.sourceId : "user";
    tx.audit(opts.auto ? "submission.autoApplied" : "submission.approved", submissionId, `${opts.auto ? "Applied automatically" : "Approved"}: ${sub.category} ${sub.externalId}`);
    await tx.commit();
    return { ...result, submission: decided };
  }

  async reject(instanceId: string, submissionId: string, note = ""): Promise<SubmissionRow> {
    const tx = await this.svc.begin(instanceId);
    const sub = tx.bundle.submissions.find((s) => s.id === submissionId);
    if (!sub) throw new ValidationError(["That submission no longer exists."]);
    if (sub.status !== "pending") throw new ValidationError([`This submission is already ${sub.status}.`]);
    const row: SubmissionRow = { ...sub, status: "rejected", decidedAt: tx.at, decidedBy: "user", note: note.trim() };
    tx.rows("submissions").push(row);
    tx.audit("submission.rejected", submissionId, `Rejected ${sub.category} ${sub.externalId}${note.trim() ? `: ${note.trim()}` : ""}`);
    await tx.commit();
    return row;
  }
}

/** Content that looks like something you already have, so you can check before approving. */
function duplicateWarnings(bundle: { dailyReports: { date: string; hours: number; calls: number }[]; sales: { submittedAt: string; issuePaid: number | null }[] }, category: SubmissionCategory, payload: unknown): string[] {
  if (category === "dailyReport") {
    const p = payload as DailyReportPayload;
    const existing = bundle.dailyReports.find((r) => r.date === p.date);
    if (existing) {
      return [`You already have a report for ${p.date} (${existing.calls} calls, ${existing.hours} h). Approving updates it; XP changes only if the hours differ.`];
    }
    return [];
  }
  const p = payload as SalePayload;
  const minute = p.submittedAt.slice(0, 16);
  const same = bundle.sales.filter((s) => s.submittedAt.slice(0, 16) === minute && (p.issuePaid === null || s.issuePaid === p.issuePaid));
  return same.length ? [`A sale submitted at ${minute.replace("T", " ")}${p.issuePaid !== null ? ` with the same Issue Paid` : ""} already exists. Approving adds another.`] : [];
}
