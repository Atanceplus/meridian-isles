import {
  contentPackSchema,
  type AchievementDef,
  type ActivityTypeDef,
  type ContentPack,
  type IslandDef,
  type Seeds,
  type SkillDef,
} from "./schema";

/** All loaded packs merged and cross-validated. Read-only at runtime. */
export interface ContentRegistry {
  packs: { id: string; version: string }[];
  skills: SkillDef[];
  skillById: Record<string, SkillDef>;
  activityTypes: ActivityTypeDef[];
  activityTypeById: Record<string, ActivityTypeDef>;
  achievements: AchievementDef[];
  achievementById: Record<string, AchievementDef>;
  islands: IslandDef[];
  islandById: Record<string, IslandDef>;
  seeds: Seeds;
}

export type RegistryResult = { ok: true; registry: ContentRegistry } | { ok: false; errors: string[] };

const WEIGHT_TOTAL = 100;

/** Parse, merge and validate packs. Returns every problem found rather than stopping at the first. */
export function buildRegistry(rawPacks: unknown[]): RegistryResult {
  const errors: string[] = [];
  const packs: ContentPack[] = [];

  rawPacks.forEach((raw, i) => {
    const parsed = contentPackSchema.safeParse(raw);
    if (parsed.success) {
      packs.push(parsed.data);
    } else {
      for (const issue of parsed.error.issues) {
        errors.push(`pack[${i}] ${issue.path.join(".")}: ${issue.message}`);
      }
    }
  });
  if (errors.length > 0) return { ok: false, errors };

  const packIds = new Set<string>();
  for (const pack of packs) {
    if (packIds.has(pack.id)) errors.push(`Pack "${pack.id}" is loaded twice`);
    packIds.add(pack.id);
  }
  for (const pack of packs) {
    for (const req of pack.requires) {
      if (!packIds.has(req.id)) errors.push(`Pack "${pack.id}" requires missing pack "${req.id}"`);
    }
  }

  // Deep-copy skills so gate patches never mutate the pack objects.
  const skills = packs.flatMap((p) => p.skills.map((s) => structuredClone(s)));
  const activityTypes = packs.flatMap((p) => p.activityTypes);
  const achievements = packs.flatMap((p) => p.achievements);
  const islands = packs.flatMap((p) => p.islands);

  for (const pack of packs) {
    const owned = [
      ...pack.skills.map((x) => x.id),
      ...pack.activityTypes.map((x) => x.id),
      ...pack.achievements.map((x) => x.id),
      ...pack.islands.map((x) => x.id),
      ...pack.seeds.carriers.map((x) => x.id),
      ...pack.seeds.knowledgeCategories.map((x) => x.id),
      ...pack.seeds.objectionCases.map((x) => x.id),
      ...pack.seeds.rapportScenarios.map((x) => x.id),
      ...pack.seeds.catalog.map((x) => x.id),
    ];
    for (const id of owned) {
      if (!id.startsWith(`${pack.id}:`)) errors.push(`"${id}" is defined in pack "${pack.id}" but not namespaced to it`);
    }
  }

  const skillById = indexUnique(skills, "skill", errors);
  const activityTypeById = indexUnique(activityTypes, "activity type", errors);
  const achievementById = indexUnique(achievements, "achievement", errors);
  const islandById = indexUnique(islands, "island", errors);

  for (const pack of packs) {
    for (const patch of pack.gatePatches) {
      const skill = skillById[patch.skillId];
      const rank = skill?.ranks[patch.rank - 1];
      if (!skill || !rank) {
        errors.push(`Gate patch in "${pack.id}" targets unknown skill/rank ${patch.skillId} #${patch.rank}`);
        continue;
      }
      rank.gate.achievementIds.push(...patch.achievementIds);
    }
  }

  for (const skill of skills) {
    const first = skill.ranks[0];
    const last = skill.ranks[4];
    if (first && first.threshold !== 0) errors.push(`${skill.id}: rank 1 threshold must be 0`);
    if (last && last.threshold !== skill.maxScore) errors.push(`${skill.id}: rank 5 threshold must equal maxScore`);
    skill.ranks.forEach((rank, i) => {
      const prev = skill.ranks[i - 1];
      if (prev && rank.threshold <= prev.threshold) errors.push(`${skill.id}: rank thresholds must strictly increase`);
      for (const achId of rank.gate.achievementIds) {
        if (!achievementById[achId]) errors.push(`${skill.id} rank ${i + 1}: unknown gate achievement "${achId}"`);
      }
    });
  }

  for (const type of activityTypes) {
    if (!islandById[type.islandId]) errors.push(`${type.id}: unknown island "${type.islandId}"`);
    const fieldKeys = new Set(type.fields.map((f) => f.key));
    for (const key of [type.unitsField, type.timeField, type.cleanField, ...type.subjectFields]) {
      if (key !== undefined && !fieldKeys.has(key)) errors.push(`${type.id}: references missing field "${key}"`);
    }
    checkWeights(`${type.id}`, type.skillWeights, skillById, errors);
    for (const [modeKey, mode] of Object.entries(type.modes)) {
      if (mode.skillWeights) checkWeights(`${type.id} mode "${modeKey}"`, mode.skillWeights, skillById, errors);
    }
  }

  for (const ach of achievements) {
    if (ach.skillId && !skillById[ach.skillId]) errors.push(`${ach.id}: unknown skill "${ach.skillId}"`);
  }
  for (const island of islands) {
    for (const skillId of island.skillIds) {
      if (!skillById[skillId]) errors.push(`${island.id}: unknown skill "${skillId}"`);
    }
  }

  const seeds = mergeSeeds(packs);
  indexUnique(seeds.knowledgeCategories, "knowledge category", errors);
  indexUnique(seeds.carriers, "carrier", errors);
  for (const [name, ladder] of Object.entries(seeds.scriptTracks ?? {})) {
    if (ladder[0]?.min !== 0 || ladder.some((l, i) => i > 0 && l.min <= ladder[i - 1]!.min)) {
      errors.push(`scriptTracks.${name} must start at 0 and strictly increase`);
    }
  }
  const levelIdx = seeds.categoryLevels.map((l) => l.index);
  if (levelIdx.some((v, i) => v !== i)) errors.push("categoryLevels must be indexed 0..n in order");

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    registry: {
      packs: packs.map((p) => ({ id: p.id, version: p.version })),
      skills,
      skillById,
      activityTypes,
      activityTypeById,
      achievements,
      achievementById,
      islands,
      islandById,
      seeds,
    },
  };
}

