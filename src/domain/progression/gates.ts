import type { ActiveWeekRule, Breadth } from "../../content/schema";
import { dayKey, daysBetween } from "../calendar";
import type { Ruleset } from "../ruleset";
import type { ProgressState, SkillProgress } from "./state";

export type GateCondition =
  | { kind: "score"; met: boolean; current: number; required: number }
  | { kind: "achievement"; met: boolean; achievementId: string }
  | { kind: "elapsedDays"; met: boolean; current: number; required: number }
  | { kind: "activeWeeks"; met: boolean; current: number; required: number }
  | {
      kind: "breadth";
      met: boolean;
      qualifyingTypes: number;
      requiredTypes: number;
      largestShare: number;
      maxShareSingle: number;
    };

/** Every condition for promotion to `rank` (2..5), evaluated at time `at`. */
export function gateConditions(
  state: ProgressState,
  ruleset: Ruleset,
  skillId: string,
  rank: number,
  at: string,
): GateCondition[] {
  const skill = ruleset.skills[skillId];
  const progress = state.skills[skillId];
  const rankDef = skill?.ranks[rank - 1];
  if (!skill || !progress || !rankDef || rank < 2) throw new Error(`No gate for ${skillId} rank ${rank}`);

  const conditions: GateCondition[] = [
    { kind: "score", met: progress.score >= rankDef.threshold, current: progress.score, required: rankDef.threshold },
  ];
  const gate = rankDef.gate;

  for (const achievementId of gate.achievementIds) {
    const completedAt = state.achievements[achievementId];
    conditions.push({ kind: "achievement", achievementId, met: completedAt !== undefined && completedAt <= at });
  }
  if (gate.minElapsedDays > 0) {
    const elapsed = state.journeyStart ? Math.max(0, daysBetween(state.journeyStart, dayKey(at))) : 0;
    conditions.push({ kind: "elapsedDays", met: elapsed >= gate.minElapsedDays, current: elapsed, required: gate.minElapsedDays });
  }
  if (gate.minActiveWeeks > 0) {
    const weeks = countActiveWeeks(progress, skill.activeWeek);
    conditions.push({ kind: "activeWeeks", met: weeks >= gate.minActiveWeeks, current: weeks, required: gate.minActiveWeeks });
  }
  if (gate.breadth) {
    conditions.push({ kind: "breadth", ...breadthStatus(progress.practiceByType, gate.breadth) });
  }
  return conditions;
}

/** True when everything except the score requirement is satisfied. */
export function gateMetExceptScore(
  state: ProgressState,
  ruleset: Ruleset,
  skillId: string,
  rank: number,
  at: string,
): boolean {
  return gateConditions(state, ruleset, skillId, rank, at).every((c) => c.kind === "score" || c.met);
}

/**
 * A week is active for a skill when activity contributing to that skill
 * happened on enough distinct days, for enough minutes, across enough
 * activity types. A single long session can never make a week active.
 */
export function isActiveWeek(week: SkillProgress["weeks"][string], rule: ActiveWeekRule): boolean {
  const days = Object.values(week.dayCounts).filter((n) => n > 0).length;
  const types = Object.values(week.typeCounts).filter((n) => n > 0).length;
  return days >= rule.minDays && week.minutes >= rule.minMinutes && types >= rule.minActivityTypes;
}

export function countActiveWeeks(progress: SkillProgress, rule: ActiveWeekRule): number {
  return Object.values(progress.weeks).filter((w) => isActiveWeek(w, rule)).length;
}

export function breadthStatus(
  practiceByType: Record<string, number>,
  breadth: Breadth,
): { met: boolean; qualifyingTypes: number; requiredTypes: number; largestShare: number; maxShareSingle: number } {
  const values = Object.values(practiceByType).filter((v) => v > 0);
  const total = values.reduce((a, b) => a + b, 0);
  const shares = total > 0 ? values.map((v) => v / total) : [];
  const qualifyingTypes = shares.filter((s) => s >= breadth.minShareEach).length;
  const largestShare = shares.length > 0 ? Math.max(...shares) : 0;
  return {
    met: total > 0 && qualifyingTypes >= breadth.minTypes && largestShare <= breadth.maxShareSingle,
    qualifyingTypes,
    requiredTypes: breadth.minTypes,
    largestShare,
    maxShareSingle: breadth.maxShareSingle,
  };
}
