import { parseISO } from "date-fns";
import type { ContentRegistry } from "../content/registry";
import { daysBetween, evaluateAttempt, weekKey, type LightspeedSale, type Ruleset } from "../domain";
import type { ActivityRow, InstanceBundle, SaleRow } from "../persistence/types";
import { atlasComplete, buildCurriculumView } from "./curriculum";

/**
 * Checks each gate achievement against your records, so the Trophy Hall can
 * show real progress and a completion is backed by what you logged. Items your
 * records can't show (a teach-back recording, say) are listed as manual: you
 * attest to them yourself.
 */

export type Requirement =
  | { kind: "check"; text: string; current: number; required: number; met: boolean }
  | { kind: "manual"; text: string };

export interface EvalContext {
  bundle: InstanceBundle;
  registry: ContentRegistry;
  ruleset: Ruleset;
  /** Local date-time now. */
  now: string;
}

export const LIGHTSPEED_ID = "core:ach.speed.lightspeed";

const check = (text: string, current: number, required: number): Requirement => ({
  kind: "check",
  text,
  current: Math.min(current, required),
  required,
  met: current >= required,
});
const manual = (text: string): Requirement => ({ kind: "manual", text });

type Evaluator = (ctx: EvalContext, h: Helpers) => Requirement[];

interface Helpers {
  acts(typeId: string): ActivityRow[];
  weeks(rows: { occurredAt: string }[]): number;
  num(row: ActivityRow, key: string): number | undefined;
}

