import { useState } from "react";
import { LIGHTSPEED_ID, evaluateAchievement, recordsMet, type Requirement } from "../../records/achievements";
import { nowLocal } from "../../records/clock";
import { useApp, useView } from "../app/context";
import { fmtDateTime } from "../format";
import { href } from "../routes";

/**
 * An achievement's requirements: what your records show (checked
 * automatically) and what only you can attest to. Completion needs both.
 */
export function AchievementBody({ achievementId }: { achievementId: string }) {
  const { registry } = useApp();
  const view = useView();
  const def = registry.achievementById[achievementId]!;
  const reqs = evaluateAchievement(achievementId, { bundle: view.bundle, registry, ruleset: view.ruleset, now: nowLocal() });
  const completed = view.bundle.achievements.find((a) => a.achievementId === achievementId);

  return (
    <div className="achievement-body">
      <ul className="req-list plain">
        {def.requirements.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {reqs && <RecordChecks reqs={reqs} />}
      {completed ? (
        <p className="muted small">
          Completed {fmtDateTime(completed.completedAt)}
          {completed.evidenceNote ? ` — “${completed.evidenceNote}”` : ""}
        </p>
      ) : achievementId === LIGHTSPEED_ID ? (
        <p className="muted small">
          Lightspeed completes from its tracker in the <a href={href({ page: "islands", islandId: "core:island.velocity-circuit" })}>Velocity Circuit</a> once all ten
          checkpoints are confirmed.
        </p>
      ) : (
        <Completer achievementId={achievementId} recordsOk={recordsMet(reqs)} />
      )}
    </div>
  );
}

export function RecordChecks({ reqs }: { reqs: Requirement[] }) {
  return (
    <ul className="record-checks">
      {reqs.map((r) =>
        r.kind === "check" ? (
          <li key={r.text}>
            <span className={`check ${r.met ? "met" : ""}`}>{r.met ? "✓" : "○"}</span>
            <span>{r.text}</span>
            <span className="spacer" />
            <span className="muted small">
              {r.current} / {r.required}
            </span>
            <span className="mini-bar">
              <span style={{ width: `${(r.current / r.required) * 100}%` }} />
            </span>
          </li>
        ) : (
          <li key={r.text}>
            <span className="check">✎</span>
            <span>{r.text}</span>
            <span className="spacer" />
            <span className="muted small">you attest</span>
          </li>
        ),
      )}
    </ul>
  );
}

function Completer({ achievementId, recordsOk }: { achievementId: string; recordsOk: boolean }) {
  const { registry, service, currentId, run } = useApp();
  const def = registry.achievementById[achievementId]!;
  const [open, setOpen] = useState(false);
  const [ticks, setTicks] = useState(() => def.requirements.map(() => false));
  const [note, setNote] = useState("");

  if (!open) {
    return (
      <button className="btn small" onClick={() => setOpen(true)} disabled={!recordsOk} title={recordsOk ? undefined : "Your records don't show every requirement yet"}>
        {recordsOk ? "I've done this…" : "Not there yet"}
      </button>
    );
  }
  const all = ticks.every(Boolean);
  return (
    <form
      className="completer"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!all || !currentId) return;
        if (await run(`${def.name} complete`, () => service.completeAchievement(currentId, achievementId, note), (r) => r)) setOpen(false);
      }}
    >
      <p className="muted small">Your records support this. Tick each requirement you've genuinely met.</p>
      {def.requirements.map((r, i) => (
        <label key={r} className="tick">
          <input type="checkbox" checked={ticks[i]} onChange={(e) => setTicks(ticks.map((t, j) => (j === i ? e.target.checked : t)))} /> {r}
        </label>
      ))}
      <label className="field">
        <span>
          Evidence or notes <em className="optional">optional</em>
        </span>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="row">
        <button className="btn primary small" disabled={!all}>
          Mark {def.name} complete
        </button>
        <button type="button" className="btn ghost small" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
