import { describe, expect, it } from "vitest";
import { advanceTime, applyActivity, EngineError, reverseActivity } from "./engine";
import { countActiveWeeks, gateConditions } from "./gates";
import { createInitialState } from "./state";
import { ACT, SK, SPEED_ACH, Sim, dayAt, rec, ruleset, smallSpeedRuleset, sum } from "../../test/helpers";

const MON = "2027-01-04"; // a Monday
const noGate = { gate: { achievementIds: [], minElapsedDays: 0, minActiveWeeks: 0 } };
const noGateNoBreadth = { gate: { achievementIds: [], minElapsedDays: 0, minActiveWeeks: 0, breadth: null } };

describe("contribution weights", () => {
  it("splits one record across skills by weight", () => {
    const sim = new Sim(ruleset());
    sim.log(rec(ACT.callReport, 2, dayAt(MON, 0, "18:00")));
    // 2 h × 12 XP = 24 XP → Speed 40%, others 20%
    expect(sum(sim.lines, SK.speed, "awarded")).toBe(9.6);
    expect(sum(sim.lines, SK.tonality, "awarded")).toBe(4.8);
    expect(sum(sim.lines, SK.objections, "awarded")).toBe(4.8);
    expect(sum(sim.lines, SK.smallTalk, "awarded")).toBe(4.8);
    expect(sum(sim.lines, SK.productKnowledge)).toBe(0);
  });

  it("applies mode multipliers and mode-specific weights", () => {
    const sim = new Sim(ruleset());
    sim.log(rec(ACT.rehearsal, 20, dayAt(MON, 0), { mode: "recorded" })); // 20 × 3 × 1.25 = 75
    expect(sum(sim.lines, SK.speed)).toBe(37.5);
    sim.log(rec(ACT.timeTrial, 1, dayAt(MON, 0, "11:00"), { mode: "script", personalBest: true })); // 15 + 10
    expect(sum(sim.lines, SK.speed)).toBe(37.5 + 17.5);
    expect(sum(sim.lines, SK.tonality)).toBe(37.5 + 7.5);
  });

  it("explains every award", () => {
    const sim = new Sim(ruleset());
    const lines = sim.log(rec(ACT.rehearsal, 120, dayAt(MON, 0), { mode: "aloud" }));
    const reduced = lines.find((l) => l.skillId === SK.speed && l.status === "reduced")!;
    expect(reduced.explanation.join(" | ")).toMatch(/120 minutes × 3 XP = 360 XP/);
    expect(reduced.explanation.join(" | ")).toMatch(/daily limit: 67.5 of 120 minutes credited/);
    expect(reduced.rulesetVersion).toBe(sim.rules.version);
  });
});

describe("daily and weekly limits", () => {
  it("gives full, then half, then no credit within a day", () => {
    const sim = new Sim(ruleset());
    // Rehearsal: 45 min full, 45–90 at 50%, beyond 0 → 67.5 credited minutes of 120
    sim.log(rec(ACT.rehearsal, 120, dayAt(MON, 0), { mode: "aloud" }));
    expect(sum(sim.lines, SK.speed, "reduced")).toBe(101.25);
    expect(sum(sim.lines, SK.speed, "blocked:limit")).toBe(78.75);
  });

  it("shares the daily limit between separate records and resets the next day", () => {
    const sim = new Sim(ruleset());
    sim.log(rec(ACT.rehearsal, 30, dayAt(MON, 0, "09:00"), { mode: "aloud" }));
    const second = sim.log(rec(ACT.rehearsal, 30, dayAt(MON, 0, "15:00"), { mode: "aloud" }));
    expect(sum(second, SK.speed, "reduced")).toBe(33.75); // 15 full + 15 half = 22.5 min × 3 / 2
    const nextDay = sim.log(rec(ACT.rehearsal, 30, dayAt(MON, 1), { mode: "aloud" }));
    expect(sum(nextDay, SK.speed, "awarded")).toBe(45);
  });

  it("limits reps per objection case without limiting other cases", () => {
    const sim = new Sim(ruleset());
    const a = sim.log(rec(ACT.objectionPractice, 12, dayAt(MON, 0, "09:00"), { subjectKey: "fe:objection.too-expensive", mode: "spoken" }));
    const b = sim.log(rec(ACT.objectionPractice, 12, dayAt(MON, 0, "09:30"), { subjectKey: "fe:objection.think-about-it", mode: "spoken" }));
    // 10 of 12 reps credited each: 40 XP → Objections 32
    expect(sum(a, SK.objections, "reduced")).toBe(32);
    expect(sum(b, SK.objections, "reduced")).toBe(32);
  });

  it("applies each skill's weekly limit", () => {
    const sim = new Sim(ruleset());
    // Tonality drills: 40 min/day = 120 Tonality XP; weekly 300 full, 300–450 at half
    const days = [0, 1, 2, 3, 4].map((d) => sim.log(rec(ACT.tonalityDrill, 40, dayAt(MON, d))));
    expect(days.map((l) => sum(l, SK.tonality, "awarded") + sum(l, SK.tonality, "reduced"))).toEqual([120, 120, 90, 45, 0]);
    expect(sum(days[4]!, SK.tonality, "blocked:limit")).toBe(120);
    // New week resets
    const monday = sim.log(rec(ACT.tonalityDrill, 40, dayAt(MON, 7)));
    expect(sum(monday, SK.tonality, "awarded")).toBe(120);
  });

  it("limits meaningful script revisions per day and per week", () => {
    const sim = new Sim(ruleset());
    const got = [
      [0, "09:00"],
      [0, "10:00"],
      [0, "11:00"], // 3rd today → 0, but still the 3rd logged this week
      [1, "09:00"], // 4th this week
      [1, "10:00"], // 5th this week → 0
    ].map(([d, t]) => sum(sim.log(rec(ACT.revision, 1, dayAt(MON, d as number, t as string))), SK.speed, "awarded"));
    // Every logged unit counts toward every limit, even one another limit already zeroed.
    expect(got).toEqual([12.5, 12.5, 0, 12.5, 0]);
  });
});

