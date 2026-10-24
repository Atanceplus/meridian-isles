import type { ContentRegistry } from "../content/registry";
import {
  advanceTime,
  applyActivity,
  buildRuleset,
  completeAchievement as engineCompleteAchievement,
  createInitialState,
  reverseActivity,
  type ActivityRecord,
  type AwardLine,
  type ProgressState,
  type Promotion,
  type Ruleset,
} from "../domain";
import type { StorageAdapter } from "../persistence/storage";
import {
  SCHEMA_VERSION,
  type AchievementRow,
  type ActivityRow,
  type AuditRow,
  BUNDLE_TABLES,
  type BundleTable,
  type DailyReportRow,
  type EngineEvent,
  type InstanceBundle,
  type InstanceRow,
  type SaleRow,
  type SourceMeta,
  type TableName,
  type TableRows,
} from "../persistence/types";
import { laterOf, nowLocal } from "./clock";
import { ValidationError } from "./errors";
import { STUDY_TYPE, subjectFromValues } from "./curriculum";
import { CurriculumCommands, activityRefProblems, refreshPeak } from "./curriculumCommands";
import { REVISION_TYPE } from "./script";
import { ScriptCommands } from "./scriptCommands";
import { IslandCommands } from "./islandCommands";
import { LightspeedCommands } from "./lightspeedCommands";
import { ShopCommands } from "./shopCommands";
import { ArchiveCommands } from "./archiveCommands";
import { IntegrationCommands } from "./integrationCommands";
import { needsSeeding, seedRows } from "./seed";
import { evaluateAchievement, type Requirement } from "./achievements";
import { isPersonalBest, subjectKeyFor, unitsFor, validateValues, type FieldValues } from "./forms";

/**
 * The command service: the only way records change. Manual entry (and, later,
 * approved integration submissions) call these same commands, so progress is
 * awarded in exactly one place. Each command is one atomic commit.
 */

export { ValidationError };

export interface CommandResult {
  lines: AwardLine[];
  promotions: Promotion[];
}

export interface InstanceView {
  bundle: InstanceBundle;
  ruleset: Ruleset;
  state: ProgressState;
}

export interface DailyReportInput {
  date: string;
  calls: number;
  hours: number;
  applicationsSubmitted: number;
  issuePaid: number | null;
  notes?: string;
  /** Set when an approved integration submission writes this report. */
  source?: SourceMeta;
}

export interface SaleInput {
  id?: string;
  submittedAt: string;
  carrierId: string | null;
  product?: string;
  issuePaid: number | null;
  policyRef?: string;
  notes?: string;
  /** Set when an approved integration submission writes this sale. */
  source?: SourceMeta;
}

const CALL_REPORT = "core:act.call-report";
const MANUAL: SourceMeta = { kind: "manual" };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

export class CommandService {
  readonly curriculum: CurriculumCommands;
  readonly scripts: ScriptCommands;
  readonly islands: IslandCommands;
  readonly lightspeed: LightspeedCommands;
  readonly shop: ShopCommands;
  readonly archive: ArchiveCommands;
  readonly integrations: IntegrationCommands;

  constructor(
    private storage: StorageAdapter,
    readonly registry: ContentRegistry,
    private clock: () => string = nowLocal,
    private newId: () => string = () => crypto.randomUUID(),
  ) {
    this.curriculum = new CurriculumCommands(this);
    this.scripts = new ScriptCommands(this);
    this.islands = new IslandCommands(this);
    this.lightspeed = new LightspeedCommands(this);
    this.shop = new ShopCommands(this);
    this.archive = new ArchiveCommands(this, this.storage);
    this.integrations = new IntegrationCommands(this);
  }

  /** @internal The service's clock, as a local ISO date-time. */
  now(): string {
    return this.clock();
  }

  /** @internal A new unique id. */
  freshId(): string {
    return this.newId();
  }

  // ---------- Instances ----------

  async listInstances(): Promise<InstanceRow[]> {
    const rows = await this.storage.listInstances();
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }

