import type { ActivityTypeDef } from "../../content/schema";
import { dayKey, daysBetween, weekKey } from "../calendar";
import type { Ruleset } from "../ruleset";
import { creditThroughTiers, type TierPosition } from "../tiers";
import { gateMetExceptScore } from "./gates";
import type {
  ActivityRecord,
  AwardLine,
  AwardStatus,
  ProgressState,
  Promotion,
  RecordContribution,
  SkillProgress,
} from "./state";

/**
 * The progression engine. Pure functions over plain state: each call returns a
 * new state plus the award lines and promotions it produced. Events are
 * append-only and must arrive in recordedAt order, which is what makes cap
 * blocking final: XP blocked now can never be recomputed into existence later.
 */

export class EngineError extends Error {}

export interface ActivityResult {
  state: ProgressState;
  lines: AwardLine[];
  promotions: Promotion[];
}

export interface TimeResult {
  state: ProgressState;
  promotions: Promotion[];
}

const EPSILON = 1e-6;

export function applyActivity(prev: ProgressState, record: ActivityRecord, ruleset: Ruleset): ActivityResult {
  const type = ruleset.activityTypes[record.typeId];
  if (!type) throw new EngineError(`Unknown activity type "${record.typeId}"`);
  if (!(record.units > 0) || !Number.isFinite(record.units)) throw new EngineError(`Record "${record.id}" must have positive units`);
  if (record.occurredAt > record.recordedAt) throw new EngineError(`Record "${record.id}" occurs after it was recorded`);
  if (record.mode !== undefined && !type.modes[record.mode]) {
    throw new EngineError(`Activity "${type.id}" has no mode "${record.mode}"`);
  }
  if (prev.appliedRecordIds[record.id]) throw new EngineError(`Record "${record.id}" was already applied`);
  assertChronological(prev, record.recordedAt);

  const state = structuredClone(prev);
  state.appliedRecordIds[record.id] = true;
  state.lastEventAt = record.recordedAt;
  state.rulesetVersion = ruleset.version;

  const mode = record.mode !== undefined ? type.modes[record.mode] : undefined;
  const weights = mode?.skillWeights ?? type.skillWeights;
  const multiplier = mode?.multiplier ?? 1;
  const bonus = record.personalBest ? type.personalBestBonus : 0;
  const requested = record.units * type.xpPerUnit * multiplier + bonus;

  const lines: AwardLine[] = [];
  const line = (skillId: string, status: AwardStatus, amount: number, explanation: string[]) =>
    lines.push({
      recordId: record.id,
      typeId: type.id,
      skillId,
      status,
      amount: round2(amount),
      explanation,
      rulesetVersion: ruleset.version,
      at: record.recordedAt,
    });

  const baseNote = describeBase(type, record, multiplier, mode?.label, bonus, requested);

  const occurredDay = dayKey(record.occurredAt);
  const lateBy = daysBetween(occurredDay, dayKey(record.eligibleFrom ?? record.recordedAt));
  if (lateBy > ruleset.general.backdateDays) {
    for (const [skillId, weight] of Object.entries(weights)) {
      line(skillId, "ineligible:backdated", (requested * weight) / 100, [
        baseNote,
        `Logged ${lateBy} days after it happened. Only activity logged within ${ruleset.general.backdateDays} days earns XP; the record still counts in your history.`,
      ]);
    }
    return { state, lines, promotions: [] };
  }

  if (state.journeyStart === null || occurredDay < state.journeyStart) state.journeyStart = occurredDay;

  // Time may have satisfied a gate (elapsed days) before this activity lands.
  const promotions = promote(state, ruleset, record.recordedAt);

  // Activity-level diminishing returns, shared by every skill this activity feeds.
  // Every logged unit counts toward every limit, even if another limit already zeroed it.
  const week = weekKey(record.occurredAt, ruleset.general.weekStartsOn);
  const limitPositions: (TierPosition & { key: string; label: string })[] = [];
  if (type.limits.daily) {
    const key = `d|${type.id}|${occurredDay}`;
    limitPositions.push({ key, tier: type.limits.daily, used: state.usage[key] ?? 0, label: "daily limit" });
  }
  if (type.limits.dailyPerSubject) {
    const key = `ds|${type.id}|${record.subjectKey ?? "_"}|${occurredDay}`;
    limitPositions.push({ key, tier: type.limits.dailyPerSubject, used: state.usage[key] ?? 0, label: "daily limit for this subject" });
  }
  if (type.limits.weekly) {
    const key = `w|${type.id}|${week}`;
    limitPositions.push({ key, tier: type.limits.weekly, used: state.usage[key] ?? 0, label: "weekly limit" });
  }
  const creditedUnits = creditThroughTiers(record.units, limitPositions);
  for (const pos of limitPositions) state.usage[pos.key] = pos.used + record.units;
  const activityFactor = creditedUnits / record.units;
  const activityNote =
    activityFactor < 1 - EPSILON
      ? `${limitPositions.map((p) => p.label).join(" / ")}: ${fmt(creditedUnits)} of ${fmt(record.units)} ${type.measure} credited`
      : null;

  const minutes = activityMinutes(type, record);
  const contribution: RecordContribution = {
    typeId: type.id,
    units: record.units,
    usageKeys: limitPositions.map((p) => p.key),
    week,
    day: occurredDay,
    minutes,
    perSkill: {},
  };
  state.contributions[record.id] = contribution;

  for (const [skillId, weight] of Object.entries(weights)) {
    const skill = ruleset.skills[skillId]!;
    const progress = state.skills[skillId]!;

    const base = (requested * weight) / 100;
    const afterActivity = base * activityFactor;

    const weeklyKey = `${skillId}|${week}`;
    const weeklyUsed = state.weeklySkillCredit[weeklyKey] ?? 0;
    const practice = creditThroughTiers(afterActivity, [{ tier: skill.weeklyLimit, used: weeklyUsed }]);
    state.weeklySkillCredit[weeklyKey] = weeklyUsed + afterActivity;

    progress.practiceByType[type.id] = (progress.practiceByType[type.id] ?? 0) + practice;
    trackWeek(progress, week, occurredDay, minutes, type.id);

    const notes = [baseNote, `${weight}% to ${skill.name}: ${fmt(base)} XP`];
    if (activityNote) notes.push(activityNote);
    if (practice < afterActivity - EPSILON) {
      notes.push(`${skill.name} weekly limit: ${fmt(practice)} of ${fmt(afterActivity)} XP credited this week`);
    }

    const award = awardToSkill(state, ruleset, skillId, practice, record.recordedAt);
    promotions.push(...award.promotions);

    const lost = base - practice;
    progress.blockedByLimit += lost > EPSILON ? lost : 0;
    contribution.perSkill[skillId] = {
      weeklyKey,
      weeklyCredit: afterActivity,
      practice,
      gained: award.gained,
      legacy: award.legacy,
      capped: award.capped,
      lost: lost > EPSILON ? lost : 0,
    };
    if (award.gained > EPSILON || (lost <= EPSILON && award.capped <= EPSILON && award.legacy <= EPSILON)) {
      line(skillId, lost > EPSILON ? "reduced" : "awarded", award.gained, notes);
    }
    if (award.legacy > EPSILON) line(skillId, "legacy", award.legacy, [...notes, `${skill.name} is at its maximum; extra XP goes to Legacy.`]);
    if (lost > EPSILON) line(skillId, "blocked:limit", lost, notes);
    if (award.capped > EPSILON) line(skillId, "blocked:cap", award.capped, [...notes, ...award.capNotes]);
  }

  // This activity may have completed an active week or breadth share for a capped skill.
  promotions.push(...promote(state, ruleset, record.recordedAt));
  return { state, lines, promotions };
}

