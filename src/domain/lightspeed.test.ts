import { describe, expect, it } from "vitest";
import {
  checkpointState,
  evaluateAttempt,
  findSaleConflicts,
  retentionDueDate,
  type LightspeedAttempt,
  type LightspeedSale,
} from "./lightspeed";
import { DEFAULT_LIGHTSPEED, type LightspeedRules } from "./ruleset";

const rules = DEFAULT_LIGHTSPEED;

/** Ten sales one minute apart, starting 2027-01-31 14:00. */
function tenSales(overrides: Partial<LightspeedSale> = {}): Record<string, LightspeedSale> {
  const out: Record<string, LightspeedSale> = {};
  for (let i = 0; i < 10; i++) {
    const id = `s${i}`;
    out[id] = { id, submittedAt: `2027-01-31T14:${String(i * 3).padStart(2, "0")}:00`, ...overrides };
  }
  return out;
}

const attempt = (saleIds: string[], start = "2027-01-31T14:00:00", end = "2027-01-31T14:30:00"): LightspeedAttempt => ({
  id: "a1",
  windowStart: start,
  windowEnd: end,
  saleIds,
});

const ids = Array.from({ length: 10 }, (_, i) => `s${i}`);

describe("retention checkpoints", () => {
  it("are three calendar months after submission, clamped to month end", () => {
    expect(retentionDueDate({ id: "x", submittedAt: "2027-01-31T14:00:00" }, rules)).toBe("2027-04-30");
    expect(retentionDueDate({ id: "x", submittedAt: "2027-11-30T09:00:00" }, rules)).toBe("2028-02-29");
  });

  it("can use an entered anchor date instead, and say when it is missing", () => {
    const entered: LightspeedRules = { ...rules, checkpointAnchor: "enteredDate" };
    expect(retentionDueDate({ id: "x", submittedAt: "2027-01-31T14:00:00", anchorDate: "2027-02-15" }, entered)).toBe("2027-05-15");
    expect(checkpointState({ id: "x", submittedAt: "2027-01-31T14:00:00" }, entered, "2027-06-01T00:00:00").state).toBe("anchorMissing");
  });

  it("never treat silence as confirmation", () => {
    const sale: LightspeedSale = { id: "x", submittedAt: "2027-01-31T14:00:00" };
    expect(checkpointState(sale, rules, "2027-04-29T23:00:00").state).toBe("pending");
    expect(checkpointState(sale, rules, "2027-04-30T08:00:00").state).toBe("awaiting");
    expect(checkpointState(sale, rules, "2028-01-01T08:00:00").state).toBe("awaiting");
  });

  it("only accept confirmations made on or after the checkpoint", () => {
    const early: LightspeedSale = { id: "x", submittedAt: "2027-01-31T14:00:00", retention: { status: "confirmedOk", reportedAt: "2027-04-01T10:00:00" } };
    expect(checkpointState(early, rules, "2027-05-01T10:00:00").state).toBe("awaiting");
    const onTime: LightspeedSale = { ...early, retention: { status: "confirmedOk", reportedAt: "2027-04-30T10:00:00" } };
    expect(checkpointState(onTime, rules, "2027-05-01T10:00:00").state).toBe("confirmedOk");
  });

  it("accept a chargeback report at any time", () => {
    const sale: LightspeedSale = { id: "x", submittedAt: "2027-01-31T14:00:00", retention: { status: "chargeback", reportedAt: "2027-02-20T10:00:00" } };
    expect(checkpointState(sale, rules, "2027-02-21T10:00:00").state).toBe("chargeback");
  });
});