  async createInstance(name: string): Promise<InstanceRow> {
    const clean = checkName(name);
    const at = this.clock();
    const instance: InstanceRow = {
      id: this.newId(),
      name: clean,
      createdAt: at,
      updatedAt: at,
      schemaVersion: SCHEMA_VERSION,
      packRefs: this.registry.packs,
      overrides: {},
      settings: { currency: "USD" },
    };
    const ruleset = buildRuleset(this.registry, instance.overrides);
    await this.storage.commit(instance.id, {
      instance,
      put: {
        ...seedRows(this.registry, instance.id, at, this.newId),
        audit: [this.auditRow(instance.id, at, "instance.create", instance.id, `Created map "${clean}"`)],
      },
      snapshot: { instanceId: instance.id, state: createInitialState(ruleset), lastSeq: 0, updatedAt: at },
    });
    return instance;
  }

  async renameInstance(instanceId: string, name: string): Promise<void> {
    const view = await this.load(instanceId);
    const at = this.clock();
    const clean = checkName(name);
    const before = view.bundle.instance.name;
    await this.storage.commit(instanceId, {
      instance: { ...view.bundle.instance, name: clean, updatedAt: at },
      put: { audit: [this.auditRow(instanceId, at, "instance.rename", instanceId, `Renamed "${before}" to "${clean}"`)] },
    });
  }

  async deleteInstance(instanceId: string): Promise<void> {
    await this.storage.deleteInstance(instanceId);
  }

  /** Load an instance with its ruleset and current progress. */
  async load(instanceId: string): Promise<InstanceView> {
    let bundle = await this.storage.loadBundle(instanceId);
    if (!bundle) throw new Error(`Map "${instanceId}" was not found.`);
    if (needsSeeding(bundle)) {
      // Maps created by earlier versions get any starting curriculum they're missing.
      await this.storage.commit(instanceId, { put: seedRows(this.registry, instanceId, this.clock(), this.newId, bundle) });
      bundle = (await this.storage.loadBundle(instanceId))!;
    }
    const ruleset = buildRuleset(this.registry, bundle.instance.overrides);
    const state = bundle.snapshot?.state ?? createInitialState(ruleset);
    return { bundle, ruleset, state };
  }

  // ---------- Activities ----------

  async logActivity(
    instanceId: string,
    typeId: string,
    values: FieldValues,
    opts: { occurredAt: string; mode?: string },
  ): Promise<CommandResult & { activity: ActivityRow }> {
    const tx = await this.begin(instanceId);
    const type = tx.ruleset.activityTypes[typeId];
    if (!type) throw new ValidationError([`Unknown activity "${typeId}".`]);
    if (typeId === CALL_REPORT) throw new ValidationError(["Call hours are logged through the daily report."]);
    if (typeId === REVISION_TYPE) throw new ValidationError(["Mark a script version as a meaningful improvement in the Script Foundry."]);
    this.checkActivityInput(tx, type.id, values, opts);

    const activity = this.buildActivityRow(tx, typeId, values, opts, tx.bundle.activities, null);
    tx.activity(activity.record);
    tx.activities.push(activity);
    this.afterActivity(tx, activity);
    tx.audit("activity.log", activity.id, `Logged ${type.name}`, undefined, values);
    await tx.commit();
    return { activity, lines: tx.lines, promotions: tx.promotions };
  }

