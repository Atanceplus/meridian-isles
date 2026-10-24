import type { DayKey } from "../calendar";
import type { Ruleset } from "../ruleset";

/** One logged activity as the engine sees it. Produced by the command layer from a user record. */
export interface ActivityRecord {
  id: string;
  typeId: string;
  /** When the activity happened (local ISO date-time). Drives days, weeks and limits. */
  occurredAt: string;
  /** When it was logged. Events must be applied in recordedAt order. */
  recordedAt: string;
  /** Amount in the activity type's measure (minutes, hours, reps, runs, count). */
  units: number;
  /** Actual time spent, if known; used for active-week minutes. */
  minutes?: number;
  /** Subject for per-subject limits (objection case, knowledge category, ...). */
  subjectKey?: string;
  /** Key into the activity type's `modes`. */
  mode?: string;
  personalBest?: boolean;
  /**
   * When a record replaces an edited one, the late-logging check is measured
   * from the original record's time, so fixing a typo later doesn't forfeit XP.
   */
  eligibleFrom?: string;
}

export type AwardStatus =
  | "awarded" // gained at full rate
  | "reduced" // gained, but daily/weekly diminishing returns applied
  | "legacy" // gained after the skill reached max score; cosmetic only
  | "blocked:limit" // not gained: daily/weekly limits
  | "blocked:cap" // not gained: skill held at a promotion cap
  | "ineligible:backdated" // not gained: logged too long after it happened
  | "reversed"; // a negative line removing a deleted or edited record's XP

export interface AwardLine {
  recordId: string;
  typeId: string;
  skillId: string;
  status: AwardStatus;
  amount: number;
  explanation: string[];
  rulesetVersion: string;
  at: string;
}

export interface Promotion {
  skillId: string;
  toRank: number;
  at: string;
}

/** Counts (not sets) so a reversed record can be removed exactly. */
export interface WeekActivity {
  dayCounts: Record<DayKey, number>;
  minutes: number;
  typeCounts: Record<string, number>;
}

/** Exactly what one record added, so it can be reversed without guesswork. */
export interface RecordContribution {
  typeId: string;
  units: number;
  usageKeys: string[];
  week: DayKey;
  day: DayKey;
  minutes: number;
  perSkill: Record<
    string,
    { weeklyKey: string; weeklyCredit: number; practice: number; gained: number; legacy: number; capped: number; lost: number }
  >;
}

export interface SkillProgress {
  score: number;
  /** XP earned beyond max score. Never affects the radar. */
  legacy: number;
  /** 1..5 */
  rank: number;
  /**
   * Practice credit per activity type (after daily/weekly limits, before caps).
   * Used for breadth; it keeps growing while the skill is capped, so a cap can
   * never deadlock a breadth requirement.
   */
  practiceByType: Record<string, number>;
  blockedByCap: number;
  blockedByLimit: number;
  /** Activity per week (keyed by week start), counted whether or not XP was blocked. */
  weeks: Record<DayKey, WeekActivity>;
  promotions: Promotion[];
}

/**
 * Derived progress. Plain JSON so it can be cached as a snapshot; it can always
 * be rebuilt by re-applying the stored events in order.
 */
export interface ProgressState {
  rulesetVersion: string;
  journeyStart: DayKey | null;
  lastEventAt: string | null;
  skills: Record<string, SkillProgress>;
  /** Units used against activity limits, keyed by limit + period. */
  usage: Record<string, number>;
  /** Practice credit fed into each skill's weekly limit, keyed `${skillId}|${week}`. */
  weeklySkillCredit: Record<string, number>;
  /** Achievement id → completion time. */
  achievements: Record<string, string>;
  appliedRecordIds: Record<string, true>;
  reversedRecordIds: Record<string, true>;
  /** Present for every applied, XP-eligible record that hasn't been reversed. */
  contributions: Record<string, RecordContribution>;
}

export function createInitialState(ruleset: Ruleset): ProgressState {
  const skills: Record<string, SkillProgress> = {};
  for (const id of ruleset.skillOrder) {
    skills[id] = {
      score: 0,
      legacy: 0,
      rank: 1,
      practiceByType: {},
      blockedByCap: 0,
      blockedByLimit: 0,
      weeks: {},
      promotions: [],
    };
  }
  return {
    rulesetVersion: ruleset.version,
    journeyStart: null,
    lastEventAt: null,
    skills,
    usage: {},
    weeklySkillCredit: {},
    achievements: {},
    appliedRecordIds: {},
    reversedRecordIds: {},
    contributions: {},
  };
}
