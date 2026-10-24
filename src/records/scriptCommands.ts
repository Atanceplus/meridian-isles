import { differenceInSeconds, parseISO } from "date-fns";
import type { ScriptRevisionRow, ScriptRow, ScriptSection, ScriptVersionRow } from "../persistence/types";
import type { CommandResult, CommandService, Transaction } from "./commands";
import { ValidationError } from "./errors";
import { validateValues } from "./forms";
import { REVISION_TYPE, sectionsEqual } from "./script";

/**
 * Script Foundry commands. Every save is kept as a revision; a burst of typing
 * within COALESCE_SECONDS extends the latest revision instead of creating
 * hundreds. Named versions point at revisions. Only an explicit "meaningful
 * improvement" mark on a version earns XP.
 */

export const COALESCE_SECONDS = 60;
const MAX_SECTIONS = 40;
const MAX_BODY = 20_000;

export class ScriptCommands {
  constructor(private svc: CommandService) {}

  /** Save the editor's current sections. Returns the revision now current (unchanged if nothing differed). */
  async saveDraft(instanceId: string, scriptId: string, sections: ScriptSection[]): Promise<ScriptRevisionRow> {
    const tx = await this.svc.begin(instanceId);
    const script = getScript(tx, scriptId);
    const clean = checkSections(sections);
    const current = getRevision(tx, script.currentRevisionId);
    if (sectionsEqual(current.sections, clean)) return current;

    const versioned = tx.bundle.scriptVersions.some((v) => v.revisionId === current.id);
    const recent = differenceInSeconds(parseISO(tx.at), parseISO(current.updatedAt)) <= COALESCE_SECONDS;
    let revision: ScriptRevisionRow;
    if (current.parentId !== null && !versioned && recent) {
      revision = { ...current, sections: clean, updatedAt: tx.at };
    } else {
      revision = { id: tx.id(), instanceId, scriptId, parentId: current.id, createdAt: tx.at, updatedAt: tx.at, sections: clean };
    }
    tx.rows("scriptRevisions").push(revision);
    tx.rows("scripts").push({ ...script, currentRevisionId: revision.id, updatedAt: tx.at });
    await tx.commit();
    return revision;
  }

  async renameScript(instanceId: string, scriptId: string, title: string): Promise<ScriptRow> {
    const tx = await this.svc.begin(instanceId);
    const script = getScript(tx, scriptId);
    const clean = title.trim();
    if (!clean || clean.length > 80) throw new ValidationError(["Give the script a title under 80 characters."]);
    const row = { ...script, title: clean, updatedAt: tx.at };
    tx.rows("scripts").push(row);
    tx.audit("script.rename", scriptId, `Renamed script to "${clean}"`);
    await tx.commit();
    return row;
  }

  /** Name the current state of the script. Refuses if nothing changed since the last version. */
  async createVersion(instanceId: string, scriptId: string, name: string, note: string): Promise<ScriptVersionRow> {
    const tx = await this.svc.begin(instanceId);
    const script = getScript(tx, scriptId);
    const clean = name.trim();
    if (!clean || clean.length > 80) throw new ValidationError(["Give the version a name under 80 characters."]);
    const current = getRevision(tx, script.currentRevisionId);
    const latest = versionsOf(tx, scriptId).pop();
    if (latest && sectionsEqual(getRevision(tx, latest.revisionId).sections, current.sections)) {
      throw new ValidationError([`Nothing has changed since "${latest.name}".`]);
    }
    const version: ScriptVersionRow = {
      id: tx.id(),
      instanceId,
      scriptId,
      revisionId: current.id,
      name: clean,
      note: note.trim(),
      createdAt: tx.at,
      meaningful: null,
    };
    tx.rows("scriptVersions").push(version);
    tx.audit("script.version", version.id, `Saved version "${clean}"`);
    await tx.commit();
    return version;
  }