/**
 * Undo a record's contribution exactly (used for deletions and edits). Reversal
 * never demotes: the score cannot fall below the current rank's threshold, and
 * XP the record had blocked stays unearned. Returns negative "reversed" lines.
 */
export function reverseActivity(prev: ProgressState, recordId: string, at: string, ruleset: Ruleset): ActivityResult {
  if (!prev.appliedRecordIds[recordId]) throw new EngineError(`Record "${recordId}" was never applied`);
  if (prev.reversedRecordIds[recordId]) throw new EngineError(`Record "${recordId}" was already reversed`);
  assertChronological(prev, at);

  const state = structuredClone(prev);
  state.reversedRecordIds[recordId] = true;
  state.lastEventAt = at;
  const lines: AwardLine[] = [];
  const c = state.contributions[recordId];
  delete state.contributions[recordId];
  if (!c) return { state, lines, promotions: [] }; // late record: nothing was counted

  for (const key of c.usageKeys) state.usage[key] = Math.max(0, (state.usage[key] ?? 0) - c.units);

  for (const [skillId, s] of Object.entries(c.perSkill)) {
    const skill = ruleset.skills[skillId];
    const progress = state.skills[skillId];
    if (!skill || !progress) continue;

    state.weeklySkillCredit[s.weeklyKey] = Math.max(0, (state.weeklySkillCredit[s.weeklyKey] ?? 0) - s.weeklyCredit);
    progress.practiceByType[c.typeId] = Math.max(0, (progress.practiceByType[c.typeId] ?? 0) - s.practice);
    progress.blockedByCap = Math.max(0, progress.blockedByCap - s.capped);
    progress.blockedByLimit = Math.max(0, progress.blockedByLimit - s.lost);

    const week = progress.weeks[c.week];
    if (week) {
      week.minutes = Math.max(0, week.minutes - c.minutes);
      week.dayCounts[c.day] = Math.max(0, (week.dayCounts[c.day] ?? 0) - 1);
      week.typeCounts[c.typeId] = Math.max(0, (week.typeCounts[c.typeId] ?? 0) - 1);
    }

    const legacyRemoved = Math.min(progress.legacy, s.legacy);
    progress.legacy -= legacyRemoved;
    const floor = skill.ranks[progress.rank - 1]!.threshold;
    const scoreRemoved = Math.min(s.gained, Math.max(0, progress.score - floor));
    progress.score -= scoreRemoved;

    const removed = scoreRemoved + legacyRemoved;
    const notes = [`Removed this record's ${fmt(round2(s.gained + s.legacy))} XP from ${skill.name}.`];
    if (scoreRemoved < s.gained - EPSILON) {
      notes.push(`${skill.name} keeps its ${skill.ranks[progress.rank - 1]!.name} rank, so the score stays at ${fmt(floor)} or above.`);
    }
    lines.push({
      recordId,
      typeId: c.typeId,
      skillId,
      status: "reversed",
      amount: -round2(removed),
      explanation: notes,
      rulesetVersion: ruleset.version,
      at,
    });
  }
  return { state, lines, promotions: [] };
}

