import { describe, expect, it } from "vitest";
import { advanceTime } from "./engine";
import { ACT, SK, SPEED_ACH, Sim, dayAt, rec, ruleset } from "../../test/helpers";

/**
 * One-year calibration checks with the real default ruleset. These are the
 * design's claims about Speed (Product Knowledge shares the same gate shape).
 */

const START = "2027-01-04"; // Monday; day 365 is 2028-01-04

describe("one-year calibration (Speed)", () => {
  it("a maximal daily grinder still cannot reach Lightspeed before 365 days", () => {
    const sim = new Sim(ruleset());
    SPEED_ACH.forEach((id, i) => sim.complete(id, dayAt(START, 0, `07:0${i}`)));

    for (let d = 0; d < 365; d++) {
      sim.log(rec(ACT.callReport, 6, dayAt(START, d, "09:00")));
      sim.log(rec(ACT.timeTrial, 5, dayAt(START, d, "16:00"), { mode: "general" }));
      sim.log(rec(ACT.rehearsal, 45, dayAt(START, d, "17:00"), { mode: "aloud" }));
      sim.log(rec(ACT.appNav, 6, dayAt(START, d, "18:00")));
      sim.log(rec(ACT.quote, 15, dayAt(START, d, "19:00")));
    }

    const speed = sim.skill(SK.speed);
    expect(speed.rank).toBe(4);
    expect(speed.score).toBe(10000);
    expect(speed.blockedByCap).toBeGreaterThan(0);

    const rank4 = speed.promotions.find((p) => p.toRank === 4)!;
    expect(rank4.at >= dayAt(START, 180, "00:00")).toBe(true); // held by the 180-day gate

    const { state, promotions } = advanceTime(sim.state, dayAt(START, 365, "08:00"), sim.rules);
    expect(promotions).toEqual([{ skillId: SK.speed, toRank: 5, at: dayAt(START, 365, "08:00") }]);
    expect(state.skills[SK.speed]!.rank).toBe(5);
  });

  it("a steady player (calls plus a few practice hours a week) reaches max Speed score within the year", () => {
    const sim = new Sim(ruleset());
    SPEED_ACH.slice(0, 3).forEach((id, i) => sim.complete(id, dayAt(START, 0, `07:0${i}`)));

    for (let week = 0; week < 53; week++) {
      const day = (d: number, t: string) => dayAt(START, week * 7 + d, t);
      if (week === 40) sim.complete(SPEED_ACH[3], day(0, "07:00")); // Lightspeed evidence confirmed mid-year
      sim.log(rec(ACT.callReport, 5, day(0, "18:00")));
      sim.log(rec(ACT.rehearsal, 30, day(1, "09:00"), { mode: "aloud" }));
      sim.log(rec(ACT.timeTrial, 2, day(1, "10:00"), { mode: "general" }));
      sim.log(rec(ACT.callReport, 5, day(2, "18:00")));
      sim.log(rec(ACT.rehearsal, 30, day(3, "09:00"), { mode: "aloud" }));
      sim.log(rec(ACT.appNav, 3, day(3, "10:00")));
      sim.log(rec(ACT.callReport, 5, day(3, "18:00")));
      sim.log(rec(ACT.callReport, 5, day(4, "18:00")));
    }

    const promotions = sim.skill(SK.speed).promotions;
    expect(sim.skill(SK.speed).rank).toBe(5);
    expect(promotions.find((p) => p.toRank === 5)!.at.startsWith("2028-01-04")).toBe(true);
    // Score was not the bottleneck: it was already at max before the year was up.
    expect(sim.skill(SK.speed).blockedByCap).toBeGreaterThan(0);
  });

  it("repeating one easy activity stalls early, however long you keep at it", () => {
    const sim = new Sim(ruleset());
    SPEED_ACH.forEach((id, i) => sim.complete(id, dayAt(START, 0, `07:0${i}`)));
    for (let d = 0; d < 400; d++) sim.log(rec(ACT.timeTrial, 5, dayAt(START, d), { mode: "general" }));

    // Weeks with a single activity type are never active, so the 8-active-week gate for Cheetah is never met.
    expect(sim.skill(SK.speed).rank).toBe(2);
    expect(sim.skill(SK.speed).score).toBe(3000);
  });
});
