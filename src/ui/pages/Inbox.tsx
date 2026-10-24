import { format, subDays } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import { CATEGORY_LABEL, type SubmissionEnvelope } from "../../integrations/contracts";
import { MOCK_GROKBOT, mockDailyReport, mockSale } from "../../integrations/mockGrokbot";
import { DexieSecretStore } from "../../persistence/secrets";
import { SUBMISSION_CATEGORIES, type IntegrationSourceRow, type Permission, type SubmissionRow } from "../../persistence/types";
import { nowLocal } from "../../records/clock";
import { useApp, useView } from "../app/context";
import { ConfirmButton } from "../components/Modal";
import { fmtDateTime, fmtMoney } from "../format";
import { href } from "../routes";

const PERMISSION_LABEL: Record<Permission, string> = { none: "No access", submit: "Submit for approval", autoAccept: "Apply automatically" };

/**
 * The approval inbox. Outside sources (a simulated Grokbot for now) can only
 * submit; nothing changes your records until you approve, unless you
 * explicitly allow automatic acceptance for a category.
 */
export function Inbox() {
  const { bundle } = useView();
  const pending = bundle.submissions.filter((s) => s.status === "pending").sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
  const decided = bundle.submissions.filter((s) => s.status !== "pending").sort((a, b) => ((a.decidedAt ?? a.receivedAt) < (b.decidedAt ?? b.receivedAt) ? 1 : -1));
  const [showAll, setShowAll] = useState(false);

  return (
    <div className="page inbox">
      <header className="island-head island-inbox">
        <div>
          <div className="eyebrow">Inbox</div>
          <h1>Submissions from your tools</h1>
          <p className="muted">
            Outside sources can only submit to the categories you allow. Nothing they send changes your records until you approve it, unless you turn on
            automatic acceptance. The same submission is never applied twice. Every decision is in the <a href={href({ page: "audit" })}>audit log</a>.
          </p>
        </div>
      </header>

      <Sources />

      <section className="panel">
        <header className="panel-head">
          <h2>Waiting for you ({pending.length})</h2>
        </header>
        {pending.length === 0 ? <p className="muted">Nothing waiting.</p> : pending.map((s) => <PendingCard key={s.id} s={s} />)}
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>History</h2>
          <span className="spacer" />
          {decided.length > 15 && (
            <button className="link-btn small" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show recent" : `Show all ${decided.length}`}
            </button>
          )}
        </header>
        {decided.length === 0 ? (
          <p className="muted">No decisions yet.</p>
        ) : (
          <ul className="history">
            {(showAll ? decided : decided.slice(0, 15)).map((s) => (
              <li key={s.id} className="row">
                <span className={`badge ${s.status === "approved" ? "s-awarded" : s.status === "refused" ? "s-blocked-cap" : ""}`}>
                  {s.status === "approved" && s.decidedBy === "auto" ? "applied automatically" : s.status}
                </span>
                <span>{CATEGORY_LABEL[s.category]}</span>
                <code className="small">{s.externalId}</code>
                <span className="muted small">{sourceName(bundle.integrationSources, s.sourceId)}</span>
                {s.errors[0] && <span className="warn-text small">{s.errors[0]}</span>}
                {s.note && <span className="muted small">“{s.note}”</span>}
                <span className="spacer" />
                <span className="muted small">{fmtDateTime(s.decidedAt ?? s.receivedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function sourceName(sources: IntegrationSourceRow[], id: string): string {
  return sources.find((s) => s.id === id)?.name ?? "Unknown source";
}

function Sources() {
  const { service, currentId, run } = useApp();
  const { bundle } = useView();
  if (!currentId) return null;
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Sources</h2>
        <span className="muted">No live connections exist yet. Grokbot is simulated here so you can see how approvals will work.</span>
        <span className="spacer" />
        {!bundle.integrationSources.some((s) => s.adapter === MOCK_GROKBOT.id) && (
          <button className="btn primary small" onClick={() => run("Source added", () => service.integrations.addSource(currentId, { name: MOCK_GROKBOT.name, adapter: MOCK_GROKBOT.id }))}>
            Add {MOCK_GROKBOT.name}
          </button>
        )}
      </header>
      {bundle.integrationSources.length === 0 && <p className="muted">No sources yet.</p>}
      {bundle.integrationSources.map((s) => (
        <SourceCard key={s.id} source={s} />
      ))}
    </section>
  );
}

function SourceCard({ source }: { source: IntegrationSourceRow }) {
  const { service, currentId, run } = useApp();
  const [confirming, setConfirming] = useState<string | null>(null);
  const simulated = source.adapter === MOCK_GROKBOT.id;
  if (!currentId) return null;
  const set = (category: (typeof SUBMISSION_CATEGORIES)[number], p: Permission, confirm = false) =>
    run("Permission updated", () => service.integrations.setPermission(currentId, source.id, category, p, { confirmAutoAccept: confirm }));

  return (
    <div className="source-card">
      <div className="row">
        <strong>{source.name}</strong>
        {simulated && <span className="badge">Simulated</span>}
        <span className={`badge ${source.enabled ? "s-awarded" : ""}`}>{source.enabled ? "Enabled" : "Disabled"}</span>
        <span className="spacer" />
        <span className="muted small">{source.lastReceivedAt ? `Last heard ${fmtDateTime(source.lastReceivedAt)}` : "Nothing received yet"}</span>
        <button className="btn ghost small" onClick={() => run(source.enabled ? "Source disabled" : "Source enabled", () => service.integrations.setEnabled(currentId, source.id, !source.enabled))}>
          {source.enabled ? "Disable" : "Enable"}
        </button>
      </div>
      <table className="compact permissions">
        <tbody>
          {SUBMISSION_CATEGORIES.map((c) => (
            <tr key={c}>
              <td>{CATEGORY_LABEL[c]}</td>
              <td>
                <select
                  value={source.permissions[c]}
                  aria-label={`${source.name} permission for ${CATEGORY_LABEL[c]}`}
                  onChange={(e) => {
                    const p = e.target.value as Permission;
                    if (p === "autoAccept") setConfirming(c);
                    else void set(c, p);
                  }}
                >
                  {(Object.keys(PERMISSION_LABEL) as Permission[]).map((p) => (
                    <option key={p} value={p}>
                      {PERMISSION_LABEL[p]}
                    </option>
                  ))}
                </select>
                {confirming === c && (
                  <div className="callout warn small">
                    Automatic acceptance writes {CATEGORY_LABEL[c].toLowerCase()} into your records without review, and they count toward progress like your own
                    entries. Duplicates are still blocked.
                    <div className="row">
                      <button className="btn danger small" onClick={() => void set(c, "autoAccept", true).then(() => setConfirming(null))}>
                        Turn on automatic acceptance
                      </button>
                      <button className="btn ghost small" onClick={() => setConfirming(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {simulated ? <Simulator source={source} /> : <Credential sourceId={source.id} />}
    </div>
  );
}

/** Credentials live in a separate browser database and are never exported. */
function Credential({ sourceId }: { sourceId: string }) {
  const store = useMemo(() => new DexieSecretStore(), []);
  const [has, setHas] = useState(false);
  const [value, setValue] = useState("");
  useEffect(() => {
    void store.has(sourceId).then(setHas);
  }, [store, sourceId]);
  return (
    <div className="row small">
      <span className="muted">Credential: {has ? "stored on this device" : "none"}. Never included in backups or starter maps.</span>
      <input type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder="API key" aria-label="Credential" autoComplete="off" />
      <button
        className="btn ghost small"
        disabled={!value}
        onClick={async () => {
          await store.set(sourceId, value);
          setValue("");
          setHas(true);
        }}
      >
        Save
      </button>
      {has && (
        <button
          className="btn ghost small"
          onClick={async () => {
            await store.remove(sourceId);
            setHas(false);
          }}
        >
          Remove
        </button>
      )}
    </div>
  );
}

/** Sends sample envelopes from the simulated Grokbot, including the awkward cases. */
function Simulator({ source }: { source: IntegrationSourceRow }) {
  const { service, currentId, run } = useApp();
  const { bundle } = useView();
  const [last, setLast] = useState<SubmissionEnvelope | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  if (!currentId) return null;
  const today = nowLocal().slice(0, 10);
  const yesterday = format(subDays(new Date(), 1), "yyyy-MM-dd");
  const carrier = bundle.carriers.find((c) => !c.archived)?.label ?? null;

  const send = async (env: SubmissionEnvelope) => {
    setLast(env);
    const r = await run("Grokbot sent a submission", () => service.integrations.receive(currentId, source.id, env));
    if (r) setOutcome(`${r.outcome}${r.submission.errors[0] ? `: ${r.submission.errors[0]}` : ""}`);
  };

  return (
    <div className="simulator">
      <div className="eyebrow">Simulate Grokbot</div>
      <div className="row">
        <button className="btn small" onClick={() => send(mockDailyReport(today))}>
          Send today's report
        </button>
        <button className="btn small" onClick={() => send(mockDailyReport(yesterday))}>
          Send yesterday's report
        </button>
        <button className="btn small" onClick={() => send(mockSale(nowLocal().slice(0, 16), carrier, Date.now() % 100000))}>
          Send a sale
        </button>
        <button className="btn ghost small" disabled={!last} onClick={() => last && send(last)}>
          Resend the last one
        </button>
        <button className="btn ghost small" onClick={() => send(mockDailyReport(today, 1))}>
          Send a changed report for today
        </button>
      </div>
      {outcome && <p className="small">Last result: <strong>{outcome}</strong></p>}
    </div>
  );
}

function PendingCard({ s }: { s: SubmissionRow }) {
  const { service, currentId, run } = useApp();
  const { bundle } = useView();
  const [note, setNote] = useState("");
  if (!currentId) return null;
  const p = s.payload as Record<string, unknown>;
  const money = (v: unknown) => (typeof v === "number" ? fmtMoney(v, bundle.instance.settings.currency) : "—");
  const rows: [string, string][] =
    s.category === "dailyReport"
      ? [
          ["Date", String(p.date)],
          ["Calls", String(p.calls)],
          ["Hours", String(p.hours)],
          ["Sales (apps submitted)", String(p.applicationsSubmitted)],
          ["Issue Paid", money(p.issuePaid)],
          ["Notes", String(p.notes ?? "")],
        ]
      : [
          ["Submitted", String(p.submittedAt).replace("T", " ")],
          ["Carrier", String(p.carrier ?? "—")],
          ["Product", String(p.product || "—")],
          ["Issue Paid", money(p.issuePaid)],
        ];
  return (
    <div className="pending-card">
      <div className="row">
        <strong>{CATEGORY_LABEL[s.category]}</strong>
        <span className="muted small">from {sourceName(bundle.integrationSources, s.sourceId)}</span>
        <code className="small">{s.externalId}</code>
        <span className="spacer" />
        <span className="muted small">Received {fmtDateTime(s.receivedAt)}</span>
      </div>
      <dl className="count-grid">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {s.warnings.map((w) => (
        <p key={w} className="warn-text small">
          ⚠ {w}
        </p>
      ))}
      <div className="row">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Decision note" />
        <span className="spacer" />
        <ConfirmButton label="Reject" confirmLabel="Reject submission" onConfirm={() => run("Submission rejected", () => service.integrations.reject(currentId, s.id, note))} />
        <button className="btn primary small" onClick={() => run("Submission approved", () => service.integrations.approve(currentId, s.id, { note }), (r) => r)}>
          Approve
        </button>
      </div>
    </div>
  );
}