/** Record an achievement as complete. Its gate takes effect from `at`; it never releases XP blocked earlier. */
export function completeAchievement(prev: ProgressState, achievementId: string, at: string, ruleset: Ruleset): TimeResult {
  if (!ruleset.achievementIds.has(achievementId)) throw new EngineError(`Unknown achievement "${achievementId}"`);
  assertChronological(prev, at);
  const state = structuredClone(prev);
  state.lastEventAt = at;
  if (state.achievements[achievementId] === undefined) state.achievements[achievementId] = at;
  return { state, promotions: promote(state, ruleset, at) };
}

/** Advance the clock (e.g. on app open) so time-based gates can promote a capped skill. */
export function advanceTime(prev: ProgressState, at: string, ruleset: Ruleset): TimeResult {
  assertChronological(prev, at);
  const state = structuredClone(prev);
  state.lastEventAt = at;
  return { state, promotions: promote(state, ruleset, at) };
}

/** Promote every skill whose score sits at or above its next threshold and whose gate is now met. Mutates. */
function promote(state: ProgressState, ruleset: Ruleset, at: string): Promotion[] {
  const promotions: Promotion[] = [];
  for (const skillId of ruleset.skillOrder) {
    const skill = ruleset.skills[skillId]!;
    const progress = state.skills[skillId]!;
    while (progress.rank < 5) {
      const next = skill.ranks[progress.rank]!;
      if (progress.score < next.threshold || !gateMetExceptScore(state, ruleset, skillId, progress.rank + 1, at)) break;
      promotions.push(raiseRank(progress, skillId, at));
    }
  }
  return promotions;
}