const EVALUATORS: Record<string, Evaluator> = {
  // ---------- Tonality ----------
  "core:ach.tonality.first-signal": (_, h) => {
    const reviewed = h.acts("core:act.script-rehearsal").filter((a) => a.record.mode === "recorded" && hasRatings(h, a, ["pace", "clarity", "warmth"], 1));
    return [check("Recorded rehearsals self-reviewed with all three ratings", reviewed.length, 3)];
  },
  "core:ach.tonality.tuned-in": (ctx, h) => {
    const drills = h.acts("core:act.tonality-drill");
    const types = new Set(drills.map((d) => d.values.drillType).filter(Boolean));
    const sections = currentSectionIds(ctx.bundle);
    const fullRead = h
      .acts("core:act.script-rehearsal")
      .some((a) => a.record.mode === "recorded" && sections.every((s) => (a.values.sections as string[] | undefined)?.includes(s)) && hasRatings(h, a, ["pace", "clarity", "warmth"], 3));
    return [check("Tonality drills", drills.length, 20), check("Different drill types", types.size, 4), check("Recorded full-script read rated 3+ on every rating", fullRead ? 1 : 0, 1)];
  },
  "core:ach.tonality.prime-time": (_, h) => {
    const reviews = h.acts("core:act.call-review").filter((a) => h.num(a, "tonality") !== undefined);
    return [check("Call reviews with a tonality rating", reviews.length, 10), check("…across different weeks", h.weeks(reviews), 6)];
  },
  "core:ach.tonality.golden-frequency": (_, h) => {
    const strong = h.acts("core:act.call-review").filter((a) => hasRatings(h, a, ["tonality", "pacing"], 4));
    return [check("Weeks with a reviewed call rated 4+ on tonality and pacing", h.weeks(strong), 3)];
  },

  // ---------- Objection handling ----------
  "core:ach.objections.docket-opened": (ctx) => {
    const written = ctx.bundle.docket.filter((c) => !c.archived && c.response.trim().length >= 10);
    return [check("Docket cases with a written response", written.length, 10)];
  },
  "core:ach.objections.counsel-sworn": (ctx, h) => {
    const cases = ctx.bundle.docket.filter((c) => !c.archived);
    const spoken = new Map<string, number>();
    for (const a of h.acts("core:act.objection-practice")) {
      if (a.record.mode === "written") continue;
      const key = String(a.values.caseId);
      spoken.set(key, (spoken.get(key) ?? 0) + a.record.units);
    }
    return [check("Docket cases with 10+ spoken reps", cases.filter((c) => (spoken.get(c.key) ?? 0) >= 10).length, Math.max(1, cases.length))];
  },
  "core:ach.objections.barrister": (ctx) => {
    const e = ctx.bundle.objectionEncounters;
    return [check("Real objections logged", e.length, 25), check("Different case types", new Set(e.map((x) => x.caseKey)).size, 8)];
  },
  "core:ach.objections.chief-justice": (ctx, h) => {
    const passed = ctx.bundle.rebuttalTrials.filter((t) => t.results.length >= 15 && t.results.filter((r) => r.fluent).length / t.results.length >= 0.9);
    return [check("Weeks with a passed 15-case Rebuttal Trial (90%+ fluent)", h.weeks(passed.map((t) => ({ occurredAt: t.at }))), 3)];
  },

  // ---------- Small talk ----------
  "core:ach.small-talk.open-door": (ctx) => [check("Rapport Library cards", ctx.bundle.rapportCards.length, 15)],
  "core:ach.small-talk.storyteller": (_, h) => {
    const practice = h.acts("core:act.small-talk-practice");
    const reps = practice.reduce((n, a) => n + (h.num(a, "reps") ?? 1), 0);
    return [check("Practice reps", reps, 50), check("Different scenarios", new Set(practice.map((a) => a.values.scenarioId)).size, 5)];
  },
  "core:ach.small-talk.confidant": (ctx) => [check("Real-call rapport notes", ctx.bundle.rapportNotes.length, 20)],
  "core:ach.small-talk.hearthkeeper": (_, h) => {
    const strong = h.acts("core:act.call-review").filter((a) => hasRatings(h, a, ["rapport", "transition"], 4));
    return [check("Call reviews rated 4+ on rapport and on transition back to business", strong.length, 5)];
  },

  // ---------- Speed ----------
  "core:ach.speed.off-the-line": (ctx, h) => {
    const courses = ctx.bundle.courses.filter((c) => c.kind === "script" && c.targetSeconds !== null);
    const beat = courses.some((c) =>
      h.acts("core:act.time-trial").some((a) => a.values.courseId === c.key && a.values.clean === true && (h.num(a, "durationSeconds") ?? Infinity) < c.targetSeconds! && a.occurredAt.slice(0, 10) >= c.targetSetOn!),
    );
    return [check("A script course with a target time set", courses.length, 1), check("A clean run under that target, after setting it", beat ? 1 : 0, 1)];
  },
  "core:ach.speed.pit-crew": (ctx, h) => {
    const carriers = new Set<string>();
    for (const c of ctx.bundle.courses.filter((x) => x.kind === "app" && x.targetSeconds !== null && x.carrierKey)) {
      const beat = h
        .acts("fe:act.app-navigation")
        .some((a) => a.values.carrierId === c.carrierKey && a.values.completed === true && (h.num(a, "durationSeconds") ?? Infinity) < c.targetSeconds! && a.occurredAt.slice(0, 10) >= c.targetSetOn!);
      if (beat) carriers.add(c.carrierKey!);
    }
    return [check("Carriers with application navigation under your target", carriers.size, 3)];
  },
  "core:ach.speed.express-service": (ctx) => [check("Most sales within one 60-minute window", maxInWindow(ctx.bundle.sales, 60), 5)],
  [LIGHTSPEED_ID]: (ctx) => {
    let best = 0;
    for (const attempt of ctx.bundle.lightspeedAttempts) {
      const e = evaluateAttempt(attempt, lightspeedSales(ctx.bundle.sales), ctx.ruleset.lightspeed, ctx.now);
      if (e.status === "invalid" || e.status === "failed") continue;
      best = Math.max(best, e.sales.filter((s) => s.checkpoint === "confirmedOk").length);
    }
    return [check(`Confirmed checkpoints in one ${ctx.ruleset.lightspeed.windowMinutes}-minute attempt`, best, ctx.ruleset.lightspeed.salesRequired)];
  },

  // ---------- Product knowledge (peak levels: reaching a level is what counts) ----------
  "fe:ach.pk.first-charts": (ctx) => {
    const v = curriculum(ctx);
    return [check("Carriers with every carrier-wide category Surveyed+", v.carriers.filter((c) => c.categories.every((x) => !x.evidence.applicable || x.peak >= 1)).length, 2)];
  },
  "fe:ach.pk.navigators-log": (ctx) => {
    const v = curriculum(ctx);
    const products = v.carriers.flatMap((c) => c.products.filter((p) => !p.product.archived));
    return [check("Carriers with every applicable category Surveyed+", v.carriers.filter((c) => c.peak >= 1).length, 4), check("Products fully Charted+", products.filter((p) => p.peak >= 2).length, 1)];
  },
  "fe:ach.pk.cartographers-atlas": (ctx) => {
    const v = curriculum(ctx);
    return [
      check("Carriers Charted+ in every applicable category", v.carriers.filter((c) => c.peak >= 2).length, 6),
      check("…of which Fluent+", v.carriers.filter((c) => c.peak >= 3).length, 3),
      check("Complete Comparison Atlas columns", v.carriers.filter(atlasComplete).length, 6),
    ];
  },
  "fe:ach.pk.admiralty": (ctx) => {
    const v = curriculum(ctx);
    const today = ctx.now.slice(0, 10);
    const cats = v.carriers.flatMap((c) => [...c.categories, ...c.products.filter((p) => !p.product.archived).flatMap((p) => p.categories)]).filter((c) => c.evidence.applicable);
    const fresh = cats.filter((c) => c.evidence.lastReviewedOn !== null && daysBetween(c.evidence.lastReviewedOn, today) <= 120).length;
    return [
      check("Active carriers Fluent+ in every applicable category", v.carriers.filter((c) => c.peak >= 3).length, Math.max(1, v.carriers.length)),
      check("Carriers Mastered", v.carriers.filter((c) => c.peak >= 4).length, 4),
      check("Categories reviewed in the last 120 days", fresh, Math.max(1, cats.length)),
      manual("A recorded 10-minute teach-back on 3 carriers"),
    ];
  },
};

