import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../persistence/storage";
import { CommandService } from "../records/commands";
import { registry } from "../test/helpers";
import { buildWorldState, restoredSince } from "./restoration";

async function setup() {
  let n = 0;
  const svc = new CommandService(new MemoryStorage(), registry, () => "2027-01-04T18:00:00", () => `id${++n}`);
  const id = (await svc.createInstance("Main")).id;
  return { svc, id };
}

describe("buildWorldState", () => {
  it("starts with every island ruined and HQ as a camp", async () => {
    const { svc, id } = await setup();
    const { bundle, state, ruleset } = await svc.load(id);
    const world = buildWorldState(bundle, state, registry, ruleset, "2027-01-04");
    expect(Object.values(world.islands).every((i) => i.level === 0)).toBe(true);
    expect(world).toMatchObject({ hqTier: 0, rankSum: 5, landmarks: [] });
    expect(world.islands["fe:island.carrier-archipelago"]!.islets).toHaveLength(8);
  });

  it("follows skill ranks, HQ tiers and landmarks", async () => {
    const { svc, id } = await setup();
    const { bundle, state, ruleset } = await svc.load(id);
    const ranked = structuredClone(state);
    ranked.skills["core:skill.tonality"]!.rank = 5;
    ranked.skills["core:skill.speed"]!.rank = 4;
    ranked.skills["core:skill.small-talk"]!.rank = 3;
    const world = buildWorldState(bundle, ranked, registry, ruleset, "2027-01-04");
    expect(world.islands["core:island.last-broadcast"]!.level).toBe(4);
    expect(world.islands["core:island.velocity-circuit"]!.level).toBe(3);
    expect(world.islands["core:island.conversation-cove"]!.level).toBe(2);
    expect(world.rankSum).toBe(5 + 4 + 3 + 1 + 1);
    expect(world.hqTier).toBe(2); // 14 → Homestead
    expect(world.landmarks.map((l) => l.id)).toEqual(["antenna", "radio-tower", "monorail"]);
  });

  it("restores the Foundry from both tracks", async () => {
    const { svc, id } = await setup();
    for (let i = 0; i < 4; i++) {
      await svc.logActivity(id, "core:act.script-rehearsal", { minutes: 45, sections: ["opener"] }, { occurredAt: `2027-01-0${i + 1}T10:00`, mode: "aloud" });
    }
    const { bundle, state, ruleset } = await svc.load(id);
    // 180 credited minutes → Reader (1 of 5); craft 0 → average 0.5 of 5 → level 0
    expect(buildWorldState(bundle, state, registry, ruleset, "2027-01-04").islands["core:island.script-foundry"]!.level).toBe(0);
  });

  it("reports islands restored since the last visit", () => {
    const world = { islands: { a: { islandId: "a", level: 2 as const }, b: { islandId: "b", level: 1 as const } }, hqTier: 0 as const, landmarks: [], rankSum: 5, decorations: [] };
    expect(restoredSince({ a: 1, b: 1 }, world)).toEqual([{ islandId: "a", from: 1, to: 2 }]);
    expect(restoredSince(null, world)).toEqual([]);
  });
});
