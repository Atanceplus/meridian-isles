import { useState } from "react";
import type { RapportCardRow } from "../../persistence/types";
import { todayLocal } from "../../records/clock";
import { useApp, useView } from "../app/context";
import { IslandHeader, Tabs } from "../components/Island";
import { ConfirmButton } from "../components/Modal";
import { QuickLog, type QuickLogStart } from "../components/QuickLog";
import { fmtDate, fmtDateTime, fmtXp } from "../format";

const PRACTICE = "core:act.small-talk-practice";
const KINDS: [RapportCardRow["kind"], string][] = [
  ["opener", "Openers"],
  ["question", "Questions"],
  ["story", "Stories"],
  ["transition", "Transitions back to business"],
];

type Tab = "library" | "practice" | "calls";

/** Conversation Cove: a rapport library, scenario practice, and moments from real calls. */
export function Cove() {
  const [tab, setTab] = useState<Tab>("library");
  const [log, setLog] = useState<QuickLogStart | null>(null);
  return (
    <div className="page cove">
      <IslandHeader
        islandId="core:island.conversation-cove"
        eyebrow="Conversation Cove"
        title="Lanterns, docks and good company"
        intro="Collect the openers, questions, stories and transitions that work for you, practice them across scenarios, and note real rapport moments."
      >
        <Tabs<Tab>
          tabs={[
            ["library", "Rapport Library"],
            ["practice", "Practice"],
            ["calls", "Real calls"],
          ]}
          value={tab}
          onChange={setTab}
        />
      </IslandHeader>
      {tab === "library" && <Library />}
      {tab === "practice" && <Practice onLog={setLog} />}
      {tab === "calls" && <RealCalls />}
      {log && <QuickLog start={log} onClose={() => setLog(null)} />}
    </div>
  );
}