  /** Edit = reverse the old record and apply a replacement. The late-logging check still uses the original time. */
  async editActivity(
    instanceId: string,
    activityId: string,
    values: FieldValues,
    opts: { occurredAt: string; mode?: string },
  ): Promise<CommandResult & { activity: ActivityRow }> {
    const tx = await this.begin(instanceId);
    const old = tx.bundle.activities.find((a) => a.id === activityId);
    if (!old || old.status !== "active") throw new ValidationError(["That activity can't be edited."]);
    if (old.dailyReportId) throw new ValidationError(["Edit call hours through the daily report."]);
    if (old.typeId === REVISION_TYPE) throw new ValidationError(["Change script improvements in the Script Foundry."]);
    if (isTrialRecord(old)) throw new ValidationError(["Rebuttal Trials are kept as they were run."]);
    const type = tx.ruleset.activityTypes[old.typeId]!;
    this.checkActivityInput(tx, type.id, values, opts);

    tx.reverse(old.record.id);
    const others = tx.bundle.activities.filter((a) => a.id !== old.id);
    const activity = this.buildActivityRow(tx, old.typeId, values, opts, others, old.record.eligibleFrom ?? old.record.recordedAt);
    tx.activity(activity.record);
    tx.activities.push({ ...old, status: "reversed", reversedAt: tx.at, replacedBy: activity.id }, activity);
    this.afterActivity(tx, activity);
    tx.audit("activity.edit", activity.id, `Edited ${type.name}`, old.values, values);
    await tx.commit();
    return { activity, lines: tx.lines, promotions: tx.promotions };
  }

  async deleteActivity(instanceId: string, activityId: string): Promise<CommandResult> {
    const tx = await this.begin(instanceId);
    const row = tx.bundle.activities.find((a) => a.id === activityId);
    if (!row || row.status !== "active") throw new ValidationError(["That activity is already removed."]);
    if (row.dailyReportId) throw new ValidationError(["Remove call hours through the daily report."]);
    if (row.typeId === REVISION_TYPE) throw new ValidationError(["Undo a script improvement from its version in the Script Foundry."]);
    if (isTrialRecord(row)) throw new ValidationError(["Rebuttal Trials are kept as they were run."]);
    tx.reverse(row.record.id);
    tx.activities.push({ ...row, status: "reversed", reversedAt: tx.at });
    tx.audit("activity.delete", row.id, `Removed ${tx.ruleset.activityTypes[row.typeId]?.name ?? row.typeId}`, row.values);
    await tx.commit();
    return { lines: tx.lines, promotions: tx.promotions };
  }

  // ---------- Daily reports ----------

  /** Create or update the report for a date. Only a change in hours touches XP. */
  async saveDailyReport(instanceId: string, input: DailyReportInput): Promise<CommandResult & { report: DailyReportRow }> {
    const tx = await this.begin(instanceId);
    const errors = checkDailyReport(input, tx.at);
    if (errors.length > 0) throw new ValidationError(errors);
    if (input.source?.kind === "integration") tx.actor = input.source.sourceId;

    const existing = tx.bundle.dailyReports.find((r) => r.date === input.date) ?? null;
    const currency = tx.bundle.instance.settings.currency;
    const report: DailyReportRow = {
      id: existing?.id ?? this.newId(),
      instanceId,
      date: input.date,
      calls: input.calls,
      hours: input.hours,
      applicationsSubmitted: input.applicationsSubmitted,
      issuePaid: input.issuePaid,
      currency,
      notes: input.notes?.trim() ?? "",
      activityId: existing?.activityId ?? null,
      createdAt: existing?.createdAt ?? tx.at,
      updatedAt: tx.at,
      source: input.source ?? existing?.source ?? MANUAL,
    };

    const oldActivity = existing?.activityId ? tx.bundle.activities.find((a) => a.id === existing.activityId) : undefined;
    const hoursChanged = !existing || existing.hours !== input.hours || (input.hours > 0 && !oldActivity);
    if (hoursChanged) {
      let eligibleFrom: string | null = null;
      if (oldActivity && oldActivity.status === "active") {
        tx.reverse(oldActivity.record.id);
        eligibleFrom = oldActivity.record.eligibleFrom ?? oldActivity.record.recordedAt;
        tx.activities.push({ ...oldActivity, status: "reversed", reversedAt: tx.at });
      }
      report.activityId = null;
      if (input.hours > 0) {
        const noon = `${input.date}T12:00:00`;
        const values = { calls: input.calls, hours: input.hours, applicationsSubmitted: input.applicationsSubmitted, issuePaid: input.issuePaid };
        const activity = this.buildActivityRow(tx, CALL_REPORT, values, { occurredAt: noon < tx.at ? noon : tx.at }, [], eligibleFrom);
        activity.dailyReportId = report.id;
        tx.activity(activity.record);
        tx.activities.push(activity);
        if (oldActivity) {
          const replaced = tx.activities.find((a) => a.id === oldActivity.id);
          if (replaced) replaced.replacedBy = activity.id;
        }
        report.activityId = activity.id;
      }
    }

    tx.dailyReports.push(report);
    tx.audit(existing ? "report.update" : "report.create", report.id, `Daily report for ${input.date}`, existing ?? undefined, report);
    await tx.commit();
    return { report, lines: tx.lines, promotions: tx.promotions };
  }

