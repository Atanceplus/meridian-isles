import { beforeEach, describe, expect, it } from "vitest";
import { CommandService } from "./commands";
import { MemoryStorage } from "../persistence/storage";
import { MemorySecretStore } from "../persistence/secrets";
import { buildPersonalSave } from "../persistence/exportSave";
import { parseSaveFile } from "../persistence/importSave";
import { mockDailyReport, mockSale } from "../integrations/mockGrokbot";
import { SK, registry } from "../test/helpers";

let now: string;
let storage: MemoryStorage;
let svc: CommandService;
let id: string;
let botId: string;

beforeEach(async () => {
  now = "2027-03-01T20:00:00";
  storage = new MemoryStorage();
  svc = new CommandService(storage, registry, () => now);
  id = (await svc.createInstance("Main")).id;
  botId = (await svc.integrations.addSource(id, { name: "Grokbot", adapter: "mock-grokbot" })).id;
});

const speed = async () => (await svc.load(id)).state.skills[SK.speed]!.score;

describe("permissions", () => {
  it("start with no access, and refused submissions change nothing", async () => {
    const r = await svc.integrations.receive(id, botId, mockDailyReport("2027-03-01"));
    expect(r.outcome).toBe("refused");
    expect(r.submission.errors[0]).toMatch(/no access to daily reports/);
    const { bundle } = await svc.load(id);
    expect(bundle.dailyReports).toEqual([]);
    expect(bundle.submissions).toHaveLength(1); // kept for the audit trail
  });

  it("let a refused delivery be retried once access is granted", async () => {
    expect((await svc.integrations.receive(id, botId, mockDailyReport("2027-03-01"))).outcome).toBe("refused");
    await svc.integrations.setPermission(id, botId, "dailyReport", "submit");
    expect((await svc.integrations.receive(id, botId, mockDailyReport("2027-03-01"))).outcome).toBe("pending");
  });

  it("need explicit confirmation for automatic acceptance", async () => {
    await expect(svc.integrations.setPermission(id, botId, "dailyReport", "autoAccept")).rejects.toThrow(/Confirm it/);
    const s = await svc.integrations.setPermission(id, botId, "dailyReport", "autoAccept", { confirmAutoAccept: true });
    expect(s.permissions).toEqual({ dailyReport: "autoAccept", sale: "none" });
  });

  it("are per category", async () => {
    await svc.integrations.setPermission(id, botId, "dailyReport", "submit");
    expect((await svc.integrations.receive(id, botId, mockDailyReport("2027-03-01"))).outcome).toBe("pending");
    expect((await svc.integrations.receive(id, botId, mockSale("2027-03-01T14:00", null, 1))).outcome).toBe("refused");
  });
});

describe("approval inbox", () => {
  beforeEach(async () => {
    await svc.integrations.setPermission(id, botId, "dailyReport", "submit");
    await svc.integrations.setPermission(id, botId, "sale", "submit");
  });

  it("changes nothing until approved, then writes through the ordinary commands with the source recorded", async () => {
    const { submission } = await svc.integrations.receive(id, botId, mockDailyReport("2027-03-01"));
    expect((await svc.load(id)).bundle.dailyReports).toEqual([]);
    expect(await speed()).toBe(0);

    const approved = await svc.integrations.approve(id, submission.id);
    expect(approved.submission).toMatchObject({ status: "approved", decidedBy: "user" });
    const { bundle } = await svc.load(id);
    expect(bundle.dailyReports[0]).toMatchObject({ date: "2027-03-01", source: { kind: "integration", sourceId: botId, externalId: "grokbot:report:2027-03-01" } });
    expect(await speed()).toBeGreaterThan(0);
    expect(bundle.audit.some((a) => a.actor === botId && a.action === "report.create")).toBe(true);
    await expect(svc.integrations.approve(id, submission.id)).rejects.toThrow(/already approved/);
  });

  it("rejects without changing records", async () => {
    const { submission } = await svc.integrations.receive(id, botId, mockSale("2027-03-01T14:00", "Americo", 1));
    await svc.integrations.reject(id, submission.id, "Not mine");
    const { bundle } = await svc.load(id);
    expect(bundle.sales).toEqual([]);
    expect(bundle.submissions[0]).toMatchObject({ status: "rejected", note: "Not mine" });
  });

  it("matches the sale's carrier by name", async () => {
    const { submission } = await svc.integrations.receive(id, botId, mockSale("2027-03-01T14:00", "americo", 1));
    await svc.integrations.approve(id, submission.id);
    expect((await svc.load(id)).bundle.sales[0]!.carrierId).toBe("fe:carrier.americo");
  });

  it("refuses malformed payloads with readable reasons", async () => {
    const r = await svc.integrations.receive(id, botId, { externalId: "x1", category: "dailyReport", payload: { date: "yesterday", calls: -3 } });
    expect(r.outcome).toBe("refused");
    expect(r.submission.errors.join(" ")).toMatch(/date must be yyyy-MM-dd/);
    expect((await svc.integrations.receive(id, botId, "garbage")).outcome).toBe("refused");
  });
});

