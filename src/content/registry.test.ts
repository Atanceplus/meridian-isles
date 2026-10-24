import { describe, expect, it } from "vitest";
import { BUNDLED_PACKS, CORE_SKILLS, buildRegistry, loadBundledRegistry } from ".";
import { corePack } from "./packs/core";
import { finalExpensePack } from "./packs/finalExpense";

describe("bundled packs", () => {
  const registry = loadBundledRegistry();

  it("load and validate", () => {
    expect(registry.packs.map((p) => p.id)).toEqual(["core", "fe"]);
    expect(registry.skills).toHaveLength(5);
  });

  it("use the required Speed rank names", () => {
    expect(registry.skillById[CORE_SKILLS.speed]!.ranks.map((r) => r.name)).toEqual([
      "Snail",
      "Jackrabbit",
      "Cheetah",
      "Bullet Train",
      "Lightspeed",
    ]);
  });

  it("ship exactly the requested carrier labels, with no invented roles", () => {
    expect(registry.seeds.carriers.map((c) => c.label)).toEqual([
      "Americo",
      "Mutual of Omaha",
      "Instabrain",
      "Chubb",
      "American Amicable",
      "Transamerica",
      "Corebridge",
      "Aetna",
    ]);
    expect(registry.seeds.carriers.every((c) => c.kind === "unspecified")).toBe(true);
  });

  it("separate carrier-wide and product-specific categories", () => {
    const scopes = registry.seeds.knowledgeCategories.map((c) => c.scope);
    expect(scopes.filter((s) => s === "carrier")).toHaveLength(3);
    expect(scopes.filter((s) => s === "product")).toHaveLength(6);
  });

  it("patch Product Knowledge gates from the Final Expense pack", () => {
    const pk = registry.skillById[CORE_SKILLS.productKnowledge]!;
    expect(pk.ranks.slice(1).map((r) => r.gate.achievementIds)).toEqual([
      ["fe:ach.pk.first-charts"],
      ["fe:ach.pk.navigators-log"],
      ["fe:ach.pk.cartographers-atlas"],
      ["fe:ach.pk.admiralty"],
    ]);
    // The source pack object is not mutated by patching.
    expect(corePack.skills?.find((s) => s.id === CORE_SKILLS.productKnowledge)?.ranks[1]?.gate?.achievementIds).toEqual([]);
  });

  it("give every promotion past rank 1 a gate achievement", () => {
    for (const skill of registry.skills) {
      for (const rank of skill.ranks.slice(1)) expect(rank.gate.achievementIds.length).toBeGreaterThan(0);
    }
  });

  it("make Speed and Product Knowledge one-year skills", () => {
    for (const id of [CORE_SKILLS.speed, CORE_SKILLS.productKnowledge]) {
      expect(registry.skillById[id]!.ranks[4]!.gate).toMatchObject({ minElapsedDays: 365, minActiveWeeks: 44 });
    }
  });

  it("give Product Knowledge at least three contributing activity types for breadth", () => {
    const pkTypes = registry.activityTypes.filter((a) => CORE_SKILLS.productKnowledge in a.skillWeights);
    expect(pkTypes.length).toBeGreaterThanOrEqual(3);
  });
});

describe("validation", () => {
  const clone = <T>(x: T): T => structuredClone(x);

  it("rejects weights that do not sum to 100", () => {
    const fe = clone(finalExpensePack);
    fe.activityTypes![0]!.skillWeights = { [CORE_SKILLS.productKnowledge]: 90 };
    const result = buildRegistry([corePack, fe]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toMatch(/sum to 90/);
  });

  it("rejects unknown skill references and missing gate achievements", () => {
    const core = clone(corePack);
    core.activityTypes![0]!.skillWeights = { "core:skill.nope": 100 };
    core.skills![0]!.ranks[1]!.gate = { achievementIds: ["core:ach.missing"] };
    const result = buildRegistry([core, finalExpensePack]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(/unknown skill "core:skill.nope"/);
      expect(result.errors.join("\n")).toMatch(/unknown gate achievement "core:ach.missing"/);
    }
  });

  it("rejects ids outside the pack's namespace", () => {
    const fe = clone(finalExpensePack);
    fe.seeds!.carriers![0]!.id = "core:carrier.sneaky";
    const result = buildRegistry([corePack, fe]);
    expect(result.ok).toBe(false);
  });

  it("rejects a pack whose required pack is missing", () => {
    const result = buildRegistry([finalExpensePack]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toMatch(/requires missing pack "core"/);
  });

  it("rejects non-increasing rank thresholds", () => {
    const core = clone(corePack);
    core.skills![0]!.ranks[2]!.threshold = 500;
    expect(buildRegistry([core, finalExpensePack]).ok).toBe(false);
  });

  it("reports schema errors with paths instead of throwing", () => {
    const result = buildRegistry([{ format: "meridian-pack", id: "x" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/^pack\[0\]/);
  });

  it("accepts the bundled set as-is", () => {
    expect(buildRegistry(BUNDLED_PACKS).ok).toBe(true);
  });
});
