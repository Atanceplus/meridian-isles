import { beforeEach, describe, expect, it } from "vitest";
import { CommandService } from "./commands";
import { MemoryStorage } from "../persistence/storage";
import { LIGHTSPEED_ID, evaluateAchievement, maxInWindow } from "./achievements";
import type { SaleRow } from "../persistence/types";
import { ACT, SK, registry } from "../test/helpers";

let now: string;
let svc: CommandService;
let id: string;
let n: number;

beforeEach(async () => {
  now = "2027-01-31T18:00:00";
  n = 0;
  svc = new CommandService(new MemoryStorage(), registry, () => now, () => `id${String(++n).padStart(4, "0")}`);
  id = (await svc.createInstance("Main")).id;
});

const evalNow = async (achievementId: string) => {
  const { bundle, ruleset } = await svc.load(id);
  return evaluateAchievement(achievementId, { bundle, registry, ruleset, now })!;
};

describe("seeding", () => {
  it("seeds an editable docket with empty responses and a starter course", async () => {
    const { bundle } = await svc.load(id);
    expect(bundle.docket.map((c) => c.title)).toContain("It's too expensive");
    expect(bundle.docket.every((c) => c.response === "")).toBe(true);
    expect(bundle.courses).toEqual([expect.objectContaining({ key: "course:full-script", kind: "script", targetSeconds: null })]);
  });
});

describe("Court of Objections", () => {
  it("logs real objections and counts them toward Barrister", async () => {
    const caseKey = (await svc.load(id)).bundle.docket[0]!.key;
    await svc.islands.logEncounter(id, { occurredOn: "2027-01-31", caseKey, outcome: "resolved" });
    await expect(svc.islands.logEncounter(id, { occurredOn: "2027-02-01", caseKey, outcome: "resolved" })).rejects.toThrow(/future/);
    await expect(svc.islands.logEncounter(id, { occurredOn: "2027-01-31", caseKey: "nope", outcome: "resolved" })).rejects.toThrow(/docket case/);
    expect(await evalNow("core:ach.objections.barrister")).toEqual([
      expect.objectContaining({ current: 1, required: 25, met: false }),
      expect.objectContaining({ current: 1, required: 8 }),
    ]);
  });

  it("saves a Rebuttal Trial as spoken practice that earns XP", async () => {
    const docket = (await svc.load(id)).bundle.docket;
    const result = await svc.islands.saveTrial(id, docket.map((c, i) => ({ caseKey: c.key, fluent: i > 0 })));
    expect(result.trial.results).toHaveLength(8);
    expect(result.lines.find((l) => l.skillId === SK.objections)?.amount).toBe(25.6); // 8 reps × 4 XP × 80%
    await expect(svc.islands.saveTrial(id, [{ caseKey: docket[0]!.key, fluent: true }, { caseKey: docket[0]!.key, fluent: true }])).rejects.toThrow(/once per trial/);
    await expect(svc.deleteActivity(id, result.trial.activityId)).rejects.toThrow(/kept as they were run/);
  });

  it("refuses practice on a case that isn't on the docket", async () => {
    await expect(svc.logActivity(id, ACT.objectionPractice, { caseId: "ghost", reps: 3 }, { occurredAt: "2027-01-31T10:00", mode: "spoken" })).rejects.toThrow(/docket/);
  });
});

describe("Conversation Cove", () => {
  it("builds a rapport library and notes", async () => {
    const card = await svc.islands.saveCard(id, { kind: "opener", title: "Weather", body: "How's the weather out your way?", scenarioKey: "core:scenario.chatty" });
    await svc.islands.saveCard(id, { id: card.id, kind: "opener", title: "Weather check", body: card.body });
    await svc.islands.saveNote(id, { occurredOn: "2027-01-30", note: "Bonded over fishing, then moved to health questions." });
    const { bundle } = await svc.load(id);
    expect(bundle.rapportCards).toEqual([expect.objectContaining({ title: "Weather check", scenarioKey: null })]);
    expect((await evalNow("core:ach.small-talk.open-door"))[0]).toMatchObject({ current: 1, required: 15 });
    await svc.islands.deleteCard(id, card.id);
    expect((await svc.load(id)).bundle.rapportCards).toEqual([]);
  });
});

describe("Velocity Circuit courses", () => {
  it("freezes a target once set, and only runs after it count toward Off the Line", async () => {
    const run = (seconds: number, at: string) =>
      svc.logActivity(id, ACT.timeTrial, { courseId: "course:full-script", durationSeconds: seconds, clean: true }, { occurredAt: at, mode: "script" });
    await run(400, "2027-01-30T10:00"); // before any target
    await svc.islands.setCourseTarget(id, "course:full-script", 420);
    await expect(svc.islands.setCourseTarget(id, "course:full-script", 600)).rejects.toThrow(/frozen/);
    expect((await evalNow("core:ach.speed.off-the-line"))[1]).toMatchObject({ met: false });
    await run(410, "2027-01-31T17:00");
    expect((await evalNow("core:ach.speed.off-the-line")).every((r) => r.kind === "check" && r.met)).toBe(true);
  });

  it("needs a carrier for application courses", async () => {
    await expect(svc.islands.saveCourse(id, { name: "Americo app", kind: "app" })).rejects.toThrow(/needs a carrier/);
    const c = await svc.islands.saveCourse(id, { name: "Americo app", kind: "app", carrierKey: "fe:carrier.americo" });
    expect(c.carrierKey).toBe("fe:carrier.americo");
  });

  it("finds the busiest window of sales", () => {
    const sale = (t: string) => ({ submittedAt: `2027-01-31T${t}:00` }) as SaleRow;
    expect(maxInWindow(["10:00", "10:20", "10:59", "11:00", "11:01"].map(sale), 60)).toBe(4);
    expect(maxInWindow(["10:00", "10:20", "10:30"].map(sale), 30)).toBe(3);
    expect(maxInWindow([], 30)).toBe(0);
  });
});

