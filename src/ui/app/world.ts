import { useMemo } from "react";
import type { ContentRegistry } from "../../content";
import { todayLocal } from "../../records/clock";
import { HQ_TIER_NAMES, RESTORATION_NAMES, buildWorldState, type WorldState } from "../../world/restoration";
import { useApp, useView } from "./context";

/** The current map's restoration state, shared by the world map, island cards and island pages. */
export function useWorld(): WorldState {
  const { registry } = useApp();
  const { bundle, state, ruleset } = useView();
  return useMemo(() => buildWorldState(bundle, state, registry, ruleset, todayLocal()), [bundle, state, registry, ruleset]);
}

export function levelName(islandId: string, registry: ContentRegistry, world: WorldState): string {
  return registry.islandById[islandId]?.restorationSource === "hq" ? HQ_TIER_NAMES[world.hqTier] : RESTORATION_NAMES[world.islands[islandId]?.level ?? 0];
}

/** What restores an island, in a sentence. */
export function restorationHint(islandId: string, registry: ContentRegistry, world: WorldState): string {
  const island = registry.islandById[islandId];
  if (!island) return "";
  switch (island.restorationSource) {
    case "hq":
      return `Grows with the total of your five ranks (now ${world.rankSum} of 25).`;
    case "skill":
      return `Restores as ${island.skillIds.map((s) => registry.skillById[s]?.name).join(", ")} ranks up.`;
    case "scriptTracks":
      return "Restores with your Craft and Rehearsal tracks.";
    case "carriers": {
      const islets = world.islands[islandId]?.islets ?? [];
      return `Each stronghold clears as its carrier is charted (${islets.filter((i) => i.level >= 2).length}/${islets.length} charted).`;
    }
  }
}
