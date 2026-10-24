import { z } from "zod";

/**
 * Content pack schemas. A pack is pure data: skills, activity types,
 * achievements, islands and seed curriculum. Packs never contain user records.
 *
 * Every id is namespaced by the pack that defines it ("core:skill.speed",
 * "fe:carrier.americo") so expansion packs can be added without collisions.
 */

export const idSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*:[a-zA-Z0-9._-]+$/, 'IDs must be namespaced, e.g. "core:skill.speed"');

/**
 * Diminishing-returns tier. Units up to `fullUpTo` count fully, units between
 * `fullUpTo` and `reducedUpTo` count at `reducedRate`, anything beyond counts zero.
 */
export const tierSchema = z
  .object({
    fullUpTo: z.number().nonnegative(),
    reducedUpTo: z.number().nonnegative(),
    reducedRate: z.number().min(0).max(1).default(0.5),
  })
  .refine((t) => t.reducedUpTo >= t.fullUpTo, "reducedUpTo must be >= fullUpTo");
export type Tier = z.infer<typeof tierSchema>;

export const breadthSchema = z.object({
  /** At least this many activity types must each supply >= minShareEach of the skill's practice credit. */
  minTypes: z.number().int().positive(),
  minShareEach: z.number().min(0).max(1),
  /** No single activity type may supply more than this share. */
  maxShareSingle: z.number().min(0).max(1),
});
export type Breadth = z.infer<typeof breadthSchema>;

export const rankGateSchema = z.object({
  achievementIds: z.array(idSchema).default([]),
  minElapsedDays: z.number().int().nonnegative().default(0),
  minActiveWeeks: z.number().int().nonnegative().default(0),
  breadth: breadthSchema.optional(),
});
export type RankGate = z.infer<typeof rankGateSchema>;

export const rankSchema = z.object({
  name: z.string().min(1),
  threshold: z.number().nonnegative(),
  gate: rankGateSchema.default({}),
});
export type RankDef = z.infer<typeof rankSchema>;

export const activeWeekRuleSchema = z.object({
  minDays: z.number().int().positive(),
  minMinutes: z.number().nonnegative(),
  minActivityTypes: z.number().int().positive(),
});
export type ActiveWeekRule = z.infer<typeof activeWeekRuleSchema>;

export const skillSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  description: z.string(),
  maxScore: z.number().positive(),
  /** Exactly five ranks; rank 1 starts at 0 and rank 5's threshold equals maxScore. */
  ranks: z.array(rankSchema).length(5),
  /** Weekly diminishing returns, measured in XP of practice credit for this skill. */
  weeklyLimit: tierSchema,
  activeWeek: activeWeekRuleSchema,
});
export type SkillDef = z.infer<typeof skillSchema>;

export const fieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["number", "text", "longtext", "select", "multiselect", "rating", "boolean", "datetime"]),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
  /** Options drawn from curriculum data instead of a fixed list. */
  source: z.enum(["carriers", "products", "knowledgeCategories", "objectionCases", "rapportScenarios", "scriptSections", "courses"]).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  minLength: z.number().int().positive().optional(),
  help: z.string().optional(),
});
export type FieldDef = z.infer<typeof fieldSchema>;

export const skillWeightsSchema = z.record(idSchema, z.number().positive());

export const activityModeSchema = z.object({
  label: z.string().min(1),
  multiplier: z.number().positive().default(1),
  /** Optional override of the activity's skill split for this mode. */
  skillWeights: skillWeightsSchema.optional(),
});

export const activityTypeSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  islandId: idSchema,
  description: z.string(),
  /** What one "unit" of this activity is. */
  measure: z.enum(["minutes", "hours", "reps", "runs", "count"]),
  xpPerUnit: z.number().nonnegative(),
  personalBestBonus: z.number().nonnegative().default(0),
  /** Percent split across skills; must sum to 100. */
  skillWeights: skillWeightsSchema,
  modes: z.record(z.string(), activityModeSchema).default({}),
  limits: z
    .object({
      daily: tierSchema.optional(),
      dailyPerSubject: tierSchema.optional(),
      weekly: tierSchema.optional(),
    })
    .default({}),
  /** What `subjectKey` refers to for per-subject limits (objection case, knowledge category, ...). */
  subjectKind: z.string().optional(),
  /** Estimated minutes per unit, used for active-week minutes when no duration is logged. */
  minutesPerUnit: z.number().nonnegative().default(0),
  requiresReflection: z.boolean().default(false),
  fields: z.array(fieldSchema).default([]),
  /** Field holding the unit count; without one, each log is a single unit (one run, one revision). */
  unitsField: z.string().optional(),
  /** Fields joined to form the subject key for per-subject limits and personal bests. */
  subjectFields: z.array(z.string()).default([]),
  /** Field holding a duration in seconds; lower is better, used to detect personal bests. */
  timeField: z.string().optional(),
  /** Field that must be true for a run to count as a personal best. */
  cleanField: z.string().optional(),
  /** False for activities logged through their own screen (daily reports, script revisions). */
  quickLog: z.boolean().default(true),
});
export type ActivityTypeDef = z.infer<typeof activityTypeSchema>;

