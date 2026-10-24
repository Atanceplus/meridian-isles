import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { DexieStorage } from "./dexieStorage";
import { CommandService } from "../records/commands";
import { ACT, SK, registry } from "../test/helpers";

describe("DexieStorage", () => {
  it("persists a map across service instances and deletes it completely", async () => {
    const name = `test-${Math.random()}`;
    let now = "2027-01-04T18:00:00";
    const storage = new DexieStorage(name);
    const svc = new CommandService(storage, registry, () => now);
    const { id } = await svc.createInstance("Main");
    await svc.logActivity(id, ACT.tonalityDrill, { minutes: 30, drillType: "pace" }, { occurredAt: "2027-01-04T17:00" });
    now = "2027-01-04T19:00:00";
    await svc.saveDailyReport(id, { date: "2027-01-04", calls: 40, hours: 2, applicationsSubmitted: 1, issuePaid: 450 });
    storage.close();

    const reopened = new DexieStorage(name);
    const svc2 = new CommandService(reopened, registry, () => now);
    const view = await svc2.load(id);
    expect(view.state.skills[SK.tonality]!.score).toBe(90 + 4.8);
    expect(view.bundle.dailyReports).toHaveLength(1);
    expect((await reopened.loadEvents(id)).map((e) => e.seq)).toEqual([1, 2]);

    await svc2.deleteInstance(id);
    expect(await reopened.listInstances()).toEqual([]);
    expect(await reopened.loadEvents(id)).toEqual([]);
    expect(await reopened.loadBundle(id)).toBeNull();
    reopened.close();
  });

  it("rolls back a commit that fails part-way", async () => {
    const storage = new DexieStorage(`test-${Math.random()}`);
    await expect(storage.commit("missing", { put: { audit: [] } })).rejects.toThrow(/Unknown instance/);
    expect(await storage.listInstances()).toEqual([]);
    storage.close();
  });
});
