import { beforeEach, describe, expect, it } from "vitest";
import { CommandService, ValidationError } from "./commands";
import { MemoryStorage } from "../persistence/storage";
import { buildPersonalSave } from "../persistence/exportSave";
import { ACT, SK, registry } from "../test/helpers";

let now: string;
let storage: MemoryStorage;
let svc: CommandService;
let id: string;
let n: number;

beforeEach(async () => {
  now = "2027-01-04T18:00:00";
  n = 0;
  storage = new MemoryStorage();
  svc = new CommandService(storage, registry, () => now, () => `id${++n}`);
  id = (await svc.createInstance("Main map")).id;
});

const score = async (skillId: string) => (await svc.load(id)).state.skills[skillId]!.score;

const DOCKET_OPENED = "core:ach.objections.docket-opened";
/** Write responses for the 8 seeded cases plus 2 new ones. */
async function writeDocket() {
  for (const c of (await svc.load(id)).bundle.docket) await svc.islands.saveCase(id, { key: c.key, title: c.title, response: "My answer to this objection." });
  await svc.islands.saveCase(id, { title: "I'm too old", response: "My answer to this objection." });
  await svc.islands.saveCase(id, { title: "I'm too young", response: "My answer to this objection." });
}

describe("instances", () => {
  it("creates, renames, lists and deletes independent maps", async () => {
    const second = await svc.createInstance("  Practice map ");
    expect(second.name).toBe("Practice map");
    await svc.renameInstance(id, "Career");
    expect((await svc.listInstances()).map((i) => i.name)).toEqual(["Career", "Practice map"]);

    await svc.logActivity(second.id, ACT.tonalityDrill, { minutes: 30, drillType: "pace" }, { occurredAt: "2027-01-04T17:00" });
    expect((await svc.load(second.id)).state.skills[SK.tonality]!.score).toBe(90);
    expect(await score(SK.tonality)).toBe(0); // maps don't share progress

    await svc.deleteInstance(second.id);
    expect((await svc.listInstances()).map((i) => i.name)).toEqual(["Career"]);
  });

  it("rejects empty names", async () => {
    await expect(svc.createInstance("   ")).rejects.toThrow(ValidationError);
  });
});

