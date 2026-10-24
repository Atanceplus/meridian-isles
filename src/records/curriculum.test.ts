import { beforeEach, describe, expect, it } from "vitest";
import { CommandService, ValidationError } from "./commands";
import { MemoryStorage } from "../persistence/storage";
import { atlasComplete, buildCurriculumView, type Subject } from "./curriculum";
import { ACT, SK, registry } from "../test/helpers";

let now: string;
let svc: CommandService;
let storage: MemoryStorage;
let id: string;
let n: number;

const AMERICO = "fe:carrier.americo";
const BACKGROUND = "fe:cat.background";
const MEDICAL = "fe:cat.medical";

beforeEach(async () => {
  now = "2027-01-04T18:00:00";
  n = 0;
  storage = new MemoryStorage();
  svc = new CommandService(storage, registry, () => now, () => `id${++n}`);
  id = (await svc.createInstance("Main")).id;
});

const view = async () => buildCurriculumView((await svc.load(id)).bundle, registry, now.slice(0, 10));
const study = (minutes: number, categoryId: string, productId?: string, at = "2027-01-04T17:00") =>
  svc.logActivity(id, ACT.carrierStudy, { minutes, carrierId: AMERICO, categoryId, ...(productId ? { productId } : {}), summary: "Notes from today" }, { occurredAt: at });

describe("seeding", () => {
  it("gives a new map the eight carrier labels, no products and an empty script", async () => {
    const { bundle } = await svc.load(id);
    expect(bundle.carriers.map((c) => c.label)).toEqual(["Americo", "Mutual of Omaha", "Instabrain", "Chubb", "American Amicable", "Transamerica", "Corebridge", "Aetna"]);
    expect(bundle.carriers.every((c) => c.kind === "unspecified")).toBe(true);
    expect(bundle.products).toEqual([]);
    expect(bundle.scripts).toHaveLength(1);
    expect(bundle.scriptRevisions[0]!.sections.every((s) => s.body === "")).toBe(true);
  });

  it("seeds maps created before the curriculum existed, once", async () => {
    const old = new MemoryStorage();
    await old.commit("legacy", {
      instance: { id: "legacy", name: "Old", createdAt: now, updatedAt: now, schemaVersion: 1, packRefs: [], overrides: {}, settings: { currency: "USD" } },
    });
    const legacy = new CommandService(old, registry, () => now, () => `x${++n}`);
    expect((await legacy.load("legacy")).bundle.carriers).toHaveLength(8);
    expect((await legacy.load("legacy")).bundle.carriers).toHaveLength(8);
  });
});

describe("carriers and products", () => {
  it("adds, renames, archives and refuses duplicate carriers", async () => {
    const added = await svc.curriculum.saveCarrier(id, { label: "Royal Neighbors", kind: "carrier" });
    expect(added.key).toMatch(/^user:/);
    await svc.curriculum.saveCarrier(id, { key: AMERICO, label: "Americo Life", kind: "carrier", archived: true });
    const { bundle } = await svc.load(id);
    expect(bundle.carriers.find((c) => c.key === AMERICO)).toMatchObject({ label: "Americo Life", archived: true, kind: "carrier" });
    await expect(svc.curriculum.saveCarrier(id, { label: "royal neighbors", kind: "carrier" })).rejects.toThrow(/already have/);
  });

  it("tracks product status from empty to draft to verified, and back to draft when details change", async () => {
    const p = await svc.curriculum.saveProduct(id, { carrierKey: AMERICO, name: "Plan A" });
    expect(p.status).toBe("empty");
    await expect(svc.curriculum.verifyProduct(id, p.key, true)).rejects.toThrow(/details before verifying/);
    const draft = await svc.curriculum.saveProduct(id, { key: p.key, carrierKey: AMERICO, name: "Plan A", details: "My notes on Plan A" });
    expect(draft.status).toBe("draft");
    const verified = await svc.curriculum.verifyProduct(id, p.key, true);
    expect(verified).toMatchObject({ status: "verified", verifiedOn: "2027-01-04" });
    const renamed = await svc.curriculum.saveProduct(id, { key: p.key, carrierKey: AMERICO, name: "Plan A+", details: "My notes on Plan A" });
    expect(renamed.status).toBe("verified");
    const changed = await svc.curriculum.saveProduct(id, { key: p.key, carrierKey: AMERICO, name: "Plan A+", details: "Updated notes" });
    expect(changed).toMatchObject({ status: "draft", verifiedOn: null });
  });
});