  async deleteDailyReport(instanceId: string, reportId: string): Promise<CommandResult> {
    const tx = await this.begin(instanceId);
    const report = tx.bundle.dailyReports.find((r) => r.id === reportId);
    if (!report) throw new ValidationError(["That report no longer exists."]);
    const activity = report.activityId ? tx.bundle.activities.find((a) => a.id === report.activityId) : undefined;
    if (activity && activity.status === "active") {
      tx.reverse(activity.record.id);
      tx.activities.push({ ...activity, status: "reversed", reversedAt: tx.at });
    }
    tx.removeReports.push(report.id);
    tx.audit("report.delete", report.id, `Deleted daily report for ${report.date}`, report);
    await tx.commit();
    return { lines: tx.lines, promotions: tx.promotions };
  }

  // ---------- Itemized sales (no XP; production and future achievement evidence) ----------

  async saveSale(instanceId: string, input: SaleInput): Promise<SaleRow> {
    const tx = await this.begin(instanceId);
    const errors: string[] = [];
    if (!DATETIME_RE.test(input.submittedAt)) errors.push("Enter when the application was submitted.");
    else if (normalizeDateTime(input.submittedAt) > tx.at) errors.push("A sale can't be in the future.");
    if (input.issuePaid !== null && !(input.issuePaid >= 0)) errors.push("Issue Paid can't be negative.");
    if (errors.length > 0) throw new ValidationError(errors);

    // A submission that was already applied returns the same sale instead of creating another.
    const src = input.source;
    if (src?.kind === "integration") {
      tx.actor = src.sourceId;
      const applied = tx.bundle.sales.find((s) => s.source.kind === "integration" && s.source.sourceId === src.sourceId && s.source.externalId === src.externalId);
      if (applied) return applied;
    }

    const existing = input.id ? tx.bundle.sales.find((s) => s.id === input.id) : undefined;
    if (input.id && !existing) throw new ValidationError(["That sale no longer exists."]);
    if (existing && normalizeDateTime(input.submittedAt) !== existing.submittedAt && inAttempt(tx, existing.id)) {
      throw new ValidationError(["This sale is part of a Lightspeed attempt, so its submission time can't change."]);
    }
    const sale: SaleRow = {
      id: existing?.id ?? this.newId(),
      instanceId,
      submittedAt: normalizeDateTime(input.submittedAt),
      carrierId: input.carrierId,
      product: input.product?.trim() ?? "",
      issuePaid: input.issuePaid,
      currency: tx.bundle.instance.settings.currency,
      policyRef: input.policyRef?.trim() ?? "",
      notes: input.notes?.trim() ?? "",
      anchorDate: existing?.anchorDate ?? null,
      retention: existing?.retention ?? null,
      createdAt: existing?.createdAt ?? tx.at,
      updatedAt: tx.at,
      source: existing?.source ?? input.source ?? MANUAL,
    };
    tx.sales.push(sale);
    tx.audit(existing ? "sale.update" : "sale.create", sale.id, `Sale submitted ${sale.submittedAt}`, existing, sale);
    await tx.commit();
    return sale;
  }

