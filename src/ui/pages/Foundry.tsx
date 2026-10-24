import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScriptRevisionRow, ScriptSection, ScriptVersionRow } from "../../persistence/types";
import { REHEARSAL_TYPE, REVISION_TYPE, creditedRehearsalMinutes, diffScripts, meaningfulCount, rehearsalBySection, sectionsEqual, trackLevel, type TrackLevel } from "../../records/script";
import { useApp, useView } from "../app/context";
import { ConfirmButton } from "../components/Modal";
import { QuickLog } from "../components/QuickLog";
import { fmtDateTime, fmtXp } from "../format";

type Tab = "editor" | "versions" | "compare" | "rehearsal";
const AUTOSAVE_MS = 1500;

/** Script Foundry: the script itself, its history, and rehearsal. */
export function Foundry() {
  const { registry } = useApp();
  const { bundle } = useView();
  const [tab, setTab] = useState<Tab>("editor");
  const [compare, setCompare] = useState<{ a: string; b: string } | null>(null);
  const script = bundle.scripts[0];
  if (!script) return <p className="muted">No script found.</p>;

  const versions = bundle.scriptVersions.filter((v) => v.scriptId === script.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const tracks = registry.seeds.scriptTracks!;
  const craft = trackLevel(tracks.craft, meaningfulCount(versions));
  const rehearsal = trackLevel(tracks.rehearsal, creditedRehearsalMinutes(bundle.activities, bundle.ledger, registry.activityTypeById[REHEARSAL_TYPE]?.limits.daily));

  const tabs: [Tab, string][] = [
    ["editor", "Anvil · Editor"],
    ["versions", `Printing Press · Versions (${versions.length})`],
    ["compare", "Compare"],
    ["rehearsal", "Rehearsal Hall"],
  ];

  return (
    <div className="page foundry">
      <header className="island-head island-script-foundry">
        <div>
          <div className="eyebrow">Script Foundry</div>
          <h1>Forge the script; rehearse it until it rings</h1>
          <p className="muted">Every save is kept. Only versions you mark as a meaningful improvement earn XP, and rehearsal counts for more than editing.</p>
        </div>
        <div className="tracks">
          <Track label="Craft" level={craft} unit={["improvement", "improvements"]} />
          <Track label="Rehearsal" level={rehearsal} unit={["credited minute", "credited minutes"]} />
        </div>
        <div className="tabs" role="tablist">
          {tabs.map(([key, label]) => (
            <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "on" : ""} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>
      </header>

      {tab === "editor" && <Editor key={script.id} scriptId={script.id} />}
      {tab === "versions" && (
        <Versions
          versions={versions}
          onCompare={(a, b) => {
            setCompare({ a, b });
            setTab("compare");
          }}
        />
      )}
      {tab === "compare" && <Compare initial={compare} versions={versions} />}
      {tab === "rehearsal" && <Rehearsal />}
    </div>
  );
}

function Track({ label, level, unit }: { label: string; level: TrackLevel; unit: [string, string] }) {
  return (
    <div className="track">
      <div className="eyebrow">{label}</div>
      <div className="rank-title small">{level.name}</div>
      <div className="bar">
        <span style={{ width: `${level.progress * 100}%` }} />
      </div>
      <div className="muted small">
        {fmtXp(level.value)} {level.value === 1 ? unit[0] : unit[1]}
        {level.next ? ` · ${level.next.name} at ${fmtXp(level.next.min)}` : " · top of the track"}
      </div>
    </div>
  );
}

function useCurrentRevision(): { revision: ScriptRevisionRow; original: ScriptRevisionRow | undefined } {
  const { bundle } = useView();
  const script = bundle.scripts[0]!;
  const revision = bundle.scriptRevisions.find((r) => r.id === script.currentRevisionId)!;
  const original = bundle.scriptRevisions.find((r) => r.scriptId === script.id && r.parentId === null);
  return { revision, original };
}

// ---------- Editor ----------

function Editor({ scriptId }: { scriptId: string }) {
  const { service, currentId, reload } = useApp();
  const { bundle } = useView();
  const script = bundle.scripts.find((s) => s.id === scriptId)!;
  const { revision } = useCurrentRevision();
  // Local editing state; the stored revision only seeds it, so saves never move your cursor.
  const [sections, setSections] = useState<ScriptSection[]>(() => revision.sections.map((s) => ({ ...s })));
  const [status, setStatus] = useState<"saved" | "pending" | "saving" | "error">("saved");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(revision.updatedAt);
  const [title, setTitle] = useState(script.title);
  const [versioning, setVersioning] = useState(false);
  const latest = useRef(sections);
  latest.current = sections;

  const flush = useCallback(async () => {
    if (!currentId) return false;
    setStatus("saving");
    try {
      const saved = await service.scripts.saveDraft(currentId, scriptId, latest.current);
      setSavedAt(saved.updatedAt);
      setStatus(sectionsEqual(saved.sections, latest.current) ? "saved" : "pending");
      setError(null);
      await reload();
      return true;
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, [currentId, scriptId, service, reload]);

  useEffect(() => {
    if (status !== "pending") return;
    const t = setTimeout(() => void flush(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [sections, status, flush]);

  // Save on leaving the editor if something is still pending.
  const statusRef = useRef(status);
  statusRef.current = status;
  useEffect(() => () => void (statusRef.current === "pending" && flush()), [flush]);

  const update = (next: ScriptSection[]) => {
    setSections(next);
    setStatus("pending");
  };
  const patch = (id: string, change: Partial<ScriptSection>) => update(sections.map((s) => (s.id === id ? { ...s, ...change } : s)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...sections];
    const [s] = next.splice(i, 1);
    next.splice(i + d, 0, s!);
    update(next);
  };

  const words = sections.reduce((a, s) => a + s.body.split(/\s+/).filter(Boolean).length, 0);

  return (
    <section className="panel editor">
      <div className="row editor-bar">
        <input
          className="script-title"
          value={title}
          aria-label="Script title"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title !== script.title && currentId && service.scripts.renameScript(currentId, scriptId, title).then(reload, (e) => setError(String(e.message ?? e)))}
        />
        <span className="muted small">{words.toLocaleString()} words</span>
        <span className="spacer" />
        <span className={`save-status ${status}`} aria-live="polite">
          {status === "saved" && `Saved ${fmtDateTime(savedAt)}`}
          {status === "pending" && "Unsaved changes…"}
          {status === "saving" && "Saving…"}
          {status === "error" && "Not saved"}
        </span>
        <button
          className="btn primary small"
          onClick={async () => {
            if (status !== "saved" && !(await flush())) return;
            setVersioning(true);
          }}
        >
          Save as version…
        </button>
      </div>
      {error && <p className="warn-text">{error}</p>}
      {versioning && <NewVersion scriptId={scriptId} onDone={() => setVersioning(false)} />}

      {sections.map((s, i) => (
        <div key={s.id} className="section-editor">
          <div className="row">
            <input className="section-name" value={s.name} aria-label="Section name" onChange={(e) => patch(s.id, { name: e.target.value })} maxLength={60} />
            <span className="muted small">{s.body.split(/\s+/).filter(Boolean).length} words</span>
            <span className="spacer" />
            <button className="btn ghost small" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${s.name} up`}>
              ↑
            </button>
            <button className="btn ghost small" disabled={i === sections.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${s.name} down`}>
              ↓
            </button>
            {sections.length > 1 && <ConfirmButton label="Remove" confirmLabel={`Remove ${s.name}`} onConfirm={() => update(sections.filter((x) => x.id !== s.id))} />}
          </div>
          <textarea
            value={s.body}
            rows={Math.max(4, Math.min(24, s.body.split("\n").length + 2))}
            aria-label={`${s.name} text`}
            placeholder={`Write your ${s.name.toLowerCase()} here.`}
            onChange={(e) => patch(s.id, { body: e.target.value })}
          />
        </div>
      ))}
      <button className="btn ghost" onClick={() => update([...sections, { id: `s-${crypto.randomUUID().slice(0, 8)}`, name: "New section", body: "" }])}>
        + Add section
      </button>
    </section>
  );
}

function NewVersion({ scriptId, onDone }: { scriptId: string; onDone(): void }) {
  const { service, currentId, run } = useApp();
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  return (
    <form
      className="inline-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (currentId && (await run(`Version "${name}" saved`, () => service.scripts.createVersion(currentId, scriptId, name, note)))) onDone();
      }}
    >
      <div className="field-grid">
        <label className="field">
          <span>Version name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoFocus placeholder="e.g. Shorter opener" />
        </label>
        <label className="field">
          <span>
            What changed <em className="optional">optional</em>
          </span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <div className="row">
        <span className="spacer" />
        <button type="button" className="btn ghost small" onClick={onDone}>
          Cancel
        </button>
        <button className="btn primary small">Save version</button>
      </div>
    </form>
  );
}

// ---------- Versions ----------

function Versions({ versions, onCompare }: { versions: ScriptVersionRow[]; onCompare(a: string, b: string): void }) {
  const { service, currentId, run } = useApp();
  const { bundle } = useView();
  const [marking, setMarking] = useState<string | null>(null);
  if (versions.length === 0) {
    return (
      <section className="panel">
        <p className="muted">No versions yet. In the editor, use “Save as version…” to name a state of your script you want to keep.</p>
      </section>
    );
  }
  return (
    <section className="panel">
      <ul className="version-list">
        {versions.map((v, i) => {
          const prev = versions[i + 1];
          return (
            <li key={v.id}>
              <div className="row">
                <strong>{v.name}</strong>
                {v.meaningful && <span className="badge s-awarded">Improvement · {v.meaningful.tag}</span>}
                <span className="spacer" />
                <span className="muted small">{fmtDateTime(v.createdAt)}</span>
              </div>
              {v.note && <p className="muted">{v.note}</p>}
              {v.meaningful && <p className="small">“{v.meaningful.note}”</p>}
              <div className="row">
                <button className="btn ghost small" onClick={() => onCompare(prev?.revisionId ?? "original", v.revisionId)}>
                  Compare with {prev ? `"${prev.name}"` : "original"}
                </button>
                {currentId && (
                  <ConfirmButton
                    label="Restore into editor"
                    confirmLabel="Replace the draft with this version"
                    onConfirm={() => {
                      const rev = bundle.scriptRevisions.find((r) => r.id === v.revisionId)!;
                      void run(`Restored "${v.name}"`, () => service.scripts.saveDraft(currentId, v.scriptId, rev.sections));
                    }}
                  />
                )}
                <span className="spacer" />
                {!v.meaningful && currentId && (
                  <button className="btn small" onClick={() => setMarking(marking === v.id ? null : v.id)}>
                    Mark as meaningful improvement…
                  </button>
                )}
                {v.meaningful && currentId && (
                  <ConfirmButton
                    label="Withdraw mark"
                    confirmLabel="Withdraw and remove its XP"
                    onConfirm={() => run(`Withdrew "${v.name}"`, () => service.scripts.unmarkMeaningful(currentId, v.id), (r) => r)}
                  />
                )}
              </div>
              {marking === v.id && <MarkMeaningful version={v} onDone={() => setMarking(null)} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function MarkMeaningful({ version, onDone }: { version: ScriptVersionRow; onDone(): void }) {
  const { service, currentId, run, registry } = useApp();
  const type = registry.activityTypeById[REVISION_TYPE]!;
  const tagField = type.fields.find((f) => f.key === "tag")!;
  const noteField = type.fields.find((f) => f.key === "note")!;
  const [tag, setTag] = useState(tagField.options![0]!);
  const [note, setNote] = useState("");
  const min = noteField.minLength ?? 0;
  return (
    <form
      className="inline-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (currentId && (await run(`"${version.name}" marked as an improvement`, () => service.scripts.markMeaningful(currentId, version.id, tag, note), (r) => r))) onDone();
      }}
    >
      <p className="muted small">
        Mark only real improvements over the version before it. Credit is limited to {type.limits.daily?.fullUpTo} a day and {type.limits.weekly?.fullUpTo} a week.
      </p>
      <label className="field">
        <span>Kind of improvement</span>
        <select value={tag} onChange={(e) => setTag(e.target.value)}>
          {tagField.options!.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>What changed and why</span>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        <small className="muted">
          {note.trim().length} / {min} characters minimum
        </small>
      </label>
      <div className="row">
        <span className="spacer" />
        <button type="button" className="btn ghost small" onClick={onDone}>
          Cancel
        </button>
        <button className="btn primary small" disabled={note.trim().length < min}>
          Mark improvement
        </button>
      </div>
    </form>
  );
}

// ---------- Compare ----------

function Compare({ initial, versions }: { initial: { a: string; b: string } | null; versions: ScriptVersionRow[] }) {
  const { bundle } = useView();
  const { revision, original } = useCurrentRevision();
  const options = [
    { id: "original", label: "Original script" },
    ...[...versions].reverse().map((v) => ({ id: v.revisionId, label: `${v.name} · ${fmtDateTime(v.createdAt)}` })),
    { id: "current", label: "Current draft" },
  ];
  const [a, setA] = useState(initial?.a ?? (versions[0]?.revisionId ?? "original"));
  const [b, setB] = useState(initial?.b ?? "current");
  const [layout, setLayout] = useState<"inline" | "side">("inline");

  const sectionsOf = (id: string) =>
    id === "original" ? (original?.sections ?? []) : id === "current" ? revision.sections : (bundle.scriptRevisions.find((r) => r.id === id)?.sections ?? []);
  const diff = useMemo(() => diffScripts(sectionsOf(a), sectionsOf(b)), [a, b, bundle.scriptRevisions, revision]);
  const changed = diff.filter((d) => d.status !== "same");

  return (
    <section className="panel compare">
      <div className="field-grid">
        <label className="field">
          <span>From</span>
          <select value={a} onChange={(e) => setA(e.target.value)}>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>To</span>
          <select value={b} onChange={(e) => setB(e.target.value)}>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row">
        <span>
          {changed.length === 0 ? "No differences." : `${changed.length} section${changed.length === 1 ? "" : "s"} changed`} ·{" "}
          <span className="diff-add">+{diff.reduce((n, d) => n + d.added, 0)} words</span> <span className="diff-del">−{diff.reduce((n, d) => n + d.removed, 0)} words</span>
        </span>
        <span className="spacer" />
        <div className="tabs small" role="tablist">
          <button role="tab" aria-selected={layout === "inline"} className={layout === "inline" ? "on" : ""} onClick={() => setLayout("inline")}>
            Inline
          </button>
          <button role="tab" aria-selected={layout === "side"} className={layout === "side" ? "on" : ""} onClick={() => setLayout("side")}>
            Side by side
          </button>
        </div>
      </div>

      {diff.map((d) => (
        <details key={d.id} className={`diff-section ${d.status}`} open={d.status !== "same"}>
          <summary>
            <strong>{d.name}</strong>
            {d.oldName && <span className="muted"> (was “{d.oldName}”)</span>} <span className={`badge diff-${d.status}`}>{d.status}</span>
          </summary>
          {layout === "inline" ? (
            <div className="diff-text">
              {d.parts.map((p, i) => (
                <span key={i} className={p.added ? "diff-add" : p.removed ? "diff-del" : undefined}>
                  {p.value}
                </span>
              ))}
            </div>
          ) : (
            <div className="diff-side">
              <div className="diff-text">
                {d.parts
                  .filter((p) => !p.added)
                  .map((p, i) => (
                    <span key={i} className={p.removed ? "diff-del" : undefined}>
                      {p.value}
                    </span>
                  ))}
              </div>
              <div className="diff-text">
                {d.parts
                  .filter((p) => !p.removed)
                  .map((p, i) => (
                    <span key={i} className={p.added ? "diff-add" : undefined}>
                      {p.value}
                    </span>
                  ))}
              </div>
            </div>
          )}
        </details>
      ))}
    </section>
  );
}

// ---------- Rehearsal ----------

function Rehearsal() {
  const { registry } = useApp();
  const { bundle } = useView();
  const { revision } = useCurrentRevision();
  const [logging, setLogging] = useState<string[] | null>(null);
  const bySection = rehearsalBySection(bundle.activities);
  const recent = bundle.activities
    .filter((a) => a.typeId === REHEARSAL_TYPE && a.status === "active")
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
    .slice(0, 10);
  const type = registry.activityTypeById[REHEARSAL_TYPE]!;
  const name = (id: string) => revision.sections.find((s) => s.id === id)?.name ?? "Removed section";

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Rehearsal Hall</h2>
        <span className="muted">Read, rehearse aloud, run from memory, or record and review. Recorded sessions earn 25% more.</span>
        <span className="spacer" />
        <button className="btn primary" onClick={() => setLogging([])}>
          Log rehearsal
        </button>
      </header>
      <table className="compact">
        <thead>
          <tr>
            <th>Section</th>
            <th className="num">Minutes</th>
            <th className="num">Sessions</th>
            <th>Last rehearsed</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {revision.sections.map((s) => {
            const p = bySection.get(s.id);
            return (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td className="num">{p ? fmtXp(p.minutes) : 0}</td>
                <td className="num">{p?.sessions ?? 0}</td>
                <td>{p?.lastAt ? fmtDateTime(p.lastAt) : <span className="muted">never</span>}</td>
                <td className="actions">
                  <button className="btn ghost small" onClick={() => setLogging([s.id])}>
                    Rehearse
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">
        {type.limits.daily && `Full credit for the first ${type.limits.daily.fullUpTo} minutes a day, half up to ${type.limits.daily.reducedUpTo}.`} Minutes for a session
        that covers several sections are split evenly between them.
      </p>

      <h3>Recent sessions</h3>
      {recent.length === 0 ? (
        <p className="muted">No rehearsals logged yet.</p>
      ) : (
        <ul className="history">
          {recent.map((a) => (
            <li key={a.id}>
              <span className="muted">{fmtDateTime(a.occurredAt)}</span> {a.record.units} min · {type.modes[a.record.mode ?? ""]?.label ?? ""} ·{" "}
              {((a.values.sections as string[] | undefined) ?? []).map(name).join(", ")}
            </li>
          ))}
        </ul>
      )}
      {logging && <QuickLog start={{ typeId: REHEARSAL_TYPE, values: { sections: logging } }} onClose={() => setLogging(null)} />}
    </section>
  );
}