  /**
   * Mark a version as a meaningful improvement over the version before it (or
   * the original script). This logs a script-revision activity, subject to its
   * daily and weekly limits.
   */
  async markMeaningful(instanceId: string, versionId: string, tag: string, note: string): Promise<CommandResult & { version: ScriptVersionRow }> {
    const tx = await this.svc.begin(instanceId);
    const version = tx.bundle.scriptVersions.find((v) => v.id === versionId);
    if (!version) throw new ValidationError(["That version no longer exists."]);
    if (version.meaningful) throw new ValidationError(["This version is already marked as an improvement."]);

    const type = tx.ruleset.activityTypes[REVISION_TYPE]!;
    const values = { tag, note: note.trim(), versionId };
    const errors = validateValues(type, values, undefined);
    const { baseline, label } = baselineFor(tx, version);
    if (sectionsEqual(baseline, getRevision(tx, version.revisionId).sections)) errors.push(`This version is identical to ${label}.`);
    if (errors.length) throw new ValidationError(errors);

    const activity = this.svc.buildActivityRow(tx, REVISION_TYPE, values, { occurredAt: tx.at }, [], null);
    tx.activity(activity.record);
    tx.activities.push(activity);
    const marked: ScriptVersionRow = { ...version, meaningful: { tag, note: values.note, markedAt: tx.at, activityId: activity.id } };
    tx.rows("scriptVersions").push(marked);
    tx.audit("script.meaningful", versionId, `Marked "${version.name}" as a meaningful improvement`, undefined, values);
    await tx.commit();
    return { version: marked, lines: tx.lines, promotions: tx.promotions };
  }

  /** Withdraw an improvement mark, reversing the XP it earned. */
  async unmarkMeaningful(instanceId: string, versionId: string): Promise<CommandResult> {
    const tx = await this.svc.begin(instanceId);
    const version = tx.bundle.scriptVersions.find((v) => v.id === versionId);
    if (!version?.meaningful) throw new ValidationError(["This version isn't marked as an improvement."]);
    const activity = tx.bundle.activities.find((a) => a.id === version.meaningful!.activityId);
    if (activity && activity.status === "active") {
      tx.reverse(activity.record.id);
      tx.activities.push({ ...activity, status: "reversed", reversedAt: tx.at });
    }
    tx.rows("scriptVersions").push({ ...version, meaningful: null });
    tx.audit("script.unmeaningful", versionId, `Withdrew the improvement mark on "${version.name}"`);
    await tx.commit();
    return { lines: tx.lines, promotions: tx.promotions };
  }
}

function getScript(tx: Transaction, id: string): ScriptRow {
  const script = tx.current("scripts", id);
  if (!script) throw new ValidationError(["That script no longer exists."]);
  return script;
}

function getRevision(tx: Transaction, id: string): ScriptRevisionRow {
  const revision = tx.current("scriptRevisions", id);
  if (!revision) throw new Error(`Missing script revision "${id}"`);
  return revision;
}

function versionsOf(tx: Transaction, scriptId: string): ScriptVersionRow[] {
  return tx.bundle.scriptVersions.filter((v) => v.scriptId === scriptId).sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/** What a version is compared against: the version before it, or the original script. */
export function baselineFor(tx: Transaction, version: ScriptVersionRow): { baseline: ScriptSection[]; label: string } {
  const list = versionsOf(tx, version.scriptId);
  const prev = list[list.findIndex((v) => v.id === version.id) - 1];
  if (prev) return { baseline: getRevision(tx, prev.revisionId).sections, label: `"${prev.name}"` };
  const original = tx.bundle.scriptRevisions.find((r) => r.scriptId === version.scriptId && r.parentId === null);
  return { baseline: original?.sections ?? [], label: "the original script" };
}

function checkSections(sections: ScriptSection[]): ScriptSection[] {
  const errors: string[] = [];
  if (sections.length === 0) errors.push("A script needs at least one section.");
  if (sections.length > MAX_SECTIONS) errors.push(`Keep the script to ${MAX_SECTIONS} sections.`);
  const ids = new Set<string>();
  const clean = sections.map((s) => ({ id: s.id.trim(), name: s.name.trim(), body: s.body }));
  for (const s of clean) {
    if (!s.id || ids.has(s.id)) errors.push("Each section needs its own id.");
    ids.add(s.id);
    if (!s.name) errors.push("Every section needs a name.");
    if (s.name.length > 60) errors.push(`Keep section names under 60 characters ("${s.name.slice(0, 20)}…").`);
    if (s.body.length > MAX_BODY) errors.push(`"${s.name}" is too long.`);
  }
  if (errors.length) throw new ValidationError([...new Set(errors)]);
  return clean;
}
