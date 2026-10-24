import { z } from "zod";

/**
 * Starter map: shareable curriculum and configuration with no personal history.
 * No activities, reports, sales, achievements, progress, purchases or notes
 * about real calls, ever. Personal notes are left out unless you opt in.
 */

export const STARTER_FORMAT = "meridian-starter";
export const STARTER_SCHEMA_VERSION = 1;

const text = z.string().max(20_000);

export const starterMapSchema = z.object({
  format: z.literal(STARTER_FORMAT),
  schemaVersion: z.number().int().positive(),
  appVersion: z.string(),
  exportedAt: z.string(),
  name: z.string().min(1).max(80),
  description: text.default(""),
  packRefs: z.array(z.object({ id: z.string(), version: z.string() })),
  config: z.object({
    overrides: z.record(z.unknown()).default({}),
    settings: z.object({ currency: z.string().min(3).max(3) }),
  }),
  curriculum: z.object({
    carriers: z
      .array(
        z.object({
          key: z.string().min(1),
          label: z.string().min(1).max(80),
          kind: z.enum(["carrier", "platform", "distributor", "other", "unspecified"]),
          notes: text.default(""),
          archived: z.boolean().default(false),
          sortOrder: z.number().default(0),
        }),
      )
      .default([]),
    products: z
      .array(z.object({ key: z.string().min(1), carrierKey: z.string().min(1), name: z.string().min(1).max(80), details: text.default(""), notes: text.default(""), archived: z.boolean().default(false) }))
      .default([]),
    knowledge: z
      .array(
        z.object({
          carrierKey: z.string().min(1),
          productKey: z.string().nullable(),
          categoryId: z.string().min(1),
          applicable: z.boolean().default(true),
          summary: text.default(""),
          checklist: z.array(z.object({ text: z.string().max(300) })).default([]),
          resources: z.array(z.object({ label: z.string().max(200), url: z.string().max(2000) })).default([]),
          notes: text.default(""),
        }),
      )
      .default([]),
    docket: z
      .array(z.object({ key: z.string().min(1), title: z.string().min(1).max(160), response: text.default(""), notes: text.default(""), archived: z.boolean().default(false), sortOrder: z.number().default(0) }))
      .default([]),
    courses: z.array(z.object({ key: z.string().min(1), name: z.string().min(1).max(80), kind: z.enum(["script", "app", "general"]), carrierKey: z.string().nullable() })).default([]),
    rapportCards: z.array(z.object({ kind: z.enum(["opener", "transition", "story", "question"]), title: z.string().min(1).max(120), body: text, scenarioKey: z.string().nullable() })).default([]),
    script: z.object({ title: z.string().min(1).max(80), sections: z.array(z.object({ id: z.string().min(1), name: z.string().min(1).max(60), body: text })).min(1) }).nullable().default(null),
  }),
});

export type StarterMap = z.infer<typeof starterMapSchema>;