/** Requirements for an achievement, or null if it has no record-based checks. */
export function evaluateAchievement(achievementId: string, ctx: EvalContext): Requirement[] | null {
  const evaluator = EVALUATORS[achievementId];
  if (!evaluator) return null;
  const active = ctx.bundle.activities.filter((a) => a.status === "active");
  const helpers: Helpers = {
    acts: (typeId) => active.filter((a) => a.typeId === typeId),
    weeks: (rows) => new Set(rows.map((r) => weekKey(r.occurredAt, ctx.ruleset.general.weekStartsOn))).size,
    num: (row, key) => (typeof row.values[key] === "number" ? (row.values[key] as number) : undefined),
  };
  return evaluator(ctx, helpers);
}

export function recordsMet(reqs: Requirement[] | null): boolean {
  return (reqs ?? []).every((r) => r.kind === "manual" || r.met);
}

export function lightspeedSales(sales: SaleRow[]): Record<string, LightspeedSale> {
  const out: Record<string, LightspeedSale> = {};
  for (const s of sales) {
    const sale: LightspeedSale = { id: s.id, submittedAt: s.submittedAt };
    if (s.anchorDate) sale.anchorDate = s.anchorDate;
    if (s.retention) sale.retention = s.retention;
    out[s.id] = sale;
  }
  return out;
}

/** The most sales submitted within any window of `minutes` (inclusive). */
export function maxInWindow(sales: SaleRow[], minutes: number): number {
  const times = sales.map((s) => parseISO(s.submittedAt)).sort((a, b) => a.getTime() - b.getTime());
  let best = 0;
  let start = 0;
  for (let end = 0; end < times.length; end++) {
    while (times[end]!.getTime() - times[start]!.getTime() > minutes * 60_000) start++;
    best = Math.max(best, end - start + 1);
  }
  return best;
}

function hasRatings(h: Helpers, a: ActivityRow, keys: string[], min: number): boolean {
  return keys.every((k) => (h.num(a, k) ?? 0) >= min);
}

function currentSectionIds(bundle: InstanceBundle): string[] {
  const script = bundle.scripts[0];
  const revision = script && bundle.scriptRevisions.find((r) => r.id === script.currentRevisionId);
  return revision?.sections.map((s) => s.id) ?? [];
}

function curriculum(ctx: EvalContext) {
  const view = buildCurriculumView(ctx.bundle, ctx.registry, ctx.now.slice(0, 10));
  return { ...view, carriers: view.carriers.filter((c) => !c.carrier.archived) };
}