describe("evaluateAttempt", () => {
  it("collects until ten sales, then waits on checkpoints", () => {
    const sales = tenSales();
    expect(evaluateAttempt(attempt(ids.slice(0, 9)), sales, rules, "2027-02-01T00:00:00").status).toBe("collecting");
    expect(evaluateAttempt(attempt(ids), sales, rules, "2027-02-01T00:00:00").status).toBe("waiting");
    expect(evaluateAttempt(attempt(ids), sales, rules, "2027-05-01T00:00:00").status).toBe("waiting"); // awaiting confirmation
  });

  it("completes evidence only when every sale is confirmed", () => {
    const sales = tenSales({ retention: { status: "confirmedOk", reportedAt: "2027-04-30T09:00:00" } });
    sales.s7!.retention = { status: "confirmedOk", reportedAt: "2027-05-03T12:00:00" };
    const result = evaluateAttempt(attempt(ids), sales, rules, "2027-05-04T00:00:00");
    expect(result.status).toBe("evidenceComplete");
    expect(result.evidenceCompleteAt).toBe("2027-05-03T12:00:00");
  });

  it("fails the whole attempt on one chargeback, keeping its history", () => {
    const sales = tenSales({ retention: { status: "confirmedOk", reportedAt: "2027-04-30T09:00:00" } });
    sales.s3!.retention = { status: "chargeback", reportedAt: "2027-03-10T09:00:00" };
    const result = evaluateAttempt(attempt(ids), sales, rules, "2027-05-04T00:00:00");
    expect(result.status).toBe("failed");
    expect(result.sales).toHaveLength(10);
    expect(result.sales.find((s) => s.saleId === "s3")!.checkpoint).toBe("chargeback");
  });

  it("accepts a window of exactly 30 minutes and rejects anything longer", () => {
    const sales = tenSales();
    expect(evaluateAttempt(attempt(ids, "2027-01-31T14:00:00", "2027-01-31T14:30:00"), sales, rules, "2027-02-01T00:00:00").issues).toEqual([]);
    const long = evaluateAttempt(attempt(ids, "2027-01-31T14:00:00", "2027-01-31T14:30:01"), sales, rules, "2027-02-01T00:00:00");
    expect(long.status).toBe("invalid");
    expect(long.issues[0]).toMatch(/longer than 30 minutes/);
  });

  it("rejects sales from outside the window, duplicates, unknown sales and extra sales", () => {
    const sales = tenSales();
    sales.late = { id: "late", submittedAt: "2027-01-31T16:00:00" };
    const outside = evaluateAttempt(attempt([...ids.slice(0, 9), "late"]), sales, rules, "2027-02-01T00:00:00");
    expect(outside.status).toBe("invalid");
    expect(outside.issues.join(" ")).toMatch(/outside this attempt's window/);

    expect(evaluateAttempt(attempt([...ids.slice(0, 9), "s0"]), sales, rules, "2027-02-01T00:00:00").issues.join(" ")).toMatch(/more than once/);
    expect(evaluateAttempt(attempt([...ids.slice(0, 9), "ghost"]), sales, rules, "2027-02-01T00:00:00").issues.join(" ")).toMatch(/does not exist/);

    sales.extra = { id: "extra", submittedAt: "2027-01-31T14:29:00" };
    expect(evaluateAttempt(attempt([...ids, "extra"]), sales, rules, "2027-02-01T00:00:00").issues.join(" ")).toMatch(/exactly 10/);
  });
});

describe("findSaleConflicts", () => {
  const a1: LightspeedAttempt = { id: "a1", windowStart: "", windowEnd: "", saleIds: ["s1", "s2"] };
  const a2: LightspeedAttempt = { id: "a2", windowStart: "", windowEnd: "", saleIds: ["s2", "s3"] };

  it("flags a sale used by two attempts", () => {
    expect(findSaleConflicts([a1, a2], { a1: "waiting", a2: "collecting" }, rules)).toEqual([{ saleId: "s2", attemptIds: ["a1", "a2"] }]);
  });

  it("keeps a failed attempt's sales unless substitution is enabled", () => {
    expect(findSaleConflicts([a1, a2], { a1: "failed", a2: "collecting" }, rules)).toHaveLength(1);
    expect(findSaleConflicts([a1, a2], { a1: "failed", a2: "collecting" }, { ...rules, allowSubstitutionFromSameWindow: true })).toEqual([]);
  });
});
