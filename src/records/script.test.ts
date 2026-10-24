import { beforeEach, describe, expect, it } from "vitest";
import { CommandService } from "./commands";
import { MemoryStorage } from "../persistence/storage";
import type { ScriptSection } from "../persistence/types";
import { creditedRehearsalMinutes, diffScripts, meaningfulCount, rehearsalBySection, trackLevel } from "./script";
import { ACT, SK, registry } from "../test/helpers";

let now: string;
let svc: CommandService;
let id: string;
let scriptId: string;
let n: number;

beforeEach(async () => {
  now = "2027-01-04T09:00:00";
  n = 0;
  svc = new CommandService(new MemoryStorage(), registry, () => now, () => `id${++n}`);
  id = (await svc.createInstance("Main")).id;
  scriptId = (await svc.load(id)).bundle.scripts[0]!.id;
});

const sections = async () => {
  const { bundle } = await svc.load(id);
  const script = bundle.scripts[0]!;
  return bundle.scriptRevisions.find((r) => r.id === script.currentRevisionId)!.sections;
};
const edit = async (sectionId: string, body: string) =>
  svc.scripts.saveDraft(id, scriptId, (await sections()).map((s) => (s.id === sectionId ? { ...s, body } : s)));

describe("drafts and revisions", () => {
  it("keeps every save as history, folding quick bursts into one revision", async () => {
    await edit("opener", "Hi");
    now = "2027-01-04T09:00:30";
    await edit("opener", "Hi there");
    let { bundle } = await svc.load(id);
    expect(bundle.scriptRevisions).toHaveLength(2); // original + one burst

    now = "2027-01-04T09:05:00";
    await edit("opener", "Hi there, this is Sam");
    ({ bundle } = await svc.load(id));
    expect(bundle.scriptRevisions).toHaveLength(3);
    // The original template revision is never overwritten.
    expect(bundle.scriptRevisions.find((r) => r.parentId === null)!.sections[0]!.body).toBe("");
  });

  it("does nothing when the content is unchanged", async () => {
    const before = (await svc.load(id)).bundle.scriptRevisions.length;
    await svc.scripts.saveDraft(id, scriptId, await sections());
    expect((await svc.load(id)).bundle.scriptRevisions).toHaveLength(before);
  });

  it("validates sections", async () => {
    await expect(svc.scripts.saveDraft(id, scriptId, [])).rejects.toThrow(/at least one section/);
    await expect(svc.scripts.saveDraft(id, scriptId, [{ id: "a", name: " ", body: "" }])).rejects.toThrow(/needs a name/);
    await expect(
      svc.scripts.saveDraft(id, scriptId, [
        { id: "a", name: "A", body: "" },
        { id: "a", name: "B", body: "" },
      ]),
    ).rejects.toThrow(/own id/);
  });
});