describe("logging activities", () => {
  it("validates against the content pack's fields", async () => {
    const err = await svc.logActivity(id, ACT.tonalityDrill, { minutes: 0 }, { occurredAt: "2027-01-04T17:00" }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.errors).toEqual(expect.arrayContaining(["Drill is required.", "Minutes must be at least 1."]));

    await expect(svc.logActivity(id, ACT.rehearsal, { minutes: 20, sections: ["opener"] }, { occurredAt: "2027-01-04T17:00" })).rejects.toThrow(/Choose a mode/);
    await expect(svc.logActivity(id, ACT.tonalityDrill, { minutes: 20, drillType: "pace" }, { occurredAt: "2027-01-05T09:00" })).rejects.toThrow(/future/);
    await expect(svc.logActivity(id, ACT.callReport, { hours: 2 }, { occurredAt: "2027-01-04T17:00" })).rejects.toThrow(/daily report/);
  });

  it("writes the activity, ledger, event and audit rows in one commit", async () => {
    const result = await svc.logActivity(id, ACT.rehearsal, { minutes: 20, sections: ["opener"] }, { occurredAt: "2027-01-04T17:00", mode: "aloud" });
    expect(result.lines.map((l) => [l.skillId, l.status, l.amount])).toEqual([
      [SK.speed, "awarded", 30],
      [SK.tonality, "awarded", 30],
    ]);
    const { bundle } = await svc.load(id);
    expect(bundle.activities).toHaveLength(1);
    expect(bundle.ledger).toHaveLength(2);
    expect(bundle.audit.map((a) => a.action)).toEqual(["instance.create", "activity.log"]);
    expect((await storage.loadEvents(id)).map((e) => e.event.kind)).toEqual(["activity"]);
  });

  it("awards a personal-best bonus only when a clean run beats an earlier clean run on the same course", async () => {
    const opener = await svc.islands.saveCourse(id, { name: "Opener only", kind: "script" });
    const trial = (seconds: number, clean = true, courseId = "course:full-script") =>
      svc.logActivity(id, ACT.timeTrial, { courseId, durationSeconds: seconds, clean }, { occurredAt: "2027-01-04T17:00", mode: "general" });
    expect((await trial(600)).activity.record.personalBest).toBeUndefined(); // first run sets the mark
    expect((await trial(550, false)).activity.record.personalBest).toBeUndefined(); // not clean
    expect((await trial(580)).activity.record.personalBest).toBe(true);
    expect((await trial(500, true, opener.key)).activity.record.personalBest).toBeUndefined(); // different course
    expect((await trial(590)).activity.record.personalBest).toBeUndefined(); // slower than 580
  });

  it("uses the subject fields for per-subject limits", async () => {
    const a = await svc.logActivity(id, ACT.objectionPractice, { caseId: "fe:objection.too-expensive", reps: 12 }, { occurredAt: "2027-01-04T17:00", mode: "spoken" });
    expect(a.activity.record.subjectKey).toBe("fe:objection.too-expensive");
    expect(a.lines.find((l) => l.skillId === SK.objections && l.status === "reduced")!.amount).toBe(32);
  });

  it("deletes by reversal, exactly once", async () => {
    const { activity } = await svc.logActivity(id, ACT.tonalityDrill, { minutes: 30, drillType: "pace" }, { occurredAt: "2027-01-04T17:00" });
    const removed = await svc.deleteActivity(id, activity.id);
    expect(removed.lines).toEqual([expect.objectContaining({ skillId: SK.tonality, status: "reversed", amount: -90 })]);
    expect(await score(SK.tonality)).toBe(0);
    await expect(svc.deleteActivity(id, activity.id)).rejects.toThrow(/already removed/);
    // The daily limit it used is released too.
    const again = await svc.logActivity(id, ACT.tonalityDrill, { minutes: 40, drillType: "pace" }, { occurredAt: "2027-01-04T17:30" });
    expect(again.lines[0]).toMatchObject({ status: "awarded", amount: 120 });
  });

  it("edits by reversal + replacement, keeping the original late-logging clock", async () => {
    const { activity } = await svc.logActivity(id, ACT.tonalityDrill, { minutes: 30, drillType: "pace" }, { occurredAt: "2027-01-04T17:00" });
    now = "2027-01-20T09:00:00"; // 16 days later: a new record would be too late to earn XP
    const edited = await svc.editActivity(id, activity.id, { minutes: 20, drillType: "warmth" }, { occurredAt: "2027-01-04T17:00" });
    expect(edited.activity.record.eligibleFrom).toBe("2027-01-04T18:00:00");
    expect(await score(SK.tonality)).toBe(60);
    const { bundle } = await svc.load(id);
    expect(bundle.activities.find((a) => a.id === activity.id)).toMatchObject({ status: "reversed", replacedBy: edited.activity.id });
  });
});

describe("daily reports", () => {
  const report = (over: Partial<Parameters<CommandService["saveDailyReport"]>[1]> = {}) =>
    svc.saveDailyReport(id, { date: "2027-01-04", calls: 80, hours: 5, applicationsSubmitted: 2, issuePaid: null, ...over });

  it("turns hours into call-report XP once", async () => {
    const { lines, report: r } = await report();
    expect(lines.filter((l) => l.status === "awarded").map((l) => l.amount)).toEqual([24, 12, 12, 12]);
    expect(r.activityId).not.toBeNull();
    expect(await score(SK.speed)).toBe(24);
  });

  it("updates the same date's report instead of creating a second one", async () => {
    await report();
    const update = await report({ issuePaid: 1234.5, applicationsSubmitted: 3 });
    expect(update.lines).toEqual([]); // hours unchanged: no XP change
    const { bundle } = await svc.load(id);
    expect(bundle.dailyReports).toHaveLength(1);
    expect(bundle.dailyReports[0]).toMatchObject({ issuePaid: 1234.5, applicationsSubmitted: 3, currency: "USD" });
    expect(await score(SK.speed)).toBe(24);
  });

  it("re-awards when hours change, without double counting", async () => {
    await report();
    const update = await report({ hours: 3 });
    expect(update.lines.filter((l) => l.skillId === SK.speed).map((l) => [l.status, l.amount])).toEqual([
      ["reversed", -24],
      ["awarded", 14.4],
    ]);
    expect(await score(SK.speed)).toBe(14.4);
    const { bundle } = await svc.load(id);
    expect(bundle.activities.filter((a) => a.status === "active")).toHaveLength(1);
  });

  it("records 0-hour days without XP and deletes reports by reversing their XP", async () => {
    const zero = await report({ date: "2027-01-03", hours: 0, calls: 0, applicationsSubmitted: 0 });
    expect(zero.report.activityId).toBeNull();
    const { report: r } = await report();
    await svc.deleteDailyReport(id, r.id);
    expect(await score(SK.speed)).toBe(0);
    expect((await svc.load(id)).bundle.dailyReports.map((d) => d.date)).toEqual(["2027-01-03"]);
  });

  it("rejects invalid numbers and future dates", async () => {
    await expect(report({ calls: 2.5 })).rejects.toThrow(/whole number/);
    await expect(report({ hours: 30 })).rejects.toThrow(/between 0 and 24/);
    await expect(report({ date: "2027-01-05" })).rejects.toThrow(/future/);
    await expect(report({ issuePaid: -1 })).rejects.toThrow(/negative/);
  });

  it("uses noon for the activity time, or now if it's not noon yet", async () => {
    now = "2027-01-04T10:00:00";
    const { report: r } = await report();
    const { bundle } = await svc.load(id);
    expect(bundle.activities.find((a) => a.id === r.activityId)!.occurredAt).toBe("2027-01-04T10:00:00");
  });
});

