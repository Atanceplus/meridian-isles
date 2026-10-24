import type { ContentRegistry } from "../content/registry";
import type { CategoryLevelDef, KnowledgeCategorySeed, Tier } from "../content/schema";
import { dayKey } from "../domain/calendar";
import { categoryLevel, type CategoryEvidence } from "../domain/carrierLevels";
import { creditThroughTiers } from "../domain/tiers";
import type { ActivityRow, CarrierRow, InstanceBundle, KnowledgeRow, LedgerRow, ProductRow } from "../persistence/types";

/**
 * Carrier Archipelago model: derived views over your editable curriculum.
 * Category levels come from credited study minutes plus the evidence you write
 * (summary, checklist, reviews). A carrier is only as strong as its weakest
 * applicable category, across its carrier-wide categories and every active product.
 */

export const STUDY_TYPE = "fe:act.carrier-study";
/** A summary must be at least this long to count as written. */
export const SUMMARY_MIN_CHARS = 20;

export interface Subject {
  carrierKey: string;
  productKey: string | null;
  categoryId: string;
}

export function rowKey(instanceId: string, key: string): string {
  return `${instanceId}::${key}`;
}

export function knowledgeId(instanceId: string, s: Subject): string {
  return `${instanceId}::${s.carrierKey}::${s.productKey ?? "-"}::${s.categoryId}`;
}

export function subjectId(s: Subject): string {
  return `${s.carrierKey}|${s.productKey ?? "-"}|${s.categoryId}`;
}

/** The study subject named by a carrier-study activity's values. */
export function subjectFromValues(values: Record<string, unknown>): Subject | null {
  const carrierKey = values.carrierId;
  const categoryId = values.categoryId;
  if (typeof carrierKey !== "string" || typeof categoryId !== "string") return null;
  const productKey = typeof values.productId === "string" && values.productId !== "" ? values.productId : null;
  return { carrierKey, productKey, categoryId };
}

/**
 * Credited study minutes per subject: the per-category daily limit applied in
 * logging order. Removed records and records logged too late to earn XP don't count.
 */
export function creditedStudyMinutes(activities: ActivityRow[], ledger: LedgerRow[], tier: Tier | undefined): Map<string, number> {
  const late = new Set(ledger.filter((l) => l.status === "ineligible:backdated").map((l) => l.recordId));
  const rows = activities
    .filter((a) => a.typeId === STUDY_TYPE && a.status === "active" && !late.has(a.id))
    .sort((a, b) => (a.recordedAt === b.recordedAt ? (a.id < b.id ? -1 : 1) : a.recordedAt < b.recordedAt ? -1 : 1));

  const used = new Map<string, number>();
  const out = new Map<string, number>();
  for (const row of rows) {
    const subject = subjectFromValues(row.values);
    if (!subject) continue;
    const minutes = row.record.units;
    const id = subjectId(subject);
    const dayId = `${id}@${dayKey(row.occurredAt)}`;
    const before = used.get(dayId) ?? 0;
    const credited = tier ? creditThroughTiers(minutes, [{ tier, used: before }]) : minutes;
    used.set(dayId, before + minutes);
    out.set(id, (out.get(id) ?? 0) + credited);
  }
  return out;
}

export interface CategoryView {
  def: KnowledgeCategorySeed;
  subject: Subject;
  row: KnowledgeRow | null;
  evidence: CategoryEvidence;
  level: number;
  peak: number;
  /** The level reached before but currently lapsed (e.g. a stale review). */
  reviewDue: boolean;
  next: CategoryLevelDef | null;
}

export function evidenceFor(def: KnowledgeCategorySeed, row: KnowledgeRow | null, creditedMinutes: number): CategoryEvidence {
  const items = (row?.checklist ?? []).filter((c) => c.text.trim() !== "");
  return {
    applicable: def.canBeNotApplicable ? (row?.applicable ?? true) : true,
    creditedMinutes,
    summaryWritten: (row?.summary.trim().length ?? 0) >= SUMMARY_MIN_CHARS,
    checklistItems: items.length,
    checklistDone: items.filter((c) => c.done).length,
    lastReviewedOn: row?.lastReviewedOn ?? null,
    explainedWithoutNotes: row?.explainedWithoutNotes ?? false,
    resourceCount: (row?.resources ?? []).filter((r) => r.label.trim() !== "" || r.url.trim() !== "").length,
  };
}