describe("versions and meaningful improvements", () => {
  const NOTE = "Shortened the opener and added a pause before the question.";

  it("names versions and refuses an unchanged one", async () => {
    await edit("opener", "Hello");
    const v1 = await svc.scripts.createVersion(id, scriptId, "v1", "First pass");
    expect(v1).toMatchObject({ name: "v1", meaningful: null });
    await expect(svc.scripts.createVersion(id, scriptId, "v1 again", "")).rejects.toThrow(/Nothing has changed since "v1"/);
  });

  it("a version's revision is never folded into later typing", async () => {
    await edit("opener", "Hello");
    const v1 = await svc.scripts.createVersion(id, scriptId, "v1", "");
    now = "2027-01-04T09:00:10";
    await edit("opener", "Hello again");
    const { bundle } = await svc.load(id);
    expect(bundle.scriptRevisions.find((r) => r.id === v1.revisionId)!.sections[0]!.body).toBe("Hello");
  });

  it("earns XP only when explicitly marked, with a real note, once", async () => {
    await edit("opener", "Hello, this is Sam with a quick question.");
    const v1 = await svc.scripts.createVersion(id, scriptId, "v1", "");
    await expect(svc.scripts.markMeaningful(id, v1.id, "brevity", "short")).rejects.toThrow(/at least 40 characters/);

    const result = await svc.scripts.markMeaningful(id, v1.id, "brevity", NOTE);
    expect(result.lines.filter((l) => l.status === "awarded").map((l) => [l.skillId, l.amount])).toEqual([
      [SK.speed, 12.5],
      [SK.tonality, 12.5],
    ]);
    await expect(svc.scripts.markMeaningful(id, v1.id, "brevity", NOTE)).rejects.toThrow(/already marked/);
    expect(meaningfulCount((await svc.load(id)).bundle.scriptVersions)).toBe(1);
  });

  it("refuses to mark a version identical to the one before it", async () => {
    await edit("opener", "Hello");
    await svc.scripts.createVersion(id, scriptId, "v1", "");
    await edit("opener", "Hello!");
    await edit("opener", "Hello");
    const v2 = await svc.scripts.createVersion(id, scriptId, "v2", "").catch((e) => e);
    // Content is back to v1, so v2 can't even be created.
    expect(String(v2)).toMatch(/Nothing has changed/);
  });

  it("can't be logged or removed outside the Foundry, and unmarking reverses its XP", async () => {
    await expect(svc.logActivity(id, ACT.revision, { tag: "flow", note: NOTE }, { occurredAt: "2027-01-04T08:00" })).rejects.toThrow(/Script Foundry/);
    await edit("close", "Would you like to get started today?");
    const v1 = await svc.scripts.createVersion(id, scriptId, "v1", "");
    const { version } = await svc.scripts.markMeaningful(id, v1.id, "flow", NOTE);
    await expect(svc.deleteActivity(id, version.meaningful!.activityId)).rejects.toThrow(/Script Foundry/);

    const undo = await svc.scripts.unmarkMeaningful(id, v1.id);
    expect(undo.lines.map((l) => l.amount)).toEqual([-12.5, -12.5]);
    expect((await svc.load(id)).state.skills[SK.speed]!.score).toBe(0);
  });
});

describe("pure helpers", () => {
  const a: ScriptSection[] = [
    { id: "opener", name: "Opener", body: "Hi there, this is Sam." },
    { id: "close", name: "Close", body: "Thanks!" },
  ];
  const b: ScriptSection[] = [
    { id: "opener", name: "Greeting", body: "Hi, this is Sam calling." },
    { id: "new", name: "Rapport", body: "How has your week been?" },
  ];

  it("diffs scripts section by section", () => {
    const d = diffScripts(a, b);
    expect(d.map((s) => [s.id, s.status])).toEqual([
      ["opener", "changed"],
      ["new", "added"],
      ["close", "removed"],
    ]);
    expect(d[0]!.oldName).toBe("Opener");
    expect(d[0]!.parts.some((p) => p.added && p.value.includes("calling"))).toBe(true);
    expect(diffScripts(a, a).every((s) => s.status === "same")).toBe(true);
  });

  it("places values on a track ladder", () => {
    const ladder = registry.seeds.scriptTracks!.rehearsal;
    expect(trackLevel(ladder, 0)).toMatchObject({ name: "Silent", next: { name: "Reader" } });
    expect(trackLevel(ladder, 180)).toMatchObject({ name: "Reader", progress: 0.5 });
    expect(trackLevel(ladder, 99999)).toMatchObject({ name: "Virtuoso", next: null, progress: 1 });
  });

  it("credits rehearsal minutes with the daily limit and splits section time", async () => {
    await svc.logActivity(id, ACT.rehearsal, { minutes: 60, sections: ["opener", "close"] }, { occurredAt: "2027-01-04T08:00", mode: "aloud" });
    const { bundle } = await svc.load(id);
    expect(creditedRehearsalMinutes(bundle.activities, bundle.ledger, registry.activityTypeById[ACT.rehearsal]!.limits.daily)).toBe(52.5);
    expect(rehearsalBySection(bundle.activities).get("opener")).toMatchObject({ minutes: 30, sessions: 1 });
  });
});