describe("sales and achievements", () => {
  it("stores itemized sales without awarding XP", async () => {
    const sale = await svc.saveSale(id, { submittedAt: "2027-01-04T14:05", carrierId: "fe:carrier.americo", issuePaid: 600 });
    expect(sale.submittedAt).toBe("2027-01-04T14:05:00");
    const { bundle, state } = await svc.load(id);
    expect(bundle.sales).toHaveLength(1);
    expect(bundle.ledger).toHaveLength(0);
    expect(state.skills[SK.speed]!.score).toBe(0);
    await svc.saveSale(id, { id: sale.id, submittedAt: "2027-01-04T14:05", carrierId: null, issuePaid: 650 });
    expect((await svc.load(id)).bundle.sales).toEqual([expect.objectContaining({ issuePaid: 650, carrierId: null })]);
    await svc.deleteSale(id, sale.id);
    expect((await svc.load(id)).bundle.sales).toEqual([]);
  });

  it("completes achievements once, only when records support them, and never Lightspeed by hand", async () => {
    await expect(svc.completeAchievement(id, DOCKET_OPENED, "")).rejects.toThrow(/records don't show this yet: Docket cases with a written response \(0\/10\)/);
    await writeDocket();
    await svc.completeAchievement(id, DOCKET_OPENED, "Ten responses written");
    await expect(svc.completeAchievement(id, DOCKET_OPENED, "")).rejects.toThrow(/already complete/);
    await expect(svc.completeAchievement(id, "core:ach.speed.lightspeed", "")).rejects.toThrow(/attempt tracker/);
    const { bundle, state } = await svc.load(id);
    expect(state.achievements[DOCKET_OPENED]).toBe(now);
    expect(bundle.achievements[0]).toMatchObject({ evidenceNote: "Ten responses written", evidence: [{ current: 10, required: 10 }] });
  });

  it("refreshTime writes nothing when no promotion is due", async () => {
    expect(await svc.refreshTime(id)).toEqual([]);
    expect(await storage.loadEvents(id)).toEqual([]);
  });
});

describe("export", () => {
  it("produces a complete, checksummed personal save", async () => {
    await svc.saveDailyReport(id, { date: "2027-01-04", calls: 50, hours: 4, applicationsSubmitted: 1, issuePaid: 500 });
    await svc.saveSale(id, { submittedAt: "2027-01-04T15:00", carrierId: null, issuePaid: 500 });
    await writeDocket();
    await svc.completeAchievement(id, DOCKET_OPENED, "");
    const save = await buildPersonalSave(storage, id, "0.1.0", now);
    expect(save).toMatchObject({ format: "meridian-save", schemaVersion: 3, instance: { name: "Main map" } });
    expect(save.data.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(save.data.dailyReports).toHaveLength(1);
    expect(save.data.sales).toHaveLength(1);
    expect(save.data.achievements).toHaveLength(1);
    expect(save.snapshot?.lastSeq).toBe(2);
    expect(save.checksum).toMatch(/^[0-9a-f]{64}$/);
  });
});
