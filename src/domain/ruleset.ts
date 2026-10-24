import { z } from "zod";
import type { ContentRegistry } from "../content/registry";
import {
  activeWeekRuleSchema,
  breadthSchema,
  tierSchema,
  type ActivityTypeDef,
  type SkillDef,
} from "../content/schema";
import type { WeekStartsOn } from "./calendar";

/**
 * A ruleset is the content registry plus per-instance calibration overrides,
 * resolved into the exact numbers the engine uses. Every award line records
 * the ruleset version it was computed under, so changing calibration only
 * affects later awards.
 */

export interface GeneralRules {
  /** Records logged more than this many days after they happened are stored but earn no XP. */
  backdateDays: number;
  weekStartsOn: WeekStartsOn;
}

export interface LightspeedRules {
  windowMinutes: number;
  salesRequired: number;
  retentionMonths: number;
  /** What starts the retention clock: the submission date, or a date the user enters (issue / first draft). */
  checkpointAnchor: "submission" | "enteredDate";
  failurePolicy: "attemptIneligible";
  /** If true, another sale from the same window may replace a failed one. */
  allowSubstitutionFromSameWindow: boolean;
}

export interface Ruleset {
  version: string;
  skills: Record<string, SkillDef>;
  skillOrder: string[];
  activityTypes: Record<string, ActivityTypeDef>;
  achievementIds: Set<string>;
  general: GeneralRules;
  lightspeed: LightspeedRules;
}

export const DEFAULT_GENERAL: GeneralRules = { backdateDays: 7, weekStartsOn: 1 };

export const DEFAULT_LIGHTSPEED: LightspeedRules = {
  windowMinutes: 30,
  salesRequired: 10,
  retentionMonths: 3,
  checkpointAnchor: "submission",
  failurePolicy: "attemptIneligible",
  allowSubstitutionFromSameWindow: false,
};

const rankOverrideSchema = z
  .object({
    name: z.string().min(1),
    threshold: z.number().nonnegative(),
    gate: z
      .object({
        achievementIds: z.array(z.string()),
        minElapsedDays: z.number().int().nonnegative(),
        minActiveWeeks: z.number().int().nonnegative(),
        breadth: breadthSchema.nullable(),
      })
      .partial(),
  })
  .partial();

export const rulesetOverridesSchema = z
  .object({
    general: z
      .object({
        backdateDays: z.number().int().nonnegative(),
        weekStartsOn: z.number().int().min(0).max(6),
      })
      .partial(),
    lightspeed: z
      .object({
        windowMinutes: z.number().positive(),
        salesRequired: z.number().int().positive(),
        retentionMonths: z.number().int().positive(),
        checkpointAnchor: z.enum(["submission", "enteredDate"]),
        failurePolicy: z.literal("attemptIneligible"),
        allowSubstitutionFromSameWindow: z.boolean(),
      })
      .partial(),
    /** Keyed by skill id. Ranks are keyed by rank number "1".."5". */
    skills: z.record(
      z.string(),
      z
        .object({
          weeklyLimit: tierSchema,
          activeWeek: activeWeekRuleSchema.partial(),
          ranks: z.record(z.string(), rankOverrideSchema),
        })
        .partial(),
    ),
    activityTypes: z.record(
      z.string(),
      z
        .object({
          xpPerUnit: z.number().nonnegative(),
          personalBestBonus: z.number().nonnegative(),
          skillWeights: z.record(z.string(), z.number().positive()),
          limits: z.object({ daily: tierSchema, dailyPerSubject: tierSchema, weekly: tierSchema }).partial(),
        })
        .partial(),
    ),
  })
  .partial();
export type RulesetOverrides = z.input<typeof rulesetOverridesSchema>;

export function buildRuleset(registry: ContentRegistry, overridesInput: RulesetOverrides = {}): Ruleset {
  const overrides = rulesetOverridesSchema.parse(overridesInput);
  const errors: string[] = [];

  const skills: Record<string, SkillDef> = {};
  for (const base of registry.skills) {
    const skill = structuredClone(base);
    const o = overrides.skills?.[skill.id];
    if (o?.weeklyLimit) skill.weeklyLimit = o.weeklyLimit;
    if (o?.activeWeek) skill.activeWeek = { ...skill.activeWeek, ...o.activeWeek };
    for (const [rankNo, ro] of Object.entries(o?.ranks ?? {})) {
      const rank = skill.ranks[Number(rankNo) - 1];
      if (!rank) {
        errors.push(`${skill.id}: no rank "${rankNo}"`);
        continue;
      }
      if (ro.name !== undefined) rank.name = ro.name;
      if (ro.threshold !== undefined) rank.threshold = ro.threshold;
      if (ro.gate) {
        const { breadth, ...rest } = ro.gate;
        Object.assign(rank.gate, rest);
        if (breadth === null) delete rank.gate.breadth;
        else if (breadth) rank.gate.breadth = breadth;
      }
    }
    skill.maxScore = skill.ranks[4]!.threshold;
    skill.ranks.forEach((r, i) => {
      const prev = skill.ranks[i - 1];
      if (prev && r.threshold <= prev.threshold) errors.push(`${skill.id}: rank thresholds must strictly increase`);
      for (const id of r.gate.achievementIds) {
        if (!registry.achievementById[id]) errors.push(`${skill.id}: unknown achievement "${id}"`);
      }
    });
    skills[skill.id] = skill;
  }
  for (const id of Object.keys(overrides.skills ?? {})) {
    if (!skills[id]) errors.push(`Override for unknown skill "${id}"`);
  }

  const activityTypes: Record<string, ActivityTypeDef> = {};
  for (const base of registry.activityTypes) {
    const type = structuredClone(base);
    const o = overrides.activityTypes?.[type.id];
    if (o?.xpPerUnit !== undefined) type.xpPerUnit = o.xpPerUnit;
    if (o?.personalBestBonus !== undefined) type.personalBestBonus = o.personalBestBonus;
    if (o?.skillWeights) type.skillWeights = o.skillWeights;
    if (o?.limits) type.limits = { ...type.limits, ...o.limits };
    const total = Object.values(type.skillWeights).reduce((a, b) => a + b, 0);
    if (Math.abs(total - 100) > 1e-9) errors.push(`${type.id}: skill weights sum to ${total}, expected 100`);
    for (const id of Object.keys(type.skillWeights)) {
      if (!skills[id]) errors.push(`${type.id}: unknown skill "${id}"`);
    }
    activityTypes[type.id] = type;
  }
  for (const id of Object.keys(overrides.activityTypes ?? {})) {
    if (!activityTypes[id]) errors.push(`Override for unknown activity type "${id}"`);
  }

  if (errors.length > 0) throw new Error(`Invalid ruleset overrides:\n${errors.join("\n")}`);

  const packPart = registry.packs.map((p) => `${p.id}@${p.version}`).join("+");
  const overridePart = Object.keys(overrides).length === 0 ? "default" : fnv1a(stableStringify(overrides));

  return {
    version: `${packPart}#${overridePart}`,
    skills,
    skillOrder: registry.skills.map((s) => s.id),
    activityTypes,
    achievementIds: new Set(registry.achievements.map((a) => a.id)),
    general: {
      ...DEFAULT_GENERAL,
      ...overrides.general,
      weekStartsOn: (overrides.general?.weekStartsOn ?? DEFAULT_GENERAL.weekStartsOn) as WeekStartsOn,
    },
    lightspeed: { ...DEFAULT_LIGHTSPEED, ...overrides.lightspeed },
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