export const achievementSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  description: z.string(),
  skillId: idSchema.optional(),
  /** The rank this achievement gates, if it is a promotion gate. */
  rank: z.number().int().min(2).max(5).optional(),
  kind: z.enum(["checklist", "count", "rubric", "lightspeed", "composite"]),
  /** Human-readable, self-assessed requirements shown as a checklist. */
  requirements: z.array(z.string()).min(1),
});
export type AchievementDef = z.infer<typeof achievementSchema>;

export const islandSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  tagline: z.string(),
  skillIds: z.array(idSchema).default([]),
  restorationSource: z.enum(["hq", "skill", "scriptTracks", "carriers"]),
});
export type IslandDef = z.infer<typeof islandSchema>;

export const carrierSeedSchema = z.object({
  id: idSchema,
  label: z.string().min(1),
  /** Editable role; "unspecified" until the user decides. The app ships no carrier facts. */
  kind: z.enum(["carrier", "platform", "distributor", "other", "unspecified"]).default("unspecified"),
});
export type CarrierSeed = z.infer<typeof carrierSeedSchema>;

export const knowledgeCategorySeedSchema = z.object({
  id: idSchema,
  scope: z.enum(["carrier", "product"]),
  name: z.string().min(1),
  description: z.string(),
  canBeNotApplicable: z.boolean().default(false),
});
export type KnowledgeCategorySeed = z.infer<typeof knowledgeCategorySeedSchema>;

export const categoryLevelSchema = z.object({
  index: z.number().int().nonnegative(),
  name: z.string().min(1),
  minCreditedMinutes: z.number().nonnegative(),
  requires: z
    .object({
      summaryWritten: z.boolean().optional(),
      checklistMinItems: z.number().int().nonnegative().optional(),
      checklistComplete: z.boolean().optional(),
      reviewedWithinDays: z.number().int().positive().optional(),
      explainedWithoutNotes: z.boolean().optional(),
      minResources: z.number().int().nonnegative().optional(),
    })
    .default({}),
});
export type CategoryLevelDef = z.infer<typeof categoryLevelSchema>;

export const labeledSeedSchema = z.object({ id: idSchema, label: z.string().min(1) });

export const scriptTemplateSchema = z.object({
  title: z.string().min(1),
  sections: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), body: z.string() })),
});

export const catalogItemSchema = z.object({
  id: idSchema,
  category: z.enum(["leads", "crm", "dialer", "training", "equipment", "service", "other"]),
  name: z.string().min(1),
  description: z.string(),
  /** Suggested capability notes; you edit them to match what you actually bought. */
  capabilities: z.string().default(""),
  tracksInventory: z.boolean().default(false),
  subscription: z.boolean().default(false),
});
export type CatalogItem = z.infer<typeof catalogItemSchema>;

/** Script Foundry tracks. Craft counts meaningful improvements; rehearsal counts credited rehearsal minutes. */
export const scriptTracksSchema = z.object({
  craft: z.array(z.object({ name: z.string().min(1), min: z.number().nonnegative() })).min(2),
  rehearsal: z.array(z.object({ name: z.string().min(1), min: z.number().nonnegative() })).min(2),
});
export type ScriptTracks = z.infer<typeof scriptTracksSchema>;

export const seedsSchema = z
  .object({
    carriers: z.array(carrierSeedSchema).default([]),
    knowledgeCategories: z.array(knowledgeCategorySeedSchema).default([]),
    categoryLevels: z.array(categoryLevelSchema).default([]),
    objectionCases: z.array(labeledSeedSchema).default([]),
    rapportScenarios: z.array(labeledSeedSchema).default([]),
    scriptTemplate: scriptTemplateSchema.optional(),
    scriptTracks: scriptTracksSchema.optional(),
    catalog: z.array(catalogItemSchema).default([]),
  })
  .default({});
export type Seeds = z.infer<typeof seedsSchema>;

export const gatePatchSchema = z.object({
  skillId: idSchema,
  rank: z.number().int().min(2).max(5),
  /** Appended to the rank's gate; all listed achievements are required. */
  achievementIds: z.array(idSchema).min(1),
});

export const contentPackSchema = z.object({
  format: z.literal("meridian-pack"),
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "version must be semver, e.g. 1.0.0"),
  requires: z.array(z.object({ id: z.string() })).default([]),
  skills: z.array(skillSchema).default([]),
  activityTypes: z.array(activityTypeSchema).default([]),
  achievements: z.array(achievementSchema).default([]),
  islands: z.array(islandSchema).default([]),
  gatePatches: z.array(gatePatchSchema).default([]),
  seeds: seedsSchema,
});
export type ContentPack = z.infer<typeof contentPackSchema>;
export type ContentPackInput = z.input<typeof contentPackSchema>;