function Library() {
  const { bundle } = useView();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Rapport Library</h2>
        <span className="muted">{bundle.rapportCards.length} cards</span>
        <span className="spacer" />
        <button className="btn primary" onClick={() => setEditing("new")}>
          Add card
        </button>
      </header>
      {editing === "new" && <CardEditor onDone={() => setEditing(null)} />}
      {KINDS.map(([kind, label]) => {
        const cards = bundle.rapportCards.filter((c) => c.kind === kind);
        return (
          <div key={kind}>
            <h3>
              {label} <span className="muted small">({cards.length})</span>
            </h3>
            {cards.length === 0 ? (
              <p className="muted small">None yet.</p>
            ) : (
              <div className="card-grid">
                {cards.map((c) =>
                  editing === c.id ? (
                    <CardEditor key={c.id} card={c} onDone={() => setEditing(null)} />
                  ) : (
                    <button key={c.id} className="rapport-card" onClick={() => setEditing(c.id)}>
                      <strong>{c.title}</strong>
                      <span>{c.body}</span>
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function CardEditor({ card, onDone }: { card?: RapportCardRow; onDone(): void }) {
  const { service, currentId, run, registry } = useApp();
  const [form, setForm] = useState({ kind: card?.kind ?? "opener", title: card?.title ?? "", body: card?.body ?? "", scenarioKey: card?.scenarioKey ?? "" });
  if (!currentId) return null;
  return (
    <form
      className="inline-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run(card ? "Card saved" : "Card added", () =>
          service.islands.saveCard(currentId, { ...(card ? { id: card.id } : {}), ...form, scenarioKey: form.scenarioKey || null }),
        );
        if (ok) onDone();
      }}
    >
      <div className="field-grid">
        <label className="field">
          <span>Type</span>
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as RapportCardRow["kind"] })}>
            {KINDS.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Title</span>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={120} required />
        </label>
        <label className="field">
          <span>
            Best for <em className="optional">optional</em>
          </span>
          <select value={form.scenarioKey} onChange={(e) => setForm({ ...form, scenarioKey: e.target.value })}>
            <option value="">Any caller</option>
            {registry.seeds.rapportScenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>What you say</span>
        <textarea rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} required />
      </label>
      <div className="row">
        {card && <ConfirmButton label="Delete" confirmLabel="Delete card" onConfirm={() => run("Card deleted", () => service.islands.deleteCard(currentId, card.id)).then(onDone)} />}
        <span className="spacer" />
        <button type="button" className="btn ghost small" onClick={onDone}>
          Cancel
        </button>
        <button className="btn primary small">Save card</button>
      </div>
    </form>
  );
}

function Practice({ onLog }: { onLog(s: QuickLogStart): void }) {
  const { registry } = useApp();
  const { bundle } = useView();
  const rows = bundle.activities.filter((a) => a.typeId === PRACTICE && a.status === "active");
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Practice by scenario</h2>
        <span className="muted">Storyteller needs 50 reps across 5+ scenarios.</span>
      </header>
      <table className="compact">
        <thead>
          <tr>
            <th>Scenario</th>
            <th className="num">Sessions</th>
            <th className="num">Reps</th>
            <th className="num">Minutes</th>
            <th>Last</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {registry.seeds.rapportScenarios.map((s) => {
            const these = rows.filter((r) => r.values.scenarioId === s.id);
            const last = these.map((r) => r.occurredAt).sort().pop();
            return (
              <tr key={s.id}>
                <td>{s.label}</td>
                <td className="num">{these.length}</td>
                <td className="num">{these.reduce((n, r) => n + (typeof r.values.reps === "number" ? r.values.reps : 1), 0)}</td>
                <td className="num">{fmtXp(these.reduce((n, r) => n + r.record.units, 0))}</td>
                <td>{last ? fmtDateTime(last) : <span className="muted">never</span>}</td>
                <td className="actions">
                  <button className="btn ghost small" onClick={() => onLog({ typeId: PRACTICE, values: { scenarioId: s.id } })}>
                    Practice
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

function RealCalls() {
  const { service, currentId, run, registry } = useApp();
  const { bundle } = useView();
  const [form, setForm] = useState({ occurredOn: todayLocal(), scenarioKey: "", note: "" });
  const notes = [...bundle.rapportNotes].sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : -1));
  return (
    <>
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          if (currentId && (await run("Rapport note saved", () => service.islands.saveNote(currentId, { ...form, scenarioKey: form.scenarioKey || null })))) {
            setForm({ ...form, note: "" });
          }
        }}
      >
        <header className="panel-head">
          <h2>A rapport moment from a real call</h2>
          <span className="muted">What connected, and how you got back to business. Confidant needs 20.</span>
        </header>
        <div className="field-grid">
          <label className="field">
            <span>Date</span>
            <input type="date" value={form.occurredOn} max={todayLocal()} onChange={(e) => setForm({ ...form, occurredOn: e.target.value })} required />
          </label>
          <label className="field">
            <span>
              Caller type <em className="optional">optional</em>
            </span>
            <select value={form.scenarioKey} onChange={(e) => setForm({ ...form, scenarioKey: e.target.value })}>
              <option value="">—</option>
              {registry.seeds.rapportScenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>What happened</span>
          <textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} required />
        </label>
        <div className="row">
          <span className="spacer" />
          <button className="btn primary">Save note</button>
        </div>
      </form>
      <section className="panel">
        <h2>Notes ({notes.length})</h2>
        <ul className="history">
          {notes.map((n) => (
            <li key={n.id} className="row">
              <span className="muted">{fmtDate(n.occurredOn)}</span>
              {n.scenarioKey && <span className="badge">{registry.seeds.rapportScenarios.find((s) => s.id === n.scenarioKey)?.label}</span>}
              <span>{n.note}</span>
              <span className="spacer" />
              {currentId && <ConfirmButton label="Delete" confirmLabel="Delete note" onConfirm={() => run("Note deleted", () => service.islands.deleteNote(currentId, n.id))} />}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