describe("Lightspeed tracker", () => {
  /** Ten sales two minutes apart, submitted 2027-01-31 14:00–14:18. */
  async function tenSales(start = "14") {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const sale = await svc.saveSale(id, { submittedAt: `2027-01-31T${start}:${String(i * 2).padStart(2, "0")}`, carrierId: null, issuePaid: 500 });
      ids.push(sale.id);
    }
    return ids;
  }

  it("refuses windows longer than 30 minutes and sales already in another attempt", async () => {
    const ids = await tenSales();
    const late = await svc.saveSale(id, { submittedAt: "2027-01-31T14:40", carrierId: null, issuePaid: 500 });
    await expect(svc.lightspeed.createAttempt(id, { saleIds: [...ids.slice(0, 9), late.id] })).rejects.toThrow(/longer than 30 minutes/);
    await svc.lightspeed.createAttempt(id, { saleIds: ids });
    await expect(svc.lightspeed.createAttempt(id, { saleIds: ids.slice(0, 3) })).rejects.toThrow(/already belong/);
  });

  it("keeps attempt sales as evidence", async () => {
    const ids = await tenSales();
    await svc.lightspeed.createAttempt(id, { saleIds: ids });
    await expect(svc.deleteSale(id, ids[0]!)).rejects.toThrow(/kept as evidence/);
    await expect(svc.saveSale(id, { id: ids[0]!, submittedAt: "2027-01-31T09:00", carrierId: null, issuePaid: 500 })).rejects.toThrow(/can't change/);
  });

  it("never treats a checkpoint as passed until you confirm it, on or after its calendar-month date", async () => {
    const ids = await tenSales();
    await svc.lightspeed.createAttempt(id, { saleIds: ids });
    now = "2027-04-29T09:00:00";
    await expect(svc.lightspeed.confirmRetention(id, ids[0]!, "confirmedOk")).rejects.toThrow(/2027-04-30/); // Jan 31 + 3 months
    now = "2027-04-30T09:00:00";
    expect((await evalNow(LIGHTSPEED_ID))[0]).toMatchObject({ current: 0, required: 10 }); // due, but not confirmed
    await svc.lightspeed.confirmRetention(id, ids[0]!, "confirmedOk");
    expect((await evalNow(LIGHTSPEED_ID))[0]).toMatchObject({ current: 1 });
  });

  it("fails the attempt on a chargeback and keeps its history", async () => {
    const ids = await tenSales();
    const attempt = await svc.lightspeed.createAttempt(id, { saleIds: ids });
    now = "2027-02-20T09:00:00";
    await svc.lightspeed.confirmRetention(id, ids[4]!, "chargeback");
    const { bundle, state } = await svc.load(id);
    const after = bundle.lightspeedAttempts.find((a) => a.id === attempt.id)!;
    expect(after.history.map((h) => h.text)).toContain("Attempt ineligible: a policy was charged back.");
    expect(state.achievements[LIGHTSPEED_ID]).toBeUndefined();
    await expect(svc.lightspeed.deleteAttempt(id, attempt.id)).rejects.toThrow(/keep their history/);
    // Its sales stay with it; a fresh window is needed for the next attempt.
    await expect(svc.lightspeed.createAttempt(id, { saleIds: ids.filter((_, i) => i !== 4) })).rejects.toThrow(/already belong/);
  });

  it("records Lightspeed when all ten are confirmed, without promoting Speed on its own", async () => {
    const ids = await tenSales();
    await svc.lightspeed.createAttempt(id, { saleIds: ids });
    now = "2027-04-30T09:00:00";
    for (const sale of ids.slice(0, 9)) await svc.lightspeed.confirmRetention(id, sale, "confirmedOk");
    expect((await svc.load(id)).state.achievements[LIGHTSPEED_ID]).toBeUndefined();
    await svc.lightspeed.confirmRetention(id, ids[9]!, "confirmedOk");
    const { bundle, state } = await svc.load(id);
    expect(state.achievements[LIGHTSPEED_ID]).toBe(now);
    expect(state.skills[SK.speed]!.rank).toBe(1); // still needs score, 365 days and 44 active weeks
    expect(bundle.lightspeedAttempts[0]!.achievementRecordedAt).toBe(now);
    await expect(svc.lightspeed.clearRetention(id, ids[0]!)).rejects.toThrow(/recorded Lightspeed/);
  });

  it("lets you correct a mistaken entry before Lightspeed is recorded", async () => {
    const ids = await tenSales();
    await svc.lightspeed.createAttempt(id, { saleIds: ids });
    now = "2027-02-10T09:00:00";
    await svc.lightspeed.confirmRetention(id, ids[0]!, "chargeback");
    await svc.lightspeed.clearRetention(id, ids[0]!);
    const sale = (await svc.load(id)).bundle.sales.find((s) => s.id === ids[0]);
    expect(sale?.retention).toBeNull();
  });
});
