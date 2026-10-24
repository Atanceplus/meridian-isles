import type { CourseRow, DocketCaseRow, ObjectionEncounterRow, RapportCardRow, RapportNoteRow, RebuttalTrialRow } from "../persistence/types";
import type { CommandResult, CommandService, Transaction } from "./commands";
import { ValidationError } from "./errors";
import { rowKey } from "./curriculum";

/**
 * Court of Objections, Conversation Cove and Velocity Circuit records. None of
 * these award XP directly except a Rebuttal Trial, which is logged as spoken
 * objection practice.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 20_000;
const OBJECTION_PRACTICE = "core:act.objection-practice";
export const TRIAL_SIZE = 15;

export interface CaseInput {
  key?: string;
  title: string;
  response?: string;
  notes?: string;
  scriptSectionId?: string | null;
  archived?: boolean;
}

export interface EncounterInput {
  occurredOn: string;
  caseKey: string;
  outcome: ObjectionEncounterRow["outcome"];
  notes?: string;
}

export interface CardInput {
  id?: string;
  kind: RapportCardRow["kind"];
  title: string;
  body: string;
  scenarioKey?: string | null;
}

export interface CourseInput {
  key?: string;
  name: string;
  kind: CourseRow["kind"];
  carrierKey?: string | null;
  archived?: boolean;
}

export class IslandCommands {
  constructor(private svc: CommandService) {}

  // ---------- Court of Objections ----------

  async saveCase(instanceId: string, input: CaseInput): Promise<DocketCaseRow> {
    const tx = await this.svc.begin(instanceId);
    const title = input.title.trim();
    const existing = input.key ? tx.bundle.docket.find((c) => c.key === input.key) : undefined;
    const errors: string[] = [];
    if (!title || title.length > 160) errors.push("Give the objection a short title (under 160 characters).");
    if (input.key && !existing) errors.push("That case no longer exists.");
    if ((input.response?.length ?? 0) > MAX_TEXT || (input.notes?.length ?? 0) > MAX_TEXT) errors.push("That text is too long.");
    if (errors.length) throw new ValidationError(errors);
    const key = existing?.key ?? `user:${tx.id()}`;
    const row: DocketCaseRow = {
      id: rowKey(instanceId, key),
      instanceId,
      key,
      title,
      response: input.response ?? existing?.response ?? "",
      notes: input.notes ?? existing?.notes ?? "",
      scriptSectionId: input.scriptSectionId !== undefined ? input.scriptSectionId : (existing?.scriptSectionId ?? null),
      archived: input.archived ?? existing?.archived ?? false,
      sortOrder: existing?.sortOrder ?? tx.bundle.docket.length,
      createdAt: existing?.createdAt ?? tx.at,
      updatedAt: tx.at,
    };
    tx.rows("docket").push(row);
    tx.audit(existing ? "docket.update" : "docket.create", key, `${existing ? "Updated" : "Added"} case "${title}"`);
    await tx.commit();
    return row;
  }

  async logEncounter(instanceId: string, input: EncounterInput): Promise<ObjectionEncounterRow> {
    const tx = await this.svc.begin(instanceId);
    const errors = checkDay(input.occurredOn, tx.at);
    if (!tx.bundle.docket.some((c) => c.key === input.caseKey)) errors.push("Choose a docket case.");
    if (!["resolved", "unresolved", "callEnded"].includes(input.outcome)) errors.push("Choose an outcome.");
    if (errors.length) throw new ValidationError(errors);
    const row: ObjectionEncounterRow = {
      id: tx.id(),
      instanceId,
      occurredOn: input.occurredOn,
      caseKey: input.caseKey,
      outcome: input.outcome,
      notes: (input.notes ?? "").trim(),
      createdAt: tx.at,
    };
    tx.rows("objectionEncounters").push(row);
    tx.audit("encounter.create", row.id, "Logged a real objection");
    await tx.commit();
    return row;
  }

  async deleteEncounter(instanceId: string, id: string): Promise<void> {
    await this.removeRow(instanceId, "objectionEncounters", id, "encounter.delete", "Deleted a real-objection record");
  }

  /** Save a Rebuttal Trial. It also counts as spoken objection practice (one rep per case drawn). */
  async saveTrial(instanceId: string, results: { caseKey: string; fluent: boolean }[]): Promise<CommandResult & { trial: RebuttalTrialRow }> {
    const tx = await this.svc.begin(instanceId);
    const keys = new Set(tx.bundle.docket.map((c) => c.key));
    const errors: string[] = [];
    if (results.length === 0 || results.length > 30) errors.push("A trial covers between 1 and 30 cases.");
    if (new Set(results.map((r) => r.caseKey)).size !== results.length) errors.push("Each case can appear once per trial.");
    if (results.some((r) => !keys.has(r.caseKey))) errors.push("A trial case is no longer on your docket.");
    if (errors.length) throw new ValidationError(errors);

    const fluent = results.filter((r) => r.fluent).length;
    const id = tx.id();
    const values = { caseId: `trial:${id}`, reps: results.length, fluency: Math.max(1, Math.round((fluent / results.length) * 5)) };
    const activity = this.svc.buildActivityRow(tx, OBJECTION_PRACTICE, values, { occurredAt: tx.at, mode: "spoken" }, [], null);
    tx.activity(activity.record);
    tx.activities.push(activity);
    const trial: RebuttalTrialRow = { id, instanceId, at: tx.at, results, activityId: activity.id };
    tx.rows("rebuttalTrials").push(trial);
    tx.audit("trial.create", id, `Rebuttal Trial: ${fluent}/${results.length} fluent`);
    await tx.commit();
    return { trial, lines: tx.lines, promotions: tx.promotions };
  }

  // ---------- Conversation Cove ----------

  async saveCard(instanceId: string, input: CardInput): Promise<RapportCardRow> {
    const tx = await this.svc.begin(instanceId);
    const existing = input.id ? tx.bundle.rapportCards.find((c) => c.id === input.id) : undefined;
    const errors: string[] = [];
    if (input.id && !existing) errors.push("That card no longer exists.");
    if (!["opener", "transition", "story", "question"].includes(input.kind)) errors.push("Choose a card type.");
    if (!input.title.trim() || input.title.length > 120) errors.push("Give the card a short title.");
    if (!input.body.trim()) errors.push("Write the card's words.");
    if (input.body.length > MAX_TEXT) errors.push("That text is too long.");
    if (input.scenarioKey && !tx.registry.seeds.rapportScenarios.some((s) => s.id === input.scenarioKey)) errors.push("Unknown scenario.");
    if (errors.length) throw new ValidationError(errors);
    const row: RapportCardRow = {
      id: existing?.id ?? tx.id(),
      instanceId,
      kind: input.kind,
      title: input.title.trim(),
      body: input.body,
      scenarioKey: input.scenarioKey ?? null,
      createdAt: existing?.createdAt ?? tx.at,
      updatedAt: tx.at,
    };
    tx.rows("rapportCards").push(row);
    tx.audit(existing ? "rapport.update" : "rapport.create", row.id, `${existing ? "Updated" : "Added"} rapport card "${row.title}"`);
    await tx.commit();
    return row;
  }

  async deleteCard(instanceId: string, id: string): Promise<void> {
    await this.removeRow(instanceId, "rapportCards", id, "rapport.delete", "Deleted a rapport card");
  }

  async saveNote(instanceId: string, input: { occurredOn: string; note: string; scenarioKey?: string | null }): Promise<RapportNoteRow> {
    const tx = await this.svc.begin(instanceId);
    const errors = checkDay(input.occurredOn, tx.at);
    if (!input.note.trim()) errors.push("Write what happened.");
    if (errors.length) throw new ValidationError(errors);
    const row: RapportNoteRow = { id: tx.id(), instanceId, occurredOn: input.occurredOn, scenarioKey: input.scenarioKey ?? null, note: input.note.trim(), createdAt: tx.at };
    tx.rows("rapportNotes").push(row);
    tx.audit("rapportNote.create", row.id, "Logged a real-call rapport note");
    await tx.commit();
    return row;
  }

  async deleteNote(instanceId: string, id: string): Promise<void> {
    await this.removeRow(instanceId, "rapportNotes", id, "rapportNote.delete", "Deleted a rapport note");
  }

  // ---------- Velocity Circuit courses ----------

  async saveCourse(instanceId: string, input: CourseInput): Promise<CourseRow> {
    const tx = await this.svc.begin(instanceId);
    const existing = input.key ? tx.bundle.courses.find((c) => c.key === input.key) : undefined;
    const errors: string[] = [];
    if (input.key && !existing) errors.push("That course no longer exists.");
    if (!input.name.trim() || input.name.length > 80) errors.push("Give the course a name under 80 characters.");
    if (input.kind === "app" && !tx.bundle.carriers.some((c) => c.key === input.carrierKey)) errors.push("An application course needs a carrier.");
    if (existing && existing.kind !== input.kind) errors.push("A course's kind can't change; make a new course.");
    if (errors.length) throw new ValidationError(errors);
    const key = existing?.key ?? `course:${tx.id()}`;
    const row: CourseRow = {
      id: rowKey(instanceId, key),
      instanceId,
      key,
      name: input.name.trim(),
      kind: input.kind,
      carrierKey: input.kind === "app" ? (input.carrierKey ?? null) : null,
      targetSeconds: existing?.targetSeconds ?? null,
      targetSetOn: existing?.targetSetOn ?? null,
      archived: input.archived ?? existing?.archived ?? false,
      createdAt: existing?.createdAt ?? tx.at,
    };
    tx.rows("courses").push(row);
    tx.audit(existing ? "course.update" : "course.create", key, `${existing ? "Updated" : "Added"} course "${row.name}"`);
    await tx.commit();
    return row;
  }

  /** Set a course's target time. Once set it is frozen, so a target can't be loosened after the fact. */
  async setCourseTarget(instanceId: string, key: string, seconds: number): Promise<CourseRow> {
    const tx = await this.svc.begin(instanceId);
    const course = tx.bundle.courses.find((c) => c.key === key);
    if (!course) throw new ValidationError(["That course no longer exists."]);
    if (course.targetSeconds !== null) throw new ValidationError([`${course.name}'s target is already set and frozen. Make a new course to change it.`]);
    if (!Number.isInteger(seconds) || seconds < 5 || seconds > 36_000) throw new ValidationError(["Enter a target between 5 seconds and 10 hours."]);
    const row: CourseRow = { ...course, targetSeconds: seconds, targetSetOn: tx.at.slice(0, 10) };
    tx.rows("courses").push(row);
    tx.audit("course.target", key, `Set ${course.name}'s target to ${seconds}s`);
    await tx.commit();
    return row;
  }

  private async removeRow(instanceId: string, table: "objectionEncounters" | "rapportCards" | "rapportNotes", id: string, action: string, summary: string): Promise<void> {
    const tx: Transaction = await this.svc.begin(instanceId);
    const row = (tx.bundle[table] as { id: string }[]).find((r) => r.id === id);
    if (!row) throw new ValidationError(["That record no longer exists."]);
    tx.remove(table, id);
    tx.audit(action, id, summary, row);
    await tx.commit();
  }
}

function checkDay(day: string, at: string): string[] {
  if (!DATE_RE.test(day)) return ["Enter the date."];
  if (day > at.slice(0, 10)) return ["That date is in the future."];
  return [];
}
