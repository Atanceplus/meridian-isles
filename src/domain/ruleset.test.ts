import { describe, expect, it } from "vitest";
import { buildRuleset } from "./ruleset";
import { ACT, SK, registry } from "../test/helpers";

describe("buildRuleset", () => {
  it("uses design defaults and a stable version", () => {
    const rules = buildRuleset(registry);
    expect(rules.version).toBe("core@0.1.0+fe@0.1.0#default");
    expect(rules.general).toEqual({ backdateDays: 7, weekStartsOn: 1 });
    expect(rules.lightspeed).toMatchObject({ windowMinutes: 30, salesRequired: 10, retentionMonths: 3, checkpointAnchor: "submission" });
  });

  it("applies overrides and changes the version", () => {
    const rules = buildRuleset(registry, {
      general: { backdateDays: 3 },
      skills: { [SK.speed]: { ranks: { "5": { gate: { minElapsedDays: 300 } } } } },
      activityTypes: { [ACT.timeTrial]: { xpPerUnit: 20 } },
    });
    expect(rules.general.backdateDays).toBe(3);
    expect(rules.skills[SK.speed]!.ranks[4]!.gate.minElapsedDays).toBe(300);
    expect(rules.skills[SK.speed]!.ranks[4]!.gate.minActiveWeeks).toBe(44); // untouched
    expect(rules.activityTypes[ACT.timeTrial]!.xpPerUnit).toBe(20);
    expect(rules.version).not.toBe(buildRuleset(registry).version);
    // Same overrides in a different key order produce the same version.
    const again = buildRuleset(registry, {
      activityTypes: { [ACT.timeTrial]: { xpPerUnit: 20 } },
      skills: { [SK.speed]: { ranks: { "5": { gate: { minElapsedDays: 300 } } } } },
      general: { backdateDays: 3 },
    });
    expect(again.version).toBe(rules.version);
  });

  it("does not mutate the registry", () => {
    buildRuleset(registry, { skills: { [SK.speed]: { ranks: { "2": { threshold: 5 } } } } });
    expect(registry.skillById[SK.speed]!.ranks[1]!.threshold).toBe(1000);
  });

  it("can remove a breadth requirement with null", () => {
    const rules = buildRuleset(registry, { skills: { [SK.speed]: { ranks: { "4": { gate: { breadth: null } } } } } });
    expect(rules.skills[SK.speed]!.ranks[3]!.gate.breadth).toBeUndefined();
  });

  it("rejects invalid overrides", () => {
    expect(() => buildRuleset(registry, { activityTypes: { [ACT.timeTrial]: { skillWeights: { [SK.speed]: 50 } } } })).toThrow(/sum to 50/);
    expect(() => buildRuleset(registry, { skills: { "core:skill.nope": {} } })).toThrow(/unknown skill/);
    expect(() => buildRuleset(registry, { skills: { [SK.speed]: { ranks: { "3": { threshold: 50 } } } } })).toThrow(/strictly increase/);
  });
});
