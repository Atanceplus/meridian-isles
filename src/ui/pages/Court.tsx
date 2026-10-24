import { useMemo, useState } from "react";
import type { DocketCaseRow, ObjectionEncounterRow } from "../../persistence/types";
import { todayLocal } from "../../records/clock";
import { TRIAL_SIZE } from "../../records/islandCommands";
import { useApp, useView } from "../app/context";
import { IslandHeader, Tabs } from "../components/Island";
import { ConfirmButton } from "../components/Modal";
import { QuickLog, type QuickLogStart } from "../components/QuickLog";
import { fmtDate, fmtDateTime, fmtXp } from "../format";

const PRACTICE = "core:act.objection-practice";
const LISTEN = "core:act.objection-listen";
const OUTCOMES: Record<ObjectionEncounterRow["outcome"], string> = { resolved: "Resolved", unresolved: "Not resolved", callEnded: "Call ended" };

type Tab = "docket" | "hearings" | "gallery" | "files";

/** Court of Objections: your docket of objections, practice, listening and real-call case files. */
export function Court() {
  const [tab, setTab] = useState<Tab>("docket");
  const [log, setLog] = useState<QuickLogStart | null>(null);
  return (
    <div className="page court">
      <IslandHeader
        islandId="core:island.court-of-objections"
        eyebrow="Court of Objections"
        title="Every objection gets its day in court"
        intro="Write your responses, rehearse them out loud, face randomized Rebuttal Trials, and keep the case files from real calls."
      >
        <Tabs<Tab>
          tabs={[
            ["docket", "Docket"],
            ["hearings", "Hearings & trials"],
            ["gallery", "Gallery"],
            ["files", "Case files"],
          ]}
          value={tab}
          onChange={setTab}
        />
      </IslandHeader>
      {tab === "docket" && <Docket onLog={setLog} />}
      {tab === "hearings" && <Hearings onLog={setLog} />}
      {tab === "gallery" && <Gallery onLog={setLog} />}
      {tab === "files" && <CaseFiles />}
      {log && <QuickLog start={log} onClose={() => setLog(null)} />}
    </div>
  );
}

function useCaseStats() {
  const { bundle } = useView();
  return useMemo(() => {
    const stats = new Map<string, { reps: number; spoken: number; last: string | null; fluency: number[] }>();
    for (const a of bundle.activities) {
      if (a.typeId !== PRACTICE || a.status !== "active") continue;
      const key = String(a.values.caseId);
      const s = stats.get(key) ?? { reps: 0, spoken: 0, last: null, fluency: [] };
      s.reps += a.record.units;
      if (a.record.mode !== "written") s.spoken += a.record.units;
      if (!s.last || a.occurredAt > s.last) s.last = a.occurredAt;
      if (typeof a.values.fluency === "number") s.fluency.push(a.values.fluency);
      stats.set(key, s);
    }
    return stats;
  }, [bundle.activities]);
}

function Docket({ onLog }: { onLog(s: QuickLogStart): void }) {
  const { bundle } = useView();
  const stats = useCaseStats();
  const [open, setOpen] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const cases = bundle.docket.filter((c) => showArchived || !c.archived).sort((a, b) => a.sortOrder - b.sortOrder);
  const written = bundle.docket.filter((c) => !c.archived && c.response.trim().length >= 10).length;

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Docket</h2>
        <span className="muted">
          {written} of {bundle.docket.filter((c) => !c.archived).length} cases have a written response
        </span>
        <span className="spacer" />
        <label className="tick muted">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
        </label>
      </header>
      <ul className="docket">
        {cases.map((c) => {
          const s = stats.get(c.key);
          const avg = s?.fluency.length ? s.fluency.reduce((a, b) => a + b, 0) / s.fluency.length : null;
          return (
            <li key={c.key} className={c.archived ? "removed" : ""}>
              <div className="row">
                <button className="link-btn" onClick={() => setOpen(open === c.key ? null : c.key)} aria-expanded={open === c.key}>
                  <strong>{c.title}</strong>
                </button>
                {!c.response.trim() && <span className="badge">No response yet</span>}
                <span className="spacer" />
                <span className="muted small">
                  {s ? `${s.spoken} spoken reps${avg !== null ? ` · fluency ${avg.toFixed(1)}` : ""} · last ${fmtDate(s.last!.slice(0, 10))}` : "not practiced"}
                </span>
                <button className="btn ghost small" onClick={() => onLog({ typeId: PRACTICE, values: { caseId: c.key } })}>
                  Practice
                </button>
              </div>
              {open !== c.key && c.response && <p className="summary-preview">{c.response}</p>}
              {open === c.key && <CaseEditor c={c} onDone={() => setOpen(null)} />}
            </li>
          );
        })}
      </ul>
      <NewCase />
    </section>
  );
}

