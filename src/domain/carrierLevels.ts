import type { CategoryLevelDef } from "../content/schema";
import { daysBetween, type DayKey } from "./calendar";

/**
 * Knowledge-category levels in the Carrier Archipelago (Uncharted → Mastered).
 * Separate from the Product Knowledge score: these measure coverage of each
 * carrier/product category, and a carrier is only as strong as its weakest one.
 */

export interface CategoryEvidence {
  applicable: boolean;
  /** Study minutes after the per-category daily limit. */
  creditedMinutes: number;
  summaryWritten: boolean;
  checklistItems: number;
  checklistDone: number;
  lastReviewedOn: DayKey | null;
  explainedWithoutNotes: boolean;
  resourceCount: number;
}

/** Highest level whose requirements are all currently met. Levels must be cumulative and in order. */
export function categoryLevel(evidence: CategoryEvidence, levels: CategoryLevelDef[], today: DayKey): number {
  let reached = 0;
  for (const level of levels) {
    if (!meetsLevel(evidence, level, today)) break;
    reached = level.index;
  }
  return reached;
}

/** A carrier's level is the lowest level among its applicable categories, so no single subject can carry it. */
export function carrierLevel(categories: CategoryEvidence[], levels: CategoryLevelDef[], today: DayKey): number {
  const applicable = categories.filter((c) => c.applicable);
  if (applicable.length === 0) return 0;
  return Math.min(...applicable.map((c) => categoryLevel(c, levels, today)));
}

function meetsLevel(e: CategoryEvidence, level: CategoryLevelDef, today: DayKey): boolean {
  const r = level.requires;
  if (e.creditedMinutes < level.minCreditedMinutes) return false;
  if (r.summaryWritten && !e.summaryWritten) return false;
  if (r.checklistMinItems !== undefined && e.checklistItems < r.checklistMinItems) return false;
  if (r.checklistComplete && (e.checklistItems === 0 || e.checklistDone < e.checklistItems)) return false;
  if (r.reviewedWithinDays !== undefined) {
    if (e.lastReviewedOn === null || daysBetween(e.lastReviewedOn, today) > r.reviewedWithinDays) return false;
  }
  if (r.explainedWithoutNotes && !e.explainedWithoutNotes) return false;
  if (r.minResources !== undefined && e.resourceCount < r.minResources) return false;
  return true;
}