interface SkillAward {
  gained: number;
  legacy: number;
  capped: number;
  capNotes: string[];
  promotions: Promotion[];
}

/** Add practice credit to a skill, promoting across thresholds or stopping at a cap. Mutates. */
function awardToSkill(state: ProgressState, ruleset: Ruleset, skillId: string, amount: number, at: string): SkillAward {
  const skill = ruleset.skills[skillId]!;
  const progress = state.skills[skillId]!;
  const result: SkillAward = { gained: 0, legacy: 0, capped: 0, capNotes: [], promotions: [] };
  let remaining = amount;

  while (remaining > EPSILON) {
    if (progress.rank >= 5) {
      const room = Math.max(0, skill.maxScore - progress.score);
      const take = Math.min(room, remaining);
      progress.score += take;
      result.gained += take;
      remaining -= take;
      progress.legacy += remaining;
      result.legacy += remaining;
      break;
    }

    const nextRank = progress.rank + 1;
    const next = skill.ranks[progress.rank]!;
    const room = next.threshold - progress.score;
    if (remaining < room) {
      progress.score += remaining;
      result.gained += remaining;
      break;
    }

    progress.score += Math.max(0, room);
    result.gained += Math.max(0, room);
    remaining -= Math.max(0, room);

    if (gateMetExceptScore(state, ruleset, skillId, nextRank, at)) {
      result.promotions.push(raiseRank(progress, skillId, at));
    } else {
      progress.blockedByCap += remaining;
      result.capped += remaining;
      result.capNotes.push(`${skill.name} is capped at ${fmt(next.threshold)} until the ${next.name} requirements are complete.`);
      break;
    }
  }
  return result;
}

function raiseRank(progress: SkillProgress, skillId: string, at: string): Promotion {
  progress.rank += 1;
  const promotion = { skillId, toRank: progress.rank, at };
  progress.promotions.push(promotion);
  return promotion;
}

function trackWeek(progress: SkillProgress, week: string, day: string, minutes: number, typeId: string): void {
  const entry = (progress.weeks[week] ??= { dayCounts: {}, minutes: 0, typeCounts: {} });
  entry.dayCounts[day] = (entry.dayCounts[day] ?? 0) + 1;
  entry.typeCounts[typeId] = (entry.typeCounts[typeId] ?? 0) + 1;
  entry.minutes += minutes;
}

function activityMinutes(type: ActivityTypeDef, record: ActivityRecord): number {
  if (record.minutes !== undefined) return record.minutes;
  if (type.measure === "minutes") return record.units;
  if (type.measure === "hours") return record.units * 60;
  return record.units * type.minutesPerUnit;
}

function assertChronological(state: ProgressState, at: string): void {
  if (state.lastEventAt !== null && at < state.lastEventAt) {
    throw new EngineError(`Events must be applied in order: ${at} is before ${state.lastEventAt}`);
  }
}

function describeBase(
  type: ActivityTypeDef,
  record: ActivityRecord,
  multiplier: number,
  modeLabel: string | undefined,
  bonus: number,
  requested: number,
): string {
  let text = `${fmt(record.units)} ${type.measure} × ${fmt(type.xpPerUnit)} XP`;
  if (multiplier !== 1) text += ` × ${fmt(multiplier)} (${modeLabel})`;
  if (bonus > 0) text += ` + ${fmt(bonus)} personal best`;
  return `${text} = ${fmt(requested)} XP`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString("en-US") : round2(n).toLocaleString("en-US");
}