describe("duplicate prevention", () => {
  beforeEach(async () => {
    await svc.integrations.setPermission(id, botId, "dailyReport", "submit");
    await svc.integrations.setPermission(id, botId, "sale", "submit");
  });

  it("treats a repeated delivery as the same submission", async () => {
    const first = await svc.integrations.receive(id, botId, mockDailyReport("2027-03-01"));
    const again = await svc.integrations.receive(id, botId, mockDailyReport("2027-03-01"));
    expect(again.outcome).toBe("duplicate");
    expect(again.submission.id).toBe(first.submission.id);
    expect((await svc.load(id)).bundle.submissions).toHaveLength(1);
  });

  it("refuses a changed payload under an id already received", async () => {
    await svc.integrations.receive(id, botId, mockDailyReport("2027-03-01"));
    const changed = await svc.integrations.receive(id, botId, mockDailyReport("2027-03-01", 1));
    expect(changed.outcome).toBe("refused");
    expect(changed.submission.errors[0]).toMatch(/different payload was already received/);
  });

  it("never awards progress twice, even if an approval is replayed", async () => {
    await svc.integrations.setPermission(id, botId, "dailyReport", "autoAccept", { confirmAutoAccept: true });
    const r = await svc.integrations.receive(id, botId, mockDailyReport("2027-03-01"));
    expect(r.outcome).toBe("applied");
    const after = await speed();
    expect((await svc.integrations.receive(id, botId, mockDailyReport("2027-03-01"))).outcome).toBe("duplicate");
    expect(await speed()).toBe(after);
  });

  it("re-applying an already-applied sale returns the same sale", async () => {
    const { submission } = await svc.integrations.receive(id, botId, mockSale("2027-03-01T14:00", null, 1));
    await svc.integrations.approve(id, submission.id);
    const sale = (await svc.load(id)).bundle.sales[0]!;
    const replay = await svc.saveSale(id, { submittedAt: sale.submittedAt, carrierId: null, issuePaid: sale.issuePaid, source: sale.source });
    expect(replay.id).toBe(sale.id);
    expect((await svc.load(id)).bundle.sales).toHaveLength(1);
  });

  it("flags submissions that look like records you already have", async () => {
    await svc.saveDailyReport(id, { date: "2027-03-01", calls: 50, hours: 4, applicationsSubmitted: 1, issuePaid: null });
    await svc.saveSale(id, { submittedAt: "2027-03-01T14:00", carrierId: null, issuePaid: 500 });
    const report = await svc.integrations.receive(id, botId, mockDailyReport("2027-03-01"));
    expect(report.submission.warnings[0]).toMatch(/already have a report for 2027-03-01/);
    const sale = await svc.integrations.receive(id, botId, { externalId: "s-9", category: "sale", payload: { submittedAt: "2027-03-01T14:00", issuePaid: 500 } });
    expect(sale.submission.warnings[0]).toMatch(/already exists/);
  });
});

describe("credentials and saves", () => {
  it("keeps credentials out of exports, and imported sources never auto-accept", async () => {
    const secrets = new MemorySecretStore();
    await secrets.set(botId, "sk-test-123");
    await svc.integrations.setPermission(id, botId, "dailyReport", "autoAccept", { confirmAutoAccept: true });
    const save = await buildPersonalSave(storage, id, "test", now);
    const text = JSON.stringify(save);
    expect(text).not.toContain("sk-test-123");
    expect(save.data.integrationSources).toHaveLength(1);

    const parsed = await parseSaveFile(text);
    if (parsed.kind !== "personal") throw new Error();
    const { instance, warnings } = await svc.archive.importPersonal(parsed.save);
    expect(warnings.join(" ")).toMatch(/automatic acceptance was turned off/);
    expect((await svc.load(instance.id)).bundle.integrationSources[0]!.permissions.dailyReport).toBe("submit");
  });
});
