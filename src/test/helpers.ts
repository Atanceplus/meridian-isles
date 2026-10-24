import { CORE_SKILLS, loadBundledRegistry } from "../content";
import {
  applyActivity,
  buildRuleset,
  completeAchievement,
  createInitialState,
  type ActivityRecord,
  type AwardLine,
  type ProgressState,
  type Promotion,
  type Ruleset,
  type RulesetOverrides,
} from "../domain";

export const registry = loadBundledRegistry();
export const SK = CORE_SKILLS;

export const ACT = {
  callReport: "core:act.call-report",
  rehearsal: "core:act.script-rehearsal",
  revision: "core:act.script-revision",
  tonalityDrill: "core:act.tonality-drill",
  listenSkilled: "core:act.listen-skilled",
  objectionPractice: "core:act.objection-practice",
  timeTrial: "core:act.time-trial",
  carrierStudy: "fe:act.carrier-study",
  appNav: "fe:act.app-navigation",
  quote: "fe:act.quote-practice",
} as const;

export const SPEED_ACH = [
  "core:ach.speed.off-the-line",
  "core:ach.speed.pit-crew",
  "core:ach.speed.express-service",
  "core:ach.speed.lightspeed",
] as const;

export function ruleset(overrides: RulesetOverrides = {}): Ruleset {
  return buildRuleset(registry, overrides);
}

/** Small thresholds and no weekly limit for Speed, so cap behavior is quick to reach. */
export function smallSpeedRuleset(gates: Partial<Record<"2" | "3" | "4" | "5", object>> = {}): Ruleset {
  return ruleset({
    skills: {
      [SK.speed]: {
        weeklyLimit: { fullUpTo: 1e9, reducedUpTo: 1e9, reducedRate: 0.5 },
        ranks: {
          "2": { threshold: 100, ...gates["2"] },
          "3": { threshold: 300, ...gates["3"] },
          "4": { threshold: 600, ...gates["4"] },
          "5": { threshold: 1000, ...gates["5"] },
        },
      },
    },
  });
}

let seq = 0;
export function rec(
  typeId: string,
  units: number,
  at: string,
  extra: Partial<Omit<ActivityRecord, "typeId" | "units">> = {},
): ActivityRecord {
  seq += 1;
  return { id: `r${seq}`, typeId, units, occurredAt: at, recordedAt: at, ...extra };
}

/** A small event-sourcing harness: applies events in order and collects output. */
export class Sim {
  state: ProgressState;
  lines: AwardLine[] = [];
  promotions: Promotion[] = [];

  constructor(public rules: Ruleset) {
    this.state = createInitialState(rules);
  }

  log(record: ActivityRecord): AwardLine[] {
    const result = applyActivity(this.state, record, this.rules);
    this.state = result.state;
    this.lines.push(...result.lines);
    this.promotions.push(...result.promotions);
    return result.lines;
  }

  complete(achievementId: string, at: string): void {
    const result = completeAchievement(this.state, achievementId, at, this.rules);
    this.state = result.state;
    this.promotions.push(...result.promotions);
  }

  skill(id: string) {
    return this.state.skills[id]!;
  }
}

export function sum(lines: AwardLine[], skillId: string, status?: AwardLine["status"]): number {
  return round2(
    lines.filter((l) => l.skillId === skillId && (status === undefined || l.status === status)).reduce((a, l) => a + l.amount, 0),
  );
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Local ISO date-time for `day` days after `start` (yyyy-MM-dd) at hh:mm. */
export function dayAt(start: string, day: number, time = "10:00"): string {
  const [y, m, d] = start.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d + day);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${time}:00`;
}