describe("hard promotion caps", () => {
  it("stops a skill at the threshold, keeps recording, and pays other skills", () => {
    const sim = new Sim(smallSpeedRuleset());
    // Script time trials: 5 runs = 75 XP → Speed 52.5, Tonality 22.5
    sim.log(rec(ACT.timeTrial, 5, dayAt(MON, 0), { mode: "script" }));
    const day2 = sim.log(rec(ACT.timeTrial, 5, dayAt(MON, 1), { mode: "script" }));

    expect(sim.skill(SK.speed).score).toBe(100);
    expect(sim.skill(SK.speed).rank).toBe(1);
    expect(sum(day2, SK.speed, "awarded")).toBe(47.5);
    expect(sum(day2, SK.speed, "blocked:cap")).toBe(5);
    expect(sum(day2, SK.tonality, "awarded")).toBe(22.5);
    expect(day2.find((l) => l.status === "blocked:cap")!.explanation.join(" ")).toMatch(/capped at 100 until the Jackrabbit/);
  });

  it("never awards blocked XP retroactively when the achievement is completed later", () => {
    const sim = new Sim(smallSpeedRuleset());
    for (const d of [0, 1, 2, 3]) sim.log(rec(ACT.timeTrial, 5, dayAt(MON, d)));
    expect(sim.skill(SK.speed).score).toBe(100);
    expect(sim.skill(SK.speed).blockedByCap).toBe(200);

    sim.complete(SPEED_ACH[0], dayAt(MON, 4, "09:00"));
    expect(sim.skill(SK.speed).rank).toBe(2);
    expect(sim.skill(SK.speed).score).toBe(100); // nothing released
    expect(sim.promotions).toEqual([{ skillId: SK.speed, toRank: 2, at: dayAt(MON, 4, "09:00") }]);

    sim.log(rec(ACT.timeTrial, 5, dayAt(MON, 4, "10:00")));
    expect(sim.skill(SK.speed).score).toBe(175);
  });

  it("lets an achievement completed early count when the score arrives", () => {
    const sim = new Sim(smallSpeedRuleset());
    sim.complete(SPEED_ACH[0], dayAt(MON, 0, "08:00"));
    expect(sim.skill(SK.speed).rank).toBe(1); // evidence stored, score not there yet
    sim.log(rec(ACT.timeTrial, 5, dayAt(MON, 0)));
    sim.log(rec(ACT.timeTrial, 5, dayAt(MON, 1)));
    expect(sim.skill(SK.speed).rank).toBe(2);
    expect(sim.skill(SK.speed).score).toBe(150);
    expect(sim.lines.some((l) => l.status === "blocked:cap")).toBe(false);
  });

  it("holds a promotion until elapsed time and active weeks are both met", () => {
    const run = (weeks: number) => {
      const sim = new Sim(smallSpeedRuleset());
      sim.complete(SPEED_ACH[0], dayAt(MON, 0, "08:00"));
      sim.complete(SPEED_ACH[1], dayAt(MON, 0, "08:01"));
      for (let w = 0; w < weeks; w++) {
        for (const d of [0, 1, 2]) {
          sim.log(rec(ACT.callReport, 1, dayAt(MON, w * 7 + d, "09:00")));
          sim.log(rec(ACT.timeTrial, 2, dayAt(MON, w * 7 + d, "10:00")));
        }
      }
      return sim;
    };

    const sim = run(8);
    expect(sim.skill(SK.speed).rank).toBe(2);
    expect(sim.skill(SK.speed).score).toBe(300);
    expect(sim.skill(SK.speed).blockedByCap).toBeGreaterThan(0);
    expect(countActiveWeeks(sim.skill(SK.speed), sim.rules.skills[SK.speed]!.activeWeek)).toBe(8);

    let result = advanceTime(sim.state, dayAt(MON, 59), sim.rules);
    expect(result.state.skills[SK.speed]!.rank).toBe(2);
    result = advanceTime(result.state, dayAt(MON, 60), sim.rules);
    expect(result.promotions).toEqual([{ skillId: SK.speed, toRank: 3, at: dayAt(MON, 60) }]);
    expect(result.state.skills[SK.speed]!.score).toBe(300);

    // Time alone is not enough: with only 7 active weeks, day 70 still doesn't promote.
    const short = run(7);
    const later = advanceTime(short.state, dayAt(MON, 70), short.rules);
    expect(later.state.skills[SK.speed]!.rank).toBe(2);
    const conditions = gateConditions(later.state, short.rules, SK.speed, 3, dayAt(MON, 70));
    expect(conditions.find((c) => c.kind === "activeWeeks")).toMatchObject({ met: false, current: 7, required: 8 });
  });

  it("does not count one long session as an active week", () => {
    const sim = new Sim(ruleset());
    sim.log(rec(ACT.callReport, 8, dayAt(MON, 0, "18:00")));
    sim.log(rec(ACT.timeTrial, 8, dayAt(MON, 0, "19:00")));
    expect(countActiveWeeks(sim.skill(SK.speed), sim.rules.skills[SK.speed]!.activeWeek)).toBe(0);
  });

  it("requires breadth, measured on practice so a capped skill can still satisfy it", () => {
    const sim = new Sim(smallSpeedRuleset({ "2": noGate, "3": noGate, "4": noGate }));
    for (let d = 0; d < 10; d++) sim.log(rec(ACT.timeTrial, 5, dayAt(MON, d)));
    expect(sim.skill(SK.speed).rank).toBe(3);
    expect(sim.skill(SK.speed).score).toBe(600);

    const breadth = () => gateConditions(sim.state, sim.rules, SK.speed, 4, dayAt(MON, 20)).find((c) => c.kind === "breadth")!;
    expect(breadth().met).toBe(false);

    for (let d = 10; d < 14; d++) {
      sim.log(rec(ACT.rehearsal, 45, dayAt(MON, d, "09:00"), { mode: "aloud" }));
      sim.log(rec(ACT.appNav, 6, dayAt(MON, d, "10:00")));
    }
    expect(sim.skill(SK.speed).rank).toBe(3); // time trials still > 60% of practice
    sim.log(rec(ACT.rehearsal, 45, dayAt(MON, 14, "09:00"), { mode: "aloud" }));
    expect(sim.skill(SK.speed).rank).toBe(4);
    // Only XP from the promoting record onward is added; earlier blocked XP stays blocked.
    expect(sim.skill(SK.speed).score).toBe(600 + 67.5);
  });

  it("sends XP beyond the maximum to Legacy", () => {
    const sim = new Sim(smallSpeedRuleset({ "2": noGateNoBreadth, "3": noGateNoBreadth, "4": noGateNoBreadth, "5": noGateNoBreadth }));
    for (let d = 0; d < 15; d++) sim.log(rec(ACT.timeTrial, 5, dayAt(MON, d)));
    expect(sim.skill(SK.speed).rank).toBe(5);
    expect(sim.skill(SK.speed).score).toBe(1000);
    expect(sim.skill(SK.speed).legacy).toBe(125);
    expect(sum(sim.lines, SK.speed, "legacy")).toBe(125);
  });
});

