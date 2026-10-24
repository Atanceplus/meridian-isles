import type { IntegrationAdapter, SubmissionEnvelope } from "./contracts";

/**
 * A simulated Grokbot. It never contacts anything: it only produces the kind
 * of envelopes a real bot would send, so the inbox, permissions and duplicate
 * handling can be exercised before any live connection exists.
 */
export const MOCK_GROKBOT: IntegrationAdapter = {
  id: "mock-grokbot",
  name: "Grokbot (simulated)",
  description: "Sends sample daily call reports and sales. No real connection; nothing leaves this browser.",
  categories: ["dailyReport", "sale"],
  simulated: true,
};

function seeded(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** A day's report. The id is derived from the date, so resending the same day is a duplicate delivery. */
export function mockDailyReport(date: string, variant = 0): SubmissionEnvelope {
  const r = seeded(`${date}:${variant}`);
  const hours = Math.round((4 + r() * 4) * 2) / 2;
  const calls = Math.round(hours * (14 + r() * 10));
  const sales = Math.floor(r() * 4);
  return {
    externalId: `grokbot:report:${date}`,
    category: "dailyReport",
    payload: { date, calls, hours, applicationsSubmitted: sales, issuePaid: sales ? Math.round(sales * (380 + r() * 300)) : null, notes: "Sent by Grokbot (simulated)" },
  };
}

/** One sale at a given time, with an id unique to that sale. */
export function mockSale(submittedAt: string, carrier: string | null, n: number): SubmissionEnvelope {
  const r = seeded(`${submittedAt}:${n}`);
  return {
    externalId: `grokbot:sale:${submittedAt}:${n}`,
    category: "sale",
    payload: { submittedAt, carrier, product: "", issuePaid: Math.round(350 + r() * 400), policyRef: "" },
  };
}
