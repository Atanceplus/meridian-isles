import type { Tier } from "../content/schema";

export interface TierPosition {
  tier: Tier;
  /** Units already counted against this tier before the new amount. */
  used: number;
}

/**
 * How much of `amount` new units is credited when it passes through several
 * diminishing-returns tiers at once (e.g. a per-subject daily limit and a
 * per-activity daily limit). Each unit's credit is the product of every tier's
 * rate at that unit's position, so the strictest tier always wins.
 */
export function creditThroughTiers(amount: number, positions: TierPosition[]): number {
  if (!(amount > 0)) return 0;

  const breaks = new Set<number>([0, amount]);
  for (const { tier, used } of positions) {
    for (const edge of [tier.fullUpTo - used, tier.reducedUpTo - used]) {
      if (edge > 0 && edge < amount) breaks.add(edge);
    }
  }
  const points = [...breaks].sort((a, b) => a - b);

  let credited = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]!;
    const end = points[i + 1]!;
    const mid = (start + end) / 2;
    let rate = 1;
    for (const { tier, used } of positions) rate *= rateAt(tier, used + mid);
    credited += (end - start) * rate;
  }
  return credited;
}

function rateAt(tier: Tier, position: number): number {
  if (position < tier.fullUpTo) return 1;
  if (position < tier.reducedUpTo) return tier.reducedRate;
  return 0;
}