describe("study and category levels", () => {
  it("checks that the category matches the product choice", async () => {
    await expect(study(30, MEDICAL)).rejects.toThrow(/specific product/);
    const p = await svc.curriculum.saveProduct(id, { carrierKey: AMERICO, name: "Plan A" });
    await expect(study(30, BACKGROUND, p.key)).rejects.toThrow(/carrier-wide/);
    const other = await svc.curriculum.saveProduct(id, { carrierKey: "fe:carrier.chubb", name: "Other" });
    await expect(study(30, MEDICAL, other.key)).rejects.toThrow(/doesn't belong/);
    const ok = await study(30, MEDICAL, p.key);
    expect(ok.lines.find((l) => l.skillId === SK.productKnowledge)?.amount).toBe(60);
  });

  it("credits study minutes with the per-category daily limit and needs evidence for each level", async () => {
    await study(90, BACKGROUND); // 60 full + 30 at half = 75 credited
    let cat = (await view()).carriers[0]!.categories[0]!;
    expect(cat.evidence.creditedMinutes).toBe(75);
    expect(cat.level).toBe(0); // minutes are there, the summary isn't

    const subject: Subject = { carrierKey: AMERICO, productKey: null, categoryId: BACKGROUND };
    await svc.curriculum.saveKnowledge(id, subject, { summary: "Founded long ago; my own words here." });
    cat = (await view()).carriers[0]!.categories[0]!;
    expect(cat.level).toBe(1);
    expect(cat.next?.name).toBe("Charted");
  });

  it("records the peak level so a lapsed review shows as review due, not lost progress", async () => {
    const subject: Subject = { carrierKey: AMERICO, productKey: null, categoryId: BACKGROUND };
    for (const [day, at] of [
      [0, "2027-01-04T17:00"],
      [1, "2027-01-05T17:00"],
      [2, "2027-01-06T17:00"],
      [3, "2027-01-07T17:00"],
      [4, "2027-01-08T17:00"],
    ] as const) {
      now = `2027-01-0${4 + day}T18:00:00`;
      await study(60, BACKGROUND, undefined, at);
    }
    await svc.curriculum.saveKnowledge(id, subject, {
      summary: "A summary that is long enough.",
      checklist: [
        { id: "a", text: "Explain A", done: true },
        { id: "b", text: "Explain B", done: true },
        { id: "c", text: "Explain C", done: true },
      ],
    });
    await svc.curriculum.markReviewed(id, subject);
    let cat = (await view()).carriers[0]!.categories[0]!;
    expect(cat).toMatchObject({ level: 3, peak: 3, reviewDue: false });

    now = "2027-06-01T09:00:00"; // review is now stale
    cat = (await view()).carriers[0]!.categories[0]!;
    expect(cat).toMatchObject({ level: 2, peak: 3, reviewDue: true });
  });

  it("keeps a carrier at its weakest category, and at 0 until it has a product", async () => {
    const write = (categoryId: string, productKey: string | null) =>
      svc.curriculum.saveKnowledge(id, { carrierKey: AMERICO, productKey, categoryId }, { summary: "Twenty-plus characters of notes." });
    for (const c of ["fe:cat.background", "fe:cat.processes", "fe:cat.carrier-comp"]) {
      await study(30, c);
      await write(c, null);
    }
    let carrier = (await view()).carriers[0]!;
    expect(carrier.categories.every((c) => c.level === 1)).toBe(true);
    expect(carrier).toMatchObject({ level: 0, needsProduct: true });

    const p = await svc.curriculum.saveProduct(id, { carrierKey: AMERICO, name: "Plan A" });
    for (const c of registry.seeds.knowledgeCategories.filter((k) => k.scope === "product")) {
      if (c.id === "fe:cat.commissions") {
        await svc.curriculum.saveKnowledge(id, { carrierKey: AMERICO, productKey: p.key, categoryId: c.id }, { applicable: false });
        continue;
      }
      await study(30, c.id, p.key);
      await write(c.id, p.key);
    }
    carrier = (await view()).carriers[0]!;
    expect(carrier).toMatchObject({ level: 1, needsProduct: false });
    expect(atlasComplete(carrier)).toBe(true);
  });

  it("refuses to mark always-applicable categories as not applicable, and bad links", async () => {
    const subject: Subject = { carrierKey: AMERICO, productKey: null, categoryId: BACKGROUND };
    await expect(svc.curriculum.saveKnowledge(id, subject, { applicable: false })).rejects.toThrow(/always applies/);
    await expect(svc.curriculum.saveKnowledge(id, subject, { resources: [{ id: "r", label: "x", url: "javascript:alert(1)" }] })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("doesn't count removed study toward category minutes", async () => {
    const { activity } = await study(40, BACKGROUND);
    await svc.deleteActivity(id, activity.id);
    expect((await view()).carriers[0]!.categories[0]!.evidence.creditedMinutes).toBe(0);
  });
});