  async deleteSale(instanceId: string, saleId: string): Promise<void> {
    const tx = await this.begin(instanceId);
    const sale = tx.bundle.sales.find((s) => s.id === saleId);
    if (!sale) throw new ValidationError(["That sale no longer exists."]);
    if (inAttempt(tx, saleId)) throw new ValidationError(["This sale is part of a Lightspeed attempt and is kept as evidence."]);
    tx.removeSales.push(saleId);
    tx.audit("sale.delete", saleId, `Deleted sale submitted ${sale.submittedAt}`, sale);
    await tx.commit();
  }

  // ---------- Achievements and time ----------

  async completeAchievement(instanceId: string, achievementId: string, evidenceNote: string): Promise<CommandResult> {
    const tx = await this.begin(instanceId);
    const def = this.registry.achievementById[achievementId];
    if (!def) throw new ValidationError([`Unknown achievement "${achievementId}".`]);
    if (def.kind === "lightspeed") throw new ValidationError(["Lightspeed completes from its attempt tracker, once all ten checkpoints are confirmed."]);
    if (tx.state.achievements[achievementId]) throw new ValidationError([`${def.name} is already complete.`]);
    // Self-assessed, but backed by records wherever the records can show it.
    const reqs = evaluateAchievement(achievementId, { bundle: tx.bundle, registry: this.registry, ruleset: tx.ruleset, now: tx.at });
    const missing = (reqs ?? []).filter((r): r is Extract<Requirement, { kind: "check" }> => r.kind === "check" && !r.met);
    if (missing.length) {
      throw new ValidationError([`Your records don't show this yet: ${missing.map((r) => `${r.text} (${r.current}/${r.required})`).join("; ")}.`]);
    }

    tx.achievement(achievementId);
    tx.achievementRows.push({
      id: `${instanceId}|${achievementId}`,
      instanceId,
      achievementId,
      completedAt: tx.at,
      evidenceNote: evidenceNote.trim(),
      evidence: (reqs ?? []).flatMap((r) => (r.kind === "check" ? [{ text: r.text, current: r.current, required: r.required }] : [])),
    });
    tx.audit("achievement.complete", achievementId, `Completed ${def.name}`, undefined, { evidenceNote });
    await tx.commit();
    return { lines: [], promotions: tx.promotions };
  }

  /** Let time-based gates promote (e.g. on app open). Writes nothing unless a promotion happened. */
  async refreshTime(instanceId: string): Promise<Promotion[]> {
    const tx = await this.begin(instanceId);
    const result = advanceTime(tx.state, tx.at, tx.ruleset);
    if (result.promotions.length === 0) return [];
    tx.state = result.state;
    tx.pushEvent({ kind: "time" });
    tx.promotions.push(...result.promotions);
    tx.audit("time.promote", instanceId, `Time-based promotion: ${result.promotions.map((p) => `${p.skillId} → ${p.toRank}`).join(", ")}`);
    await tx.commit();
    return result.promotions;
  }

  // ---------- Internals ----------

  private checkActivityInput(tx: Transaction, typeId: string, values: FieldValues, opts: { occurredAt: string; mode?: string }): void {
    const type = tx.ruleset.activityTypes[typeId]!;
    const errors = validateValues(type, values, opts.mode);
    if (!DATETIME_RE.test(opts.occurredAt)) errors.push("Enter when this happened.");
    else if (normalizeDateTime(opts.occurredAt) > tx.at) errors.push("An activity can't be in the future.");
    if (errors.length === 0) errors.push(...activityRefProblems(tx, typeId, values));
    if (errors.length > 0) throw new ValidationError(errors);
  }

  /** Follow-up bookkeeping for activities that feed curriculum levels. */
  private afterActivity(tx: Transaction, activity: ActivityRow): void {
    if (activity.typeId !== STUDY_TYPE) return;
    const subject = subjectFromValues(activity.values);
    if (subject) refreshPeak(tx, subject);
  }