describe("reversals", () => {
  it("removes exactly what a record added, including its limit usage and active-week activity", () => {
    const sim = new Sim(ruleset());
    const r1 = rec(ACT.tonalityDrill, 40, dayAt(MON, 0, "09:00"));
    sim.log(r1);
    const before = structuredClone(sim.state);
    const r2 = rec(ACT.tonalityDrill, 40, dayAt(MON, 0, "10:00"));
    sim.log(r2);
    const { state, lines } = reverseActivity(sim.state, r2.id, dayAt(MON, 0, "11:00"), sim.rules);

    // The second 40 minutes fell in the half-rate band: 20 credited minutes × 3 XP
    expect(lines).toEqual([expect.objectContaining({ status: "reversed", amount: -60, typeId: ACT.tonalityDrill })]);
    expect(state.skills[SK.tonality]).toEqual(before.skills[SK.tonality]);
    expect(state.usage).toEqual(before.usage);
    expect(state.weeklySkillCredit).toEqual(before.weeklySkillCredit);
    expect(state.contributions[r2.id]).toBeUndefined();
    expect(() => reverseActivity(state, r2.id, dayAt(MON, 0, "12:00"), sim.rules)).toThrow(/already reversed/);
  });

  it("never demotes and never releases cap-blocked XP", () => {
    const sim = new Sim(smallSpeedRuleset());
    sim.complete(SPEED_ACH[0], dayAt(MON, 0, "08:00"));
    const big = rec(ACT.timeTrial, 5, dayAt(MON, 0));
    sim.log(big); // 75
    sim.log(rec(ACT.timeTrial, 5, dayAt(MON, 1))); // 150, rank 2
    expect(sim.skill(SK.speed).rank).toBe(2);
    const { state, lines } = reverseActivity(sim.state, big.id, dayAt(MON, 1, "12:00"), sim.rules);
    expect(state.skills[SK.speed]!.rank).toBe(2);
    expect(state.skills[SK.speed]!.score).toBe(100); // floor at the Jackrabbit threshold
    expect(lines[0]!.amount).toBe(-50);
    expect(lines[0]!.explanation.join(" ")).toMatch(/keeps its Jackrabbit rank/);
  });

  it("does nothing to progress for a record that was too late to count", () => {
    const sim = new Sim(ruleset());
    const late = rec(ACT.tonalityDrill, 30, "2027-01-01T10:00:00", { recordedAt: "2027-01-20T10:00:00" });
    sim.log(late);
    const { state, lines } = reverseActivity(sim.state, late.id, "2027-01-20T11:00:00", sim.rules);
    expect(lines).toEqual([]);
    expect(state.reversedRecordIds[late.id]).toBe(true);
  });
});

