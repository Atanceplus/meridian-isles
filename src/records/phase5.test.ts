import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { CommandService } from "./commands";
import { MemoryStorage, type StorageAdapter } from "../persistence/storage";
import { DexieStorage } from "../persistence/dexieStorage";
import { buildPersonalSave } from "../persistence/exportSave";
import { ImportError, parseSaveFile } from "../persistence/importSave";
import { DEFAULT_STARTER_OPTIONS, buildStarter } from "./starterMaps";
import { ACT, SK, registry } from "../test/helpers";

let now: string;
let storage: StorageAdapter;
let svc: CommandService;
let id: string;

const make = async (s: StorageAdapter) => {
  storage = s;
  svc = new CommandService(storage, registry, () => now);
  id = (await svc.createInstance("Main")).id;
};

beforeEach(async () => {
  now = "2027-03-01T18:00:00";
  await make(new MemoryStorage());
});

describe("Outfitter's Wharf", () => {
  it("records purchases without touching progress", async () => {
    const leads = await svc.shop.saveUpgrade(id, { catalogId: "core:catalog.leads", category: "leads", name: "Spring leads", purchasedOn: "2027-02-27", reportedCost: 450, quantity: 100 });
    expect(leads).toMatchObject({ remaining: 100, currency: "USD", subscription: null });
    const { bundle, state } = await svc.load(id);
    expect(bundle.ledger).toEqual([]);
    expect(Object.values(state.skills).every((s) => s.score === 0)).toBe(true);
  });

  it("tracks inventory and refuses to go below zero", async () => {
    const u = await svc.shop.saveUpgrade(id, { category: "leads", name: "Leads", purchasedOn: "2027-02-27", reportedCost: null, quantity: 10 });
    const used = await svc.shop.adjustRemaining(id, u.id, -4, "Monday");
    expect(used).toMatchObject({ remaining: 6, quantity: 10 });
    expect(used.history.at(-1)!.text).toBe("Used 4 (6 left) — Monday");
    await expect(svc.shop.adjustRemaining(id, u.id, -7)).rejects.toThrow(/Only 6 remaining/);
    const restocked = await svc.shop.adjustRemaining(id, u.id, 5);
    expect(restocked).toMatchObject({ remaining: 11, quantity: 15 });
  });

  it("validates purchases", async () => {
    const base = { category: "crm" as const, name: "CRM", purchasedOn: "2027-02-27", reportedCost: 30 };
    await expect(svc.shop.saveUpgrade(id, { ...base, purchasedOn: "2027-03-02" })).rejects.toThrow(/future/);
    await expect(svc.shop.saveUpgrade(id, { ...base, reportedCost: -1 })).rejects.toThrow(/negative/);
    await expect(svc.shop.adjustRemaining(id, (await svc.shop.saveUpgrade(id, base)).id, -1)).rejects.toThrow(/doesn't track/);
  });
});

/** A small but varied history to round-trip. */
async function buildHistory() {
  await svc.logActivity(id, ACT.tonalityDrill, { minutes: 30, drillType: "pace" }, { occurredAt: "2027-03-01T09:00" });
  const { activity } = await svc.logActivity(id, ACT.rehearsal, { minutes: 20, sections: ["opener"] }, { occurredAt: "2027-03-01T10:00", mode: "aloud" });
  await svc.deleteActivity(id, activity.id);
  await svc.saveDailyReport(id, { date: "2027-03-01", calls: 80, hours: 5, applicationsSubmitted: 2, issuePaid: 900 });
  await svc.saveSale(id, { submittedAt: "2027-03-01T14:00", carrierId: "fe:carrier.americo", issuePaid: 450 });
  const p = await svc.curriculum.saveProduct(id, { carrierKey: "fe:carrier.americo", name: "Plan A", details: "My notes" });
  await svc.curriculum.verifyProduct(id, p.key, true);
  await svc.curriculum.saveKnowledge(id, { carrierKey: "fe:carrier.americo", productKey: null, categoryId: "fe:cat.background" }, {
    summary: "Background in my own words, long enough.",
    notes: "private thoughts",
    checklist: [{ id: "c1", text: "Explain founding", done: true }],
  });
  for (const c of (await svc.load(id)).bundle.docket) await svc.islands.saveCase(id, { key: c.key, title: c.title, response: "My answer to this objection." });
  await svc.islands.saveCase(id, { title: "Too old", response: "My answer to this objection." });
  await svc.islands.saveCase(id, { title: "Too young", response: "My answer to this objection." });
  await svc.completeAchievement(id, "core:ach.objections.docket-opened", "done");
  await svc.shop.saveUpgrade(id, { category: "crm", name: "CRM", purchasedOn: "2027-02-01", reportedCost: 30 });
}

describe("personal save import", () => {
  it("round-trips a map into a new, independent map", async () => {
    await buildHistory();
    const original = await svc.load(id);
    const file = JSON.stringify(await buildPersonalSave(storage, id, "test", now));
    const parsed = await parseSaveFile(file);
    expect(parsed.kind).toBe("personal");
    if (parsed.kind !== "personal") return;
    expect(parsed.checksumOk).toBe(true);

    const preview = svc.archive.preview(parsed);
    expect(preview.counts.find((c) => c.label === "Activities")!.n).toBe(2);
    expect(preview.warnings).toEqual([]);

    const { instance, warnings } = await svc.archive.importPersonal(parsed.save);
    expect(warnings).toEqual([]);
    expect(instance.name).toBe("Main (imported)");
    const copy = await svc.load(instance.id);
    for (const skillId of Object.values(SK)) expect(copy.state.skills[skillId]).toEqual(original.state.skills[skillId]);
    expect(copy.bundle.activities).toHaveLength(original.bundle.activities.length);
    expect(copy.bundle.products[0]).toMatchObject({ status: "verified", id: `${instance.id}::${original.bundle.products[0]!.key}` });
    // Every row id is new, so the two maps never share a key.
    const ids = (b: typeof original.bundle) => [...b.activities, ...b.ledger, ...b.sales, ...b.audit].map((r) => r.id);
    expect(ids(copy.bundle).some((x) => ids(original.bundle).includes(x))).toBe(false);
    // References follow the remap.
    const report = copy.bundle.dailyReports[0]!;
    expect(copy.bundle.activities.some((a) => a.id === report.activityId)).toBe(true);
    expect(Object.keys(copy.state.appliedRecordIds).every((r) => copy.bundle.activities.some((a) => a.id === r))).toBe(true);

    // The copy keeps working: logging and reversing in it doesn't disturb the original.
    await svc.logActivity(instance.id, ACT.tonalityDrill, { minutes: 10, drillType: "warmth" }, { occurredAt: "2027-03-01T17:00" });
    expect((await svc.load(id)).state.skills[SK.tonality]!.score).toBe(original.state.skills[SK.tonality]!.score);
  });

  it("can replace an existing map, keeping its name, only after the import succeeds", async () => {
    await buildHistory();
    const other = await svc.createInstance("Old map");
    const parsed = await parseSaveFile(JSON.stringify(await buildPersonalSave(storage, id, "test", now)));
    if (parsed.kind !== "personal") throw new Error();
    const { instance } = await svc.archive.importPersonal(parsed.save, { replaceId: other.id });
    const names = (await svc.listInstances()).map((i) => i.name);
    expect(names).toEqual(["Main", "Old map"]);
    expect((await svc.listInstances()).some((i) => i.id === other.id)).toBe(false);
    expect(instance.name).toBe("Old map");
  });

  it("rebuilds progress from the event log when the file was edited", async () => {
    await buildHistory();
    const save = await buildPersonalSave(storage, id, "test", now);
    const skills = save.snapshot!.state.skills as Record<string, { score: number }>;
    skills[SK.tonality]!.score = 9999;
    const parsed = await parseSaveFile(JSON.stringify(save));
    if (parsed.kind !== "personal") throw new Error();
    expect(parsed.checksumOk).toBe(false);
    expect(parsed.warnings[0]).toMatch(/checksum doesn't match/);
    const { instance, warnings } = await svc.archive.importPersonal(parsed.save);
    expect(warnings.join(" ")).toMatch(/rebuilt from the log/);
    expect((await svc.load(instance.id)).state.skills[SK.tonality]!.score).toBe((await svc.load(id)).state.skills[SK.tonality]!.score);
  });

  it("migrates an older save format", async () => {
    await buildHistory();
    const save = JSON.parse(JSON.stringify(await buildPersonalSave(storage, id, "test", now)));
    save.schemaVersion = 1;
    delete save.data.ownedUpgrades;
    delete save.data.lightspeedAttempts;
    const parsed = await parseSaveFile(JSON.stringify(save));
    if (parsed.kind !== "personal") throw new Error();
    expect(parsed.migratedFrom).toBe(1);
    expect(parsed.warnings).toContain("Upgraded from save format 1 to 3.");
    expect(parsed.save.data.ownedUpgrades).toEqual([]);
  });

  it("explains bad files instead of importing them", async () => {
    await expect(parseSaveFile("{not json")).rejects.toThrow(/damaged or incomplete/);
    await expect(parseSaveFile(JSON.stringify({ hello: 1 }))).rejects.toThrow(/isn't a Meridian Isles save/);
    const save = JSON.parse(JSON.stringify(await buildPersonalSave(storage, id, "test", now)));
    await expect(parseSaveFile(JSON.stringify({ ...save, schemaVersion: 99 }))).rejects.toThrow(/newer version/);
    save.data.activities = [{ id: "x", instanceId: "someone-else" }];
    const err = await parseSaveFile(JSON.stringify(save)).catch((e) => e);
    expect(err).toBeInstanceOf(ImportError);
    expect(err.errors.join(" ")).toMatch(/different map/);
  });

  it("imports the same file twice into IndexedDB without id collisions", async () => {
    await make(new DexieStorage(`p5-${Math.random()}`));
    await buildHistory();
    const text = JSON.stringify(await buildPersonalSave(storage, id, "test", now));
    for (let i = 0; i < 2; i++) {
      const parsed = await parseSaveFile(text);
      if (parsed.kind !== "personal") throw new Error();
      await svc.archive.importPersonal(parsed.save);
    }
    const maps = await svc.listInstances();
    expect(maps.map((m) => m.name).sort()).toEqual(["Main", "Main (imported)", "Main (imported) 2"]);
    for (const m of maps) expect((await svc.load(m.id)).bundle.activities).toHaveLength(3); // drill, removed rehearsal, report hours
    (storage as DexieStorage).close();
  });
});

describe("starter maps", () => {
  it("shares curriculum, never history, and leaves notes out by default", async () => {
    await buildHistory();
    const { bundle } = await svc.load(id);
    const starter = buildStarter(bundle, DEFAULT_STARTER_OPTIONS, { name: "FE starter", description: "", appVersion: "test", exportedAt: now });
    const text = JSON.stringify(starter);
    for (const personal of ["activities", "dailyReports", "sales", "ledger", "achievements", "ownedUpgrades", "snapshot", "private thoughts"]) expect(text).not.toContain(personal);
    expect(starter.curriculum.knowledge[0]!.checklist).toEqual([{ text: "Explain founding" }]);
    expect(starter.curriculum.docket.every((c) => c.response === "My answer to this objection.")).toBe(true);
  });

  it("creates a fresh map from a starter", async () => {
    await buildHistory();
    const starter = buildStarter((await svc.load(id)).bundle, { ...DEFAULT_STARTER_OPTIONS, includeScript: false }, { name: "FE starter", description: "", appVersion: "test", exportedAt: now });
    const parsed = await parseSaveFile(JSON.stringify(starter));
    expect(parsed.kind).toBe("starter");
    if (parsed.kind !== "starter") return;
    expect(svc.archive.preview(parsed).counts.find((c) => c.label === "Docket cases")!.n).toBe(10);

    const map = await svc.archive.createFromStarter(parsed.starter, "Teammate");
    const { bundle, state } = await svc.load(map.id);
    expect(bundle.products[0]).toMatchObject({ name: "Plan A", status: "draft", verifiedOn: null });
    expect(bundle.knowledge[0]!.checklist[0]).toMatchObject({ text: "Explain founding", done: false });
    expect(bundle.docket).toHaveLength(10);
    expect(bundle.scripts).toHaveLength(1); // left out of the starter, so seeded from the pack
    expect(bundle.activities).toEqual([]);
    expect(Object.values(state.skills).every((s) => s.score === 0 && s.rank === 1)).toBe(true);
  });
});
