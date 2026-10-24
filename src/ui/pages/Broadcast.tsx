import { useState } from "react";
import type { ActivityRow } from "../../persistence/types";
import { useApp, useView } from "../app/context";
import { IslandHeader, Tabs } from "../components/Island";
import { QuickLog, type QuickLogStart } from "../components/QuickLog";
import { fmtDateTime, fmtXp } from "../format";

const DRILL = "core:act.tonality-drill";
const LISTEN = "core:act.listen-skilled";
const REVIEW = "core:act.call-review";
const TONALITY = "core:skill.tonality";
const RUBRIC: [string, string][] = [
  ["tonality", "Tonality"],
  ["pacing", "Pacing"],
  ["rapport", "Rapport"],
  ["objections", "Objections"],
  ["control", "Control"],
  ["transition", "Transition"],
];

type Tab = "drills" | "listening" | "tapes";

/** Last Broadcast: tonality drills, listening to skilled speakers, and reviewing your own calls. */
export function Broadcast() {
  const { state, ruleset } = useView();
  const [tab, setTab] = useState<Tab>("drills");
  const [log, setLog] = useState<QuickLogStart | null>(null);
  const skill = ruleset.skills[TONALITY]!;
  const p = state.skills[TONALITY]!;
  const signal = p.score / skill.maxScore;

  return (
    <div className="page broadcast">
      <IslandHeader
        islandId="core:island.last-broadcast"
        eyebrow="Last Broadcast"
        title="Bring the signal back to the wasteland"
        intro="Drill your delivery, study how strong speakers sound, and listen back to your own calls with a rubric."
      >
        <div className="signal" aria-label={`Signal strength ${Math.round(signal * 100)}%`}>
          <div className="signal-bars">
            {[0.1, 0.3, 0.6, 1].map((t, i) => (
              <span key={i} className={signal >= t * 0.999 || p.rank > i + 1 ? "on" : ""} style={{ height: `${(i + 1) * 25}%` }} />
            ))}
          </div>
          <div>
            <div className="rank-title small">{skill.ranks[p.rank - 1]!.name}</div>
            <div className="muted small">
              Signal {fmtXp(p.score)} / {fmtXp(skill.maxScore)}
            </div>
          </div>
        </div>
        <Tabs<Tab>
          tabs={[
            ["drills", "Drills"],
            ["listening", "Listening Post"],
            ["tapes", "Tape Room"],
          ]}
          value={tab}
          onChange={setTab}
        />
      </IslandHeader>
      {tab === "drills" && <Drills onLog={setLog} />}
      {tab === "listening" && <Listening onLog={setLog} />}
      {tab === "tapes" && <Tapes onLog={setLog} />}
      {log && <QuickLog start={log} onClose={() => setLog(null)} />}
    </div>
  );
}

function active(rows: ActivityRow[], typeId: string): ActivityRow[] {
  return rows.filter((a) => a.typeId === typeId && a.status === "active").sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
}

function avg(nums: number[]): number | null {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

function Drills({ onLog }: { onLog(s: QuickLogStart): void }) {
  const { registry } = useApp();
  const { bundle } = useView();
  const drills = active(bundle.activities, DRILL);
  const types = registry.activityTypeById[DRILL]!.fields.find((f) => f.key === "drillType")!.options!;
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Drills</h2>
        <span className="muted">
          {drills.length} drills across {new Set(drills.map((d) => d.values.drillType)).size} of {types.length} types
        </span>
      </header>
      <table className="compact">
        <thead>
          <tr>
            <th>Drill</th>
            <th className="num">Sessions</th>
            <th className="num">Minutes</th>
            <th className="num">Avg self-rating</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {types.map((t) => {
            const rows = drills.filter((d) => d.values.drillType === t);
            const rating = avg(rows.map((r) => r.values.selfRating).filter((v): v is number => typeof v === "number"));
            return (
              <tr key={t}>
                <td>{t[0]!.toUpperCase() + t.slice(1)}</td>
                <td className="num">{rows.length}</td>
                <td className="num">{fmtXp(rows.reduce((n, r) => n + r.record.units, 0))}</td>
                <td className="num">{rating === null ? "—" : rating.toFixed(1)}</td>
                <td className="actions">
                  <button className="btn ghost small" onClick={() => onLog({ typeId: DRILL, values: { drillType: t } })}>
                    Drill
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function Listening({ onLog }: { onLog(s: QuickLogStart): void }) {
  const { bundle } = useView();
  const rows = active(bundle.activities, LISTEN);
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Listening Post</h2>
        <span className="muted">{fmtXp(rows.reduce((n, a) => n + a.record.units, 0))} minutes with skilled speakers</span>
        <span className="spacer" />
        <button className="btn primary" onClick={() => onLog({ typeId: LISTEN })}>
          Log listening
        </button>
      </header>
      {rows.length === 0 ? (
        <p className="muted">Nothing logged yet. Note three takeaways each time; they're the point.</p>
      ) : (
        <ul className="notes-list">
          {rows.slice(0, 25).map((a) => (
            <li key={a.id}>
              <div className="row">
                <strong>{String(a.values.source ?? "")}</strong>
                <span className="muted small">{a.record.units} min</span>
                <span className="spacer" />
                <span className="muted small">{fmtDateTime(a.occurredAt)}</span>
              </div>
              <p className="summary-preview">{String(a.values.takeaways ?? "")}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Tapes({ onLog }: { onLog(s: QuickLogStart): void }) {
  const { bundle } = useView();
  const rows = active(bundle.activities, REVIEW);
  const recent = rows.slice(0, 10);
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Tape Room</h2>
        <span className="muted">{rows.length} calls reviewed</span>
        <span className="spacer" />
        <button className="btn primary" onClick={() => onLog({ typeId: REVIEW })}>
          Review a call
        </button>
      </header>
      <div className="rubric-grid">
        {RUBRIC.map(([key, label]) => {
          const a = avg(recent.map((r) => r.values[key]).filter((v): v is number => typeof v === "number"));
          return (
            <div key={key} className="rubric-stat">
              <div className="eyebrow">{label}</div>
              <div className="score-big small">{a === null ? "—" : a.toFixed(1)}</div>
              <div className="muted small">avg of last {recent.length || 0}</div>
            </div>
          );
        })}
      </div>
      {rows.length > 0 && (
        <ul className="notes-list">
          {rows.slice(0, 15).map((a) => (
            <li key={a.id}>
              <div className="row">
                <span className="muted small">{fmtDateTime(a.occurredAt)}</span>
                <span className="muted small">{a.record.units} min</span>
                {RUBRIC.filter(([k]) => typeof a.values[k] === "number").map(([k, label]) => (
                  <span key={k} className="badge">
                    {label} {String(a.values[k])}
                  </span>
                ))}
              </div>
              <p className="summary-preview">{String(a.values.reflection ?? "")}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
