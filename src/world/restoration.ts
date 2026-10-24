import type { ContentRegistry } from "../content/registry";
import type { ProgressState, Ruleset } from "../domain";
import type { InstanceBundle, UpgradeCategory } from "../persistence/types";
import { buildCurriculumView } from "../records/curriculum";
import { REHEARSAL_TYPE, creditedRehearsalMinutes, meaningfulCount, trackLevel } from "../records/script";

/**
 * How restored the world is. Every value comes from progress that never goes
 * backwards (ranks, peak category levels, track levels), so restoration never
 * regresses. Lapsed reviews show up as "review due" in the Archipelago, not as
 * damage on the map.
 */

export type RestorationLevel = 0 | 1 | 2 | 3 | 4;
export const RESTORATION_NAMES = ["Ruined", "Stirring", "Rebuilding", "Thriving", "Legendary"] as const;
export const HQ_TIER_NAMES = ["Camp", "Cabin", "Homestead", "Manor", "Estate"] as const;

export interface Landmark {
  id: string;
  skillId: string;
  rank: 4 | 5;
  name: string;
}

/** Landmarks each Rank 4 and Rank 5 promotion sends home to HQ. */
export const LANDMARKS: Landmark[] = [
  { id: "antenna", skillId: "core:skill.tonality", rank: 4, name: "Broadcast antenna" },
  { id: "radio-tower", skillId: "core:skill.tonality", rank: 5, name: "Golden radio tower" },
  { id: "harbor-fort", skillId: "core:skill.product-knowledge", rank: 4, name: "Harbor fort" },
  { id: "flagship", skillId: "core:skill.product-knowledge", rank: 5, name: "Admiral's flagship" },
  { id: "scales", skillId: "core:skill.objection-handling", rank: 4, name: "Bronze scales" },
  { id: "dome", skillId: "core:skill.objection-handling", rank: 5, name: "Hall of Justice dome" },
  { id: "lighthouse", skillId: "core:skill.small-talk", rank: 4, name: "Lighthouse café" },
  { id: "hearth", skillId: "core:skill.small-talk", rank: 5, name: "Hearth lantern square" },
  { id: "monorail", skillId: "core:skill.speed", rank: 4, name: "Monorail station" },
  { id: "spire", skillId: "core:skill.speed", rank: 5, name: "Lightspeed spire" },
];

export interface IslandRestoration {
  islandId: string;
  level: RestorationLevel;
  /** For the Archipelago: each shown carrier's islet. */
  islets?: { key: string; label: string; level: RestorationLevel }[];
}

export interface WorldState {
  islands: Record<string, IslandRestoration>;
  hqTier: RestorationLevel;
  landmarks: Landmark[];
  /** Sum of the five ranks (5–25), which drives the HQ tier. */
  rankSum: number;
  /** Purchase categories decorating HQ's waterfront. Cosmetic only. */
  decorations: UpgradeCategory[];
}

/** Waterfront decorations, in drawing order. */
export const DECORATION_ORDER: UpgradeCategory[] = ["leads", "crm", "dialer", "training", "equipment", "service", "other"];

/** HQ tier from the sum of all five ranks: 5–7 Camp … 22–25 Estate. */
export const HQ_TIER_THRESHOLDS = [5, 8, 12, 17, 22] as const;

export function buildWorldState(bundle: InstanceBundle, state: ProgressState, registry: ContentRegistry, ruleset: Ruleset, today: string): WorldState {
  const islands: Record<string, IslandRestoration> = {};
  const rank = (skillId: string) => state.skills[skillId]?.rank ?? 1;

  for (const island of registry.islands) {
    switch (island.restorationSource) {
      case "skill":
        islands[island.id] = { islandId: island.id, level: clamp(rank(island.skillIds[0]!) - 1) };
        break;
      case "scriptTracks": {
        const tracks = registry.seeds.scriptTracks;
        if (!tracks) {
          islands[island.id] = { islandId: island.id, level: 0 };
          break;
        }
        const craft = trackLevel(tracks.craft, meaningfulCount(bundle.scriptVersions)).index;
        const rehearsal = trackLevel(tracks.rehearsal, creditedRehearsalMinutes(bundle.activities, bundle.ledger, registry.activityTypeById[REHEARSAL_TYPE]?.limits.daily)).index;
        const top = Math.min(tracks.craft.length, tracks.rehearsal.length) - 1;
        // Average of both tracks, scaled from their ladder onto the five restoration levels.
        islands[island.id] = { islandId: island.id, level: clamp(Math.floor(((craft + rehearsal) / 2 / top) * 4 + 1e-9)) };
        break;
      }
      case "carriers": {
        const view = buildCurriculumView(bundle, registry, today);
        const active = view.carriers.filter((c) => !c.carrier.archived);
        const islets = active.slice(0, 8).map((c) => ({ key: c.carrier.key, label: c.carrier.label, level: clamp(c.peak) }));
        const avg = islets.length ? islets.reduce((n, i) => n + i.level, 0) / islets.length : 0;
        islands[island.id] = { islandId: island.id, level: clamp(Math.floor(avg + 1e-9)), islets };
        break;
      }
      case "hq":
        break;
    }
  }

  const rankSum = ruleset.skillOrder.reduce((n, id) => n + rank(id), 0);
  const hqTier = clamp(HQ_TIER_THRESHOLDS.filter((t) => rankSum >= t).length - 1);
  const landmarks = LANDMARKS.filter((l) => rank(l.skillId) >= l.rank);
  const hq = registry.islands.find((i) => i.restorationSource === "hq");
  if (hq) islands[hq.id] = { islandId: hq.id, level: hqTier };
  const owned = new Set(bundle.ownedUpgrades.filter((u) => !u.archived).map((u) => u.category));
  const decorations = DECORATION_ORDER.filter((c) => owned.has(c));
  return { islands, hqTier, landmarks, rankSum, decorations };
}

function clamp(n: number): RestorationLevel {
  return Math.max(0, Math.min(4, Math.floor(n))) as RestorationLevel;
}

/** Islands whose level rose since the levels last seen (for the restoration time-lapse). */
export function restoredSince(previous: Record<string, number> | null, current: WorldState): { islandId: string; from: number; to: number }[] {
  if (!previous) return [];
  return Object.values(current.islands)
    .filter((i) => previous[i.islandId] !== undefined && i.level > previous[i.islandId]!)
    .map((i) => ({ islandId: i.islandId, from: previous[i.islandId]!, to: i.level }));
}
