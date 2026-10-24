import { diffWordsWithSpace, type Change } from "diff";
import type { ScriptTracks, Tier } from "../content/schema";
import { dayKey } from "../domain/calendar";
import { creditThroughTiers } from "../domain/tiers";
import type { ActivityRow, LedgerRow, ScriptSection, ScriptVersionRow } from "../persistence/types";

/**
 * Script Foundry model: comparing script states and the two Foundry tracks,
 * Craft (meaningful improvements) and Rehearsal (credited rehearsal minutes).
 */

export const REHEARSAL_TYPE = "core:act.script-rehearsal";
export const REVISION_TYPE = "core:act.script-revision";

export function sectionsEqual(a: ScriptSection[], b: ScriptSection[]): boolean {
  return a.length === b.length && a.every((s, i) => s.id === b[i]!.id && s.name === b[i]!.name && s.body === b[i]!.body);
}

export interface SectionDiff {
  id: string;
  name: string;
  oldName: string | null;
  status: "same" | "changed" | "added" | "removed";
  parts: Change[];
  added: number;
  removed: number;
}

/** Word-level diff per section, matched by section id, in the newer script's order (removed sections last). */
export function diffScripts(before: ScriptSection[], after: ScriptSection[]): SectionDiff[] {
  const old = new Map(before.map((s) => [s.id, s]));
  const out: SectionDiff[] = after.map((s) => {
    const prev = old.get(s.id);
    if (!prev) return summarize(s.id, s.name, null, "added", [{ value: s.body, added: true, removed: false, count: 1 }]);
    const parts = diffWordsWithSpace(prev.body, s.body);
    const changed = prev.body !== s.body || prev.name !== s.name;
    return summarize(s.id, s.name, prev.name !== s.name ? prev.name : null, changed ? "changed" : "same", parts);
  });
  const kept = new Set(after.map((s) => s.id));
  for (const s of before) {
    if (!kept.has(s.id)) out.push(summarize(s.id, s.name, null, "removed", [{ value: s.body, added: false, removed: true, count: 1 }]));
  }
  return out;
}

function summarize(id: string, name: string, oldName: string | null, status: SectionDiff["status"], parts: Change[]): SectionDiff {
  const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
  return {
    id,
    name,
    oldName,
    status,
    parts,
    added: parts.filter((p) => p.added).reduce((a, p) => a + words(p.value), 0),
    removed: parts.filter((p) => p.removed).reduce((a, p) => a + words(p.value), 0),
  };
}

export interface TrackLevel {
  index: number;
  name: string;
  value: number;
  next: { name: string; min: number } | null;
  /** 0..1 progress from this level toward the next. */
  progress: number;
}

export function trackLevel(ladder: ScriptTracks["craft"], value: number): TrackLevel {
  let index = 0;
  ladder.forEach((l, i) => {
    if (value >= l.min) index = i;
  });
  const here = ladder[index]!;
  const next = ladder[index + 1] ?? null;
  return {
    index,
    name: here.name,
    value,
    next,
    progress: next ? Math.min(1, (value - here.min) / (next.min - here.min)) : 1,
  };
}

export function meaningfulCount(versions: ScriptVersionRow[]): number {
  return versions.filter((v) => v.meaningful !== null).length;
}

/**
 * Rehearsal minutes after the daily rehearsal limit, in logging order.
 * Removed records and records logged too late to earn XP don't count.
 */
export function creditedRehearsalMinutes(activities: ActivityRow[], ledger: LedgerRow[], tier: Tier | undefined): number {
  const late = new Set(ledger.filter((l) => l.status === "ineligible:backdated").map((l) => l.recordId));
  const used = new Map<string, number>();
  let total = 0;
  for (const row of activities
    .filter((a) => a.typeId === REHEARSAL_TYPE && a.status === "active" && !late.has(a.id))
    .sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : 0))) {
    const day = dayKey(row.occurredAt);
    const before = used.get(day) ?? 0;
    total += tier ? creditThroughTiers(row.record.units, [{ tier, used: before }]) : row.record.units;
    used.set(day, before + row.record.units);
  }
  return total;
}

export interface SectionPractice {
  minutes: number;
  sessions: number;
  lastAt: string | null;
}

/** Logged rehearsal time per section; a session covering several sections is split evenly between them. */
export function rehearsalBySection(activities: ActivityRow[]): Map<string, SectionPractice> {
  const out = new Map<string, SectionPractice>();
  for (const row of activities) {
    if (row.typeId !== REHEARSAL_TYPE || row.status !== "active") continue;
    const sections = Array.isArray(row.values.sections) ? (row.values.sections as string[]) : [];
    for (const id of sections) {
      const entry = out.get(id) ?? { minutes: 0, sessions: 0, lastAt: null };
      entry.minutes += row.record.units / sections.length;
      entry.sessions += 1;
      if (entry.lastAt === null || row.occurredAt > entry.lastAt) entry.lastAt = row.occurredAt;
      out.set(id, entry);
    }
  }
  return out;
}