export function categoryView(
  def: KnowledgeCategorySeed,
  subject: Subject,
  row: KnowledgeRow | null,
  minutes: Map<string, number>,
  levels: CategoryLevelDef[],
  today: string,
): CategoryView {
  const evidence = evidenceFor(def, row, minutes.get(subjectId(subject)) ?? 0);
  const level = categoryLevel(evidence, levels, today);
  const peak = Math.max(level, row?.peakLevel ?? 0);
  return { def, subject, row, evidence, level, peak, reviewDue: peak > level, next: levels[level + 1] ?? null };
}

export interface ProductView {
  product: ProductRow;
  categories: CategoryView[];
  level: number;
  peak: number;
}

export interface CarrierView {
  carrier: CarrierRow;
  categories: CategoryView[];
  products: ProductView[];
  level: number;
  /** Uses each category's peak; this is what restoration shows, so it never goes backwards. */
  peak: number;
  needsProduct: boolean;
}

export interface CurriculumView {
  levels: CategoryLevelDef[];
  carriers: CarrierView[];
  carrierCategories: KnowledgeCategorySeed[];
  productCategories: KnowledgeCategorySeed[];
}

export function buildCurriculumView(bundle: InstanceBundle, registry: ContentRegistry, today: string): CurriculumView {
  const levels = registry.seeds.categoryLevels;
  const studyTier = registry.activityTypeById[STUDY_TYPE]?.limits.dailyPerSubject;
  const minutes = creditedStudyMinutes(bundle.activities, bundle.ledger, studyTier);
  const rows = new Map(bundle.knowledge.map((k) => [subjectId(k), k]));
  const carrierCategories = registry.seeds.knowledgeCategories.filter((c) => c.scope === "carrier");
  const productCategories = registry.seeds.knowledgeCategories.filter((c) => c.scope === "product");

  const view = (def: KnowledgeCategorySeed, subject: Subject) => categoryView(def, subject, rows.get(subjectId(subject)) ?? null, minutes, levels, today);
  const minOf = (cats: CategoryView[], pick: (c: CategoryView) => number) => {
    const applicable = cats.filter((c) => c.evidence.applicable);
    return applicable.length === 0 ? 0 : Math.min(...applicable.map(pick));
  };

  const carriers = [...bundle.carriers]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
    .map((carrier): CarrierView => {
      const categories = carrierCategories.map((def) => view(def, { carrierKey: carrier.key, productKey: null, categoryId: def.id }));
      const products = bundle.products
        .filter((p) => p.carrierKey === carrier.key)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((product): ProductView => {
          const cats = productCategories.map((def) => view(def, { carrierKey: carrier.key, productKey: product.key, categoryId: def.id }));
          return { product, categories: cats, level: minOf(cats, (c) => c.level), peak: minOf(cats, (c) => c.peak) };
        });
      const active = products.filter((p) => !p.product.archived);
      const all = [...categories, ...active.flatMap((p) => p.categories)];
      const needsProduct = active.length === 0;
      return {
        carrier,
        categories,
        products,
        level: needsProduct ? 0 : minOf(all, (c) => c.level),
        peak: needsProduct ? 0 : minOf(all, (c) => c.peak),
        needsProduct,
      };
    });

  return { levels, carriers, carrierCategories, productCategories };
}

/**
 * A carrier's column in the Comparison Atlas is complete when every applicable
 * carrier-wide category and every applicable category of at least one active
 * product has a written summary.
 */
export function atlasComplete(c: CarrierView): boolean {
  const written = (v: CategoryView) => !v.evidence.applicable || v.evidence.summaryWritten;
  return c.categories.every(written) && c.products.some((p) => !p.product.archived && p.categories.every(written));
}
