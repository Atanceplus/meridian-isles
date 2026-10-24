import { useState } from "react";
import { gateMetExceptScore } from "../../domain";
import type { ActivityRow } from "../../persistence/types";
import { nowLocal } from "../../records/clock";
import { useApp, useView } from "../app/context";
import { ConfirmButton } from "../components/Modal";
import { LineDetails } from "../components/OutcomePanel";
import { QuickLog } from "../components/QuickLog";
import { Radar } from "../components/Radar";
import { SkillSheet } from "../components/SkillSheet";
import { fmtDateTime, fmtSigned, fmtXp } from "../format";
import { href } from "../routes";

export function HQ() {
  const { registry } = useApp();
  const { ruleset, state } = useView();
  const [sheet, setSheet] = useState<string | null>(null);
  const now = nowLocal();

  return (
    <div className="page hq">
      <section className="panel radar-panel">
        <header className="panel-head">
          <h2>Skill radar</h2>
          <span className="muted">Select a skill for its full sheet</span>
          <span className="spacer" />
          <a className="btn small" href={href({ page: "wharf" })}>
            Outfitter's Wharf
          </a>
        </header>
        <Radar registry={registry} ruleset={ruleset} state={state} at={now} onSelect={setSheet} />
      </section>

      <section className="skill-cards">
        {ruleset.skillOrder.map((id) => {
          const skill = ruleset.skills[id]!;
          const p = state.skills[id]!;
          const next = skill.ranks[p.rank];
          const capped = next !== undefined && p.score >= next.threshold && !gateMetExceptScore(state, ruleset, id, p.rank + 1, now);
          const prev = skill.ranks[p.rank - 1]!.threshold;
          const pct = next ? (p.score - prev) / (next.threshold - prev) : 1;
          return (
            <button key={id} className="skill-card panel" onClick={() => setSheet(id)}>
              <div className="row">
                <strong>{skill.name}</strong>
                <span className="spacer" />
                {capped && <span className="badge s-blocked-cap">🔒 Capped</span>}
              </div>
              <div className="rank-title small">{skill.ranks[p.rank - 1]!.name}</div>
              <div className="bar">
                <span style={{ width: `${Math.min(1, pct) * 100}%` }} className={capped ? "capped" : ""} />
              </div>
              <div className="muted">
                {fmtXp(p.score)} XP {next ? `· next: ${next.name} at ${fmtXp(next.threshold)}` : "· maximum rank"}
              </div>
            </button>
          );
        })}
      </section>

      <RecentActivity />
      {sheet && <SkillSheet skillId={sheet} onClose={() => setSheet(null)} />}
    </div>
  );
}

function RecentActivity() {
  const { registry, service, currentId, run } = useApp();
  const { bundle } = useView();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<ActivityRow | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);

  const rows = bundle.activities
    .filter((a) => showRemoved || a.status === "active")
    .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : a.occurredAt < b.occurredAt ? 1 : -1))
    .slice(0, 30);

  return (
    <section className="panel recent">
      <header className="panel-head">
        <h2>Recent activity</h2>
        <span className="spacer" />
        <label className="tick muted">
          <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} /> Show removed
        </label>
      </header>
      {rows.length === 0 ? (
        <p className="muted">Nothing logged yet. Use “+ Log activity” or file a daily report in the Production Office.</p>
      ) : (
        <ul className="activity-list">
          {rows.map((a) => {
            const type = registry.activityTypeById[a.typeId];
            const lines = bundle.ledger.filter((l) => l.recordId === a.id && l.status !== "reversed").sort((x, y) => (x.skillId < y.skillId ? -1 : 1));
            const earned = lines.filter((l) => l.status === "awarded" || l.status === "reduced").reduce((s, l) => s + l.amount, 0);
            const isOpen = expanded === a.id;
            return (
              <li key={a.id} className={a.status === "reversed" ? "removed" : ""}>
                <div className="row">
                  <button className="link-btn" onClick={() => setExpanded(isOpen ? null : a.id)} aria-expanded={isOpen}>
                    <strong>{type?.name ?? a.typeId}</strong>
                  </button>
                  <span className="muted">{summary(a)}</span>
                  <span className="spacer" />
                  <span className="muted">{fmtDateTime(a.occurredAt)}</span>
                  <strong className="xp">{a.status === "reversed" ? "removed" : `${fmtSigned(earned)} XP`}</strong>
                </div>
                {isOpen && (
                  <div className="activity-detail">
                    <LineDetails lines={lines} />
                    {a.status === "active" && !a.dailyReportId && currentId && (
                      <div className="row">
                        <button className="btn ghost small" onClick={() => setEditing(a)}>
                          Edit
                        </button>
                        <ConfirmButton
                          label="Remove"
                          confirmLabel="Remove and take back its XP"
                          onConfirm={() => run(`Removed ${type?.name ?? "activity"}`, () => service.deleteActivity(currentId, a.id), (r) => r)}
                        />
                      </div>
                    )}
                    {a.dailyReportId && <p className="muted">From a daily report. Change it in the Production Office.</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editing && <QuickLog edit={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function summary(a: ActivityRow): string {
  const v = a.values;
  if (typeof v.minutes === "number") return `${v.minutes} min`;
  if (typeof v.hours === "number") return `${v.hours} h${typeof v.calls === "number" ? ` · ${v.calls} calls` : ""}`;
  if (typeof v.reps === "number") return `${v.reps} reps`;
  if (typeof v.durationSeconds === "number") return `${Math.floor(v.durationSeconds / 60)}:${String(v.durationSeconds % 60).padStart(2, "0")}`;
  return "";
}