function CaseEditor({ c, onDone }: { c: DocketCaseRow; onDone(): void }) {
  const { service, currentId, run } = useApp();
  const { bundle } = useView();
  const script = bundle.scripts[0];
  const sections = (script && bundle.scriptRevisions.find((r) => r.id === script.currentRevisionId)?.sections) ?? [];
  const [form, setForm] = useState({ title: c.title, response: c.response, notes: c.notes, scriptSectionId: c.scriptSectionId ?? "" });
  if (!currentId) return null;
  const save = (archived = c.archived) =>
    run("Case saved", () => service.islands.saveCase(currentId, { key: c.key, ...form, scriptSectionId: form.scriptSectionId || null, archived })).then((ok) => ok && onDone());
  return (
    <div className="case-editor">
      <label className="field">
        <span>Objection</span>
        <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={160} />
      </label>
      <label className="field">
        <span>Your response</span>
        <textarea rows={5} value={form.response} onChange={(e) => setForm({ ...form, response: e.target.value })} placeholder="How you answer this, in your own words." />
      </label>
      <div className="field-grid">
        <label className="field">
          <span>
            Linked script section <em className="optional">optional</em>
          </span>
          <select value={form.scriptSectionId} onChange={(e) => setForm({ ...form, scriptSectionId: e.target.value })}>
            <option value="">—</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>
          Notes <em className="optional">optional</em>
        </span>
        <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </label>
      <div className="row">
        <button className="btn ghost small" onClick={() => save(!c.archived)}>
          {c.archived ? "Restore" : "Archive"}
        </button>
        <span className="spacer" />
        <button className="btn ghost small" onClick={onDone}>
          Cancel
        </button>
        <button className="btn primary small" onClick={() => save()}>
          Save case
        </button>
      </div>
    </div>
  );
}

function NewCase() {
  const { service, currentId, run } = useApp();
  const [title, setTitle] = useState("");
  return (
    <form
      className="row"
      onSubmit={async (e) => {
        e.preventDefault();
        if (currentId && (await run("Case added", () => service.islands.saveCase(currentId, { title })))) setTitle("");
      }}
    >
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add an objection, e.g. “I'm on a fixed income”" aria-label="New objection" required maxLength={160} />
      <button className="btn small">Add case</button>
    </form>
  );
}

// ---------- Hearings & Rebuttal Trials ----------

