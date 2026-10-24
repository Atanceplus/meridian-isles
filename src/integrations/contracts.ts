import { z } from "zod";
import type { SubmissionCategory } from "../persistence/types";

/**
 * What outside sources may send. Every submission is one envelope: the
 * source's own id for it (for idempotent delivery), a category, and a payload
 * validated here before anything else looks at it.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be yyyy-MM-dd");
const dateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, "time must be yyyy-MM-ddTHH:mm");
const count = z.number().int().min(0).max(100_000);

export const PAYLOAD_SCHEMAS = {
  dailyReport: z
    .object({
      date: day,
      calls: count,
      hours: z.number().min(0).max(24),
      applicationsSubmitted: count,
      issuePaid: z.number().min(0).nullable().default(null),
      notes: z.string().max(2000).default(""),
    })
    .strict(),
  sale: z
    .object({
      submittedAt: dateTime,
      /** Carrier name as the source knows it; matched to your carriers by label. */
      carrier: z.string().max(80).nullable().default(null),
      product: z.string().max(80).default(""),
      issuePaid: z.number().min(0).nullable().default(null),
      policyRef: z.string().max(80).default(""),
    })
    .strict(),
} satisfies Record<SubmissionCategory, z.ZodTypeAny>;

export type DailyReportPayload = z.infer<(typeof PAYLOAD_SCHEMAS)["dailyReport"]>;
export type SalePayload = z.infer<(typeof PAYLOAD_SCHEMAS)["sale"]>;

export const envelopeSchema = z.object({
  externalId: z.string().min(1).max(200),
  category: z.enum(["dailyReport", "sale"]),
  payload: z.unknown(),
});
export type SubmissionEnvelope = z.infer<typeof envelopeSchema>;

export const CATEGORY_LABEL: Record<SubmissionCategory, string> = {
  dailyReport: "Daily call reports",
  sale: "Itemized sales",
};

/** An adapter turns a source's data into envelopes. Live adapters (bot, bank, API, MCP) plug in here later. */
export interface IntegrationAdapter {
  id: string;
  name: string;
  description: string;
  categories: SubmissionCategory[];
  /** True for simulations that never contact anything. */
  simulated: boolean;
}

/** Stable JSON (sorted keys) for hashing payloads. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
    .join(",")}}`;
}

export async function payloadHash(payload: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableJson(payload)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