describe("record integrity", () => {
  it("stores late records without awarding XP", () => {
    const sim = new Sim(ruleset());
    const lines = sim.log(rec(ACT.tonalityDrill, 30, "2027-01-01T10:00:00", { recordedAt: "2027-01-10T10:00:00" }));
    expect(lines.every((l) => l.status === "ineligible:backdated")).toBe(true);
    expect(sim.skill(SK.tonality).score).toBe(0);
    expect(sim.state.journeyStart).toBeNull();
    expect(sim.state.appliedRecordIds[lines[0]!.recordId]).toBe(true);

    const ok = sim.log(rec(ACT.tonalityDrill, 30, "2027-01-03T10:00:00", { recordedAt: "2027-01-10T11:00:00" }));
    expect(sum(ok, SK.tonality, "awarded")).toBe(90);
  });

  it("refuses to apply the same record twice", () => {
    const rules = ruleset();
    const record = rec(ACT.tonalityDrill, 30, dayAt(MON, 0));
    const once = applyActivity(createInitialState(rules), record, rules).state;
    expect(() => applyActivity(once, { ...record, recordedAt: dayAt(MON, 1) }, rules)).toThrow(EngineError);
  });

  it("refuses out-of-order events, future-dated records, unknown modes and bad units", () => {
    const rules = ruleset();
    const s = applyActivity(createInitialState(rules), rec(ACT.tonalityDrill, 30, dayAt(MON, 2)), rules).state;
    expect(() => applyActivity(s, rec(ACT.tonalityDrill, 30, dayAt(MON, 1)), rules)).toThrow(/in order/);
    expect(() => applyActivity(s, rec(ACT.tonalityDrill, 30, dayAt(MON, 5), { recordedAt: dayAt(MON, 3) }), rules)).toThrow(/after it was recorded/);
    expect(() => applyActivity(s, rec(ACT.rehearsal, 30, dayAt(MON, 3), { mode: "shouting" }), rules)).toThrow(/no mode/);
    expect(() => applyActivity(s, rec(ACT.rehearsal, 0, dayAt(MON, 3)), rules)).toThrow(/positive units/);
  });

  it("does not mutate the input state", () => {
    const rules = ruleset();
    const initial = createInitialState(rules);
    const snapshot = JSON.stringify(initial);
    applyActivity(initial, rec(ACT.callReport, 3, dayAt(MON, 0)), rules);
    expect(JSON.stringify(initial)).toBe(snapshot);
  });
});