function Hearings({ onLog }: { onLog(s: QuickLogStart): void }) {
  const { bundle } = useView();
  const [trial, setTrial] = useState(false);
  const trials = [...bundle.rebuttalTrials].sort((a, b) => (a.at < b.at ? 1 : -1));
  return (
    <>
      <section className="panel">
        <header className="panel-head">
          <h2>Rebuttal Trial</h2>
          <span className="muted">
            Up to {TRIAL_SIZE} random cases from your docket. Answer each out loud, then judge yourself honestly. It counts as spoken practice.
          </span>
        </header>
        {trial ? (
          <TrialRunner onDone={() => setTrial(false)} />
        ) : (
          <div className="row">
            <button className="btn primary" onClick={() => setTrial(true)} disabled={bundle.docket.filter((c) => !c.archived).length === 0}>
              Begin a trial
            </button>
            <button className="btn" onClick={() => onLog({ typeId: PRACTICE })}>
              Log other practice
            </button>
          </div>
        )}
      </section>
      <section className="panel">
        <h2>Past trials</h2>
        {trials.length === 0 ? (
          <p className="muted">No trials yet. Chief Justice needs three 15-case trials at 90%+ fluent, in separate weeks.</p>
        ) : (
          <ul className="history">
            {trials.map((t) => {
              const fluent = t.results.filter((r) => r.fluent).length;
              const pct = fluent / t.results.length;
              return (
                <li key={t.id}>
                  <span className="muted">{fmtDateTime(t.at)}</span> {fluent} / {t.results.length} fluent ({Math.round(pct * 100)}%)
                  {t.results.length >= 15 && pct >= 0.9 && <span className="badge s-awarded">Passed</span>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

function TrialRunner({ onDone }: { onDone(): void }) {
  const { service, currentId, run } = useApp();
  const { bundle } = useView();
  const [cases] = useState(() => shuffle(bundle.docket.filter((c) => !c.archived)).slice(0, TRIAL_SIZE));
  const [results, setResults] = useState<{ caseKey: string; fluent: boolean }[]>([]);
  const [reveal, setReveal] = useState(false);
  const current = cases[results.length];

  if (!current) {
    const fluent = results.filter((r) => r.fluent).length;
    return (
      <div className="trial">
        <p>
          <strong>
            {fluent} of {results.length} fluent ({Math.round((fluent / results.length) * 100)}%)
          </strong>
        </p>
        <div className="row">
          <button className="btn ghost" onClick={onDone}>
            Discard
          </button>
          <button
            className="btn primary"
            onClick={async () => {
              if (currentId && (await run("Rebuttal Trial saved", () => service.islands.saveTrial(currentId, results), (r) => r))) onDone();
            }}
          >
            Save trial
          </button>
        </div>
      </div>
    );
  }
  const answer = (fluent: boolean) => {
    setResults([...results, { caseKey: current.key, fluent }]);
    setReveal(false);
  };
  return (
    <div className="trial">
      <div className="eyebrow">
        Case {results.length + 1} of {cases.length}
      </div>
      <p className="trial-case">“{current.title}”</p>
      {reveal ? (
        <p className="summary-preview open">{current.response || <span className="muted">No written response yet.</span>}</p>
      ) : (
        <button className="link-btn" onClick={() => setReveal(true)}>
          Show my written response
        </button>
      )}
      <div className="row">
        <button className="btn" onClick={() => answer(false)}>
          Stumbled
        </button>
        <button className="btn primary" onClick={() => answer(true)}>
          Fluent
        </button>
      </div>
    </div>
  );
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// ---------- Gallery ----------

function Gallery({ onLog }: { onLog(s: QuickLogStart): void }) {
  const { bundle } = useView();
  const rows = bundle.activities.filter((a) => a.typeId === LISTEN && a.status === "active").sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
  const minutes = rows.reduce((n, a) => n + a.record.units, 0);
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Gallery</h2>
        <span className="muted">{fmtXp(minutes)} minutes listening to objection handling</span>
        <span className="spacer" />
        <button className="btn primary" onClick={() => onLog({ typeId: LISTEN })}>
          Log listening
        </button>
      </header>
      {rows.length === 0 ? (
        <p className="muted">Nothing logged yet.</p>
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

// ---------- Case files ----------

function CaseFiles() {
  const { service, currentId, run } = useApp();
  const { bundle } = useView();
  const cases = bundle.docket.filter((c) => !c.archived);
  const [form, setForm] = useState({ occurredOn: todayLocal(), caseKey: "", outcome: "resolved" as ObjectionEncounterRow["outcome"], notes: "" });
  const encounters = [...bundle.objectionEncounters].sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : -1));
  const title = (key: string) => bundle.docket.find((c) => c.key === key)?.title ?? key;
  const resolved = encounters.filter((e) => e.outcome === "resolved").length;

  return (
    <>
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          if (currentId && (await run("Objection logged", () => service.islands.logEncounter(currentId, form)))) setForm({ ...form, caseKey: "", notes: "" });
        }}
      >
        <header className="panel-head">
          <h2>Log a real objection</h2>
          <span className="muted">From an actual call. These build toward Barrister (25 across 8+ case types).</span>
        </header>
        <div className="field-grid">
          <label className="field">
            <span>Date</span>
            <input type="date" value={form.occurredOn} max={todayLocal()} onChange={(e) => setForm({ ...form, occurredOn: e.target.value })} required />
          </label>
          <label className="field">
            <span>Objection</span>
            <select value={form.caseKey} onChange={(e) => setForm({ ...form, caseKey: e.target.value })} required>
              <option value="">Choose…</option>
              {cases.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Outcome</span>
            <select value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value as ObjectionEncounterRow["outcome"] })}>
              {Object.entries(OUTCOMES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>
            Notes <em className="optional">optional</em>
          </span>
          <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </label>
        <div className="row">
          <span className="spacer" />
          <button className="btn primary">Log objection</button>
        </div>
      </form>
      <section className="panel">
        <header className="panel-head">
          <h2>Case files</h2>
          <span className="muted">
            {encounters.length} logged · {new Set(encounters.map((e) => e.caseKey)).size} case types · {resolved} resolved
          </span>
        </header>
        <ul className="history">
          {encounters.map((e) => (
            <li key={e.id} className="row">
              <span className="muted">{fmtDate(e.occurredOn)}</span>
              <span>{title(e.caseKey)}</span>
              <span className={`badge ${e.outcome === "resolved" ? "s-awarded" : ""}`}>{OUTCOMES[e.outcome]}</span>
              {e.notes && <span className="muted small">{e.notes}</span>}
              <span className="spacer" />
              {currentId && <ConfirmButton label="Delete" confirmLabel="Delete record" onConfirm={() => run("Record deleted", () => service.islands.deleteEncounter(currentId, e.id))} />}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