/** Same as buildRegistry but throws; for the bundled packs, which must always be valid. */
export function buildRegistryOrThrow(rawPacks: unknown[]): ContentRegistry {
  const result = buildRegistry(rawPacks);
  if (!result.ok) throw new Error(`Invalid content packs:\n${result.errors.join("\n")}`);
  return result.registry;
}

function indexUnique<T extends { id: string }>(items: T[], label: string, errors: string[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of items) {
    if (out[item.id]) errors.push(`Duplicate ${label} id "${item.id}"`);
    out[item.id] = item;
  }
  return out;
}

function checkWeights(
  where: string,
  weights: Record<string, number>,
  skillById: Record<string, SkillDef>,
  errors: string[],
): void {
  let total = 0;
  for (const [skillId, w] of Object.entries(weights)) {
    if (!skillById[skillId]) errors.push(`${where}: unknown skill "${skillId}" in weights`);
    total += w;
  }
  if (Math.abs(total - WEIGHT_TOTAL) > 1e-9) errors.push(`${where}: skill weights sum to ${total}, expected ${WEIGHT_TOTAL}`);
}

function mergeSeeds(packs: ContentPack[]): Seeds {
  const seeds: Seeds = {
    carriers: [],
    knowledgeCategories: [],
    categoryLevels: [],
    objectionCases: [],
    rapportScenarios: [],
    catalog: [],
  };
  for (const pack of packs) {
    seeds.carriers.push(...pack.seeds.carriers);
    seeds.knowledgeCategories.push(...pack.seeds.knowledgeCategories);
    seeds.objectionCases.push(...pack.seeds.objectionCases);
    seeds.rapportScenarios.push(...pack.seeds.rapportScenarios);
    seeds.catalog.push(...pack.seeds.catalog);
    // Level ladders and the script template are whole-object: a later pack replaces them.
    if (pack.seeds.categoryLevels.length > 0) seeds.categoryLevels = pack.seeds.categoryLevels;
    if (pack.seeds.scriptTemplate) seeds.scriptTemplate = pack.seeds.scriptTemplate;
    if (pack.seeds.scriptTracks) seeds.scriptTracks = pack.seeds.scriptTracks;
  }
  return seeds;
}