  /** @internal Build an activity row and its engine record (also used by the Foundry for script improvements). */
  buildActivityRow(
    tx: Transaction,
    typeId: string,
    values: FieldValues,
    opts: { occurredAt: string; mode?: string },
    earlier: ActivityRow[],
    eligibleFrom: string | null,
  ): ActivityRow {
    const type = tx.ruleset.activityTypes[typeId]!;
    const id = this.newId();
    const occurredAt = normalizeDateTime(opts.occurredAt);
    const record: ActivityRecord = {
      id,
      typeId,
      occurredAt,
      recordedAt: tx.at,
      units: unitsFor(type, values),
    };
    const subjectKey = subjectKeyFor(type, values);
    if (subjectKey !== undefined) record.subjectKey = subjectKey;
    if (opts.mode !== undefined) record.mode = opts.mode;
    if (isPersonalBest(type, values, earlier)) record.personalBest = true;
    if (eligibleFrom !== null) record.eligibleFrom = eligibleFrom;
    return {
      id,
      instanceId: tx.bundle.instance.id,
      typeId,
      occurredAt,
      recordedAt: tx.at,
      values,
      record,
      status: "active",
      reversedAt: null,
      replacedBy: null,
      dailyReportId: null,
      source: MANUAL,
    };
  }

  /** @internal Start a command: load the map and fix this command's time. */
  async begin(instanceId: string): Promise<Transaction> {
    const view = await this.load(instanceId);
    const at = laterOf(this.clock(), view.state.lastEventAt);
    return new Transaction(this.storage, this.registry, view, at, this.newId, (...args) => this.auditRow(...args));
  }

  private auditRow(instanceId: string, at: string, action: string, target: string, summary: string, before?: unknown, after?: unknown): AuditRow {
    const row: AuditRow = { id: this.newId(), instanceId, at, actor: "user", action, target, summary };
    if (before !== undefined) row.before = before;
    if (after !== undefined) row.after = after;
    return row;
  }
}

/** Collects one command's writes and commits them together with the new snapshot. */
export class Transaction {
  readonly bundle: InstanceBundle;
  readonly ruleset: Ruleset;
  state: ProgressState;
  seq: number;
  lines: AwardLine[] = [];
  promotions: Promotion[] = [];
  private puts: { [K in TableName]?: TableRows[K][] } = {};
  private removals: { [K in TableName]?: string[] } = {};

  /** Rows to write to `table` (upserted by id). */
  rows<K extends TableName>(table: K): TableRows[K][] {
    return (this.puts[table] ??= []) as TableRows[K][];
  }
  remove(table: TableName, id: string): void {
    (this.removals[table] ??= []).push(id);
  }
  /** The latest version of a row: written in this transaction, else as loaded. */
  current<K extends BundleTable>(table: K, id: string): TableRows[K] | undefined {
    const find = (rows: { id: string }[]) => rows.filter((r) => r.id === id).pop() as TableRows[K] | undefined;
    return find(this.rows(table)) ?? find(this.bundle[table]);
  }

  get activities(): ActivityRow[] {
    return this.rows("activities");
  }
  get dailyReports(): DailyReportRow[] {
    return this.rows("dailyReports");
  }
  get sales(): SaleRow[] {
    return this.rows("sales");
  }
  get achievementRows(): AchievementRow[] {
    return this.rows("achievements");
  }
  get removeReports(): { push(id: string): void } {
    return { push: (id: string) => this.remove("dailyReports", id) };
  }
  get removeSales(): { push(id: string): void } {
    return { push: (id: string) => this.remove("sales", id) };
  }

  constructor(
    private storage: StorageAdapter,
    readonly registry: ContentRegistry,
    view: InstanceView,
    readonly at: string,
    private newId: () => string,
    private makeAudit: (instanceId: string, at: string, action: string, target: string, summary: string, before?: unknown, after?: unknown) => AuditRow,
  ) {
    this.bundle = view.bundle;
    this.ruleset = view.ruleset;
    this.state = view.state;
    this.seq = view.bundle.snapshot?.lastSeq ?? 0;
  }

  activity(record: ActivityRecord): void {
    const result = applyActivity(this.state, record, this.ruleset);
    this.state = result.state;
    this.pushEvent({ kind: "activity", record });
    this.addLines(result.lines);
    this.promotions.push(...result.promotions);
  }

  reverse(recordId: string): void {
    const result = reverseActivity(this.state, recordId, this.at, this.ruleset);
    this.state = result.state;
    this.pushEvent({ kind: "reversal", recordId });
    this.addLines(result.lines);
  }

  achievement(achievementId: string): void {
    const result = engineCompleteAchievement(this.state, achievementId, this.at, this.ruleset);
    this.state = result.state;
    this.pushEvent({ kind: "achievement", achievementId });
    this.promotions.push(...result.promotions);
  }

  pushEvent(event: EngineEvent): void {
    this.seq += 1;
    this.rows("events").push({ id: this.newId(), instanceId: this.bundle.instance.id, seq: this.seq, at: this.at, rulesetVersion: this.ruleset.version, event });
  }

  /** Who this command acts for, as recorded in the audit log: "user" or an integration source id. */
  actor = "user";

  audit(action: string, target: string, summary: string, before?: unknown, after?: unknown): void {
    this.rows("audit").push({ ...this.makeAudit(this.bundle.instance.id, this.at, action, target, summary, before, after), actor: this.actor });
  }

  async commit(): Promise<void> {
    const instanceId = this.bundle.instance.id;
    await this.storage.commit(instanceId, {
      instance: { ...this.bundle.instance, updatedAt: this.at },
      put: this.puts,
      remove: this.removals,
      snapshot: { instanceId, state: this.state, lastSeq: this.seq, updatedAt: this.at },
    });
  }

  id(): string {
    return this.newId();
  }

  /** The bundle as it will be after this transaction commits. */
  merged(): InstanceBundle {
    const out = { ...this.bundle } as Record<string, unknown>;
    for (const table of BUNDLE_TABLES) {
      const byId = new Map((this.bundle[table] as { id: string }[]).map((r) => [r.id, r]));
      for (const row of this.rows(table) as { id: string }[]) byId.set(row.id, row);
      for (const id of this.removals[table] ?? []) byId.delete(id);
      out[table] = [...byId.values()];
    }
    return out as InstanceBundle;
  }

  private addLines(lines: AwardLine[]): void {
    this.lines.push(...lines);
    const ledger = this.rows("ledger");
    for (const line of lines) ledger.push({ ...line, id: this.newId(), instanceId: this.bundle.instance.id });
  }
}

/** The practice record a Rebuttal Trial created; it stays tied to the trial. */
function isTrialRecord(row: ActivityRow): boolean {
  return typeof row.values.caseId === "string" && row.values.caseId.startsWith("trial:");
}

function inAttempt(tx: Transaction, saleId: string): boolean {
  return tx.bundle.lightspeedAttempts.some((a) => a.saleIds.includes(saleId));
}

function checkName(name: string): string {
  const clean = name.trim();
  if (clean.length === 0) throw new ValidationError(["Give the map a name."]);
  if (clean.length > 60) throw new ValidationError(["Keep the name under 60 characters."]);
  return clean;
}

function checkDailyReport(input: DailyReportInput, at: string): string[] {
  const errors: string[] = [];
  if (!DATE_RE.test(input.date)) errors.push("Enter the report date.");
  else if (input.date > at.slice(0, 10)) errors.push("A report can't be for a future date.");
  const wholeCount = (v: number, label: string) => {
    if (!Number.isInteger(v) || v < 0) errors.push(`${label} must be a whole number, 0 or more.`);
  };
  wholeCount(input.calls, "Calls");
  wholeCount(input.applicationsSubmitted, "Sales");
  if (!(input.hours >= 0 && input.hours <= 24)) errors.push("Hours must be between 0 and 24.");
  if (input.issuePaid !== null && !(input.issuePaid >= 0)) errors.push("Issue Paid can't be negative.");
  return errors;
}

/** "2027-01-04T09:30" → "2027-01-04T09:30:00" so every stored time compares as a string. */
function normalizeDateTime(value: string): string {
  return value.length === 16 ? `${value}:00` : value;
}
