import { format, parseISO, startOfWeek, subWeeks } from "date-fns";
import { useMemo, useState } from "react";
import { checkpointState, evaluateAttempt, gateConditions, type AttemptEvaluation, type CheckpointState } from "../../domain";
import type { CourseRow, LightspeedAttemptRow, SaleRow } from "../../persistence/types";
import { LIGHTSPEED_ID, lightspeedSales } from "../../records/achievements";
import { nowLocal, todayLocal } from "../../records/clock";
import { reconcileDays } from "../../records/production";
import { useApp, useView } from "../app/context";
import { IslandHeader, Tabs, fmtDuration, parseDuration } from "../components/Island";
import { ConfirmButton } from "../components/Modal";
import { QuickLog, type QuickLogStart } from "../components/QuickLog";
import { fmtDate, fmtDateTime, fmtMoney, fmtPercent, fmtXp } from "../format";

const TRIAL = "core:act.time-trial";
const APP_NAV = "fe:act.app-navigation";
const SPEED = "core:skill.speed";

type Tab = "courses" | "race" | "garage";

/** Velocity Circuit: timed courses, your call pace, and the Lightspeed Garage. */
export function Velocity() {
  const [tab, setTab] = useState<Tab>("courses");
  const [log, setLog] = useState<QuickLogStart | null>(null);
  return (
    <div className="page velocity">
      <IslandHeader
        islandId="core:island.velocity-circuit"
        eyebrow="Velocity Circuit"
        title="Shave the seconds. Keep it clean."
        intro="Set target times on your courses (frozen once set), run clean time trials, watch your call pace, and pursue Lightspeed."
      >
        <Tabs<Tab>
          tabs={[
            ["courses", "Courses & time trials"],
            ["race", "Race log"],
            ["garage", "Lightspeed Garage"],
          ]}
          value={tab}
          onChange={setTab}
        />
      </IslandHeader>
      {tab === "courses" && <Courses onLog={setLog} />}
      {tab === "race" && <RaceLog />}
      {tab === "garage" && <Garage />}
      {log && <QuickLog start={log} onClose={() => setLog(null)} />}
    </div>
  );
}

// ---------- Courses ----------

function Courses({ onLog }: { onLog(s: QuickLogStart): void }) {
  const { bundle } = useView();
  const runs = bundle.activities.filter((a) => (a.typeId === TRIAL || a.typeId === APP_NAV) && a.status === "active");
  const carrierLabel = (key: string | null) => bundle.carriers.find((c) => c.key === key)?.label ?? "";

  const runsFor = (c: CourseRow) =>
    c.kind === "app" ? runs.filter((r) => r.typeId === APP_NAV && r.values.carrierId === c.carrierKey) : runs.filter((r) => r.typeId === TRIAL && r.values.courseId === c.key);
  const clean = (c: CourseRow) => (c.kind === "app" ? "completed" : "clean");

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Courses</h2>
        <span className="muted">Off the Line needs a clean script run under target; Pit Crew needs application runs under target on 3 carriers.</span>
      </header>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th>Course</th>
              <th>Target</th>
              <th className="num">Best clean</th>
              <th className="num">Runs</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {bundle.courses
              .filter((c) => !c.archived)
              .map((c) => {
                const these = runsFor(c);
                const best = Math.min(...these.filter((r) => r.values[clean(c)] === true).map((r) => Number(r.values.durationSeconds)));
                const beat = c.targetSeconds !== null && best < c.targetSeconds;
                return (
                  <tr key={c.key}>
                    <td>
                      <strong>{c.name}</strong>
                      <div className="muted small">{c.kind === "app" ? `Application · ${carrierLabel(c.carrierKey)}` : c.kind === "script" ? "Script run" : "General"}</div>
                    </td>
                    <td>
                      <Target course={c} />
                    </td>
                    <td className="num">
                      {Number.isFinite(best) ? fmtDuration(best) : "—"} {beat && <span className="badge s-awarded">under target</span>}
                    </td>
                    <td className="num">{these.length}</td>
                    <td className="actions">
                      <button
                        className="btn ghost small"
                        onClick={() =>
                          onLog(
                            c.kind === "app"
                              ? { typeId: APP_NAV, values: { carrierId: c.carrierKey } }
                              : { typeId: TRIAL, values: { courseId: c.key } },
                          )
                        }
                      >
                        Run
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      <NewCourse />
      <h3>Recent runs</h3>
      <ul className="history">
        {runs
          .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
          .slice(0, 12)
          .map((r) => (
            <li key={r.id}>
              <span className="muted">{fmtDateTime(r.occurredAt)}</span> {r.typeId === APP_NAV ? `Application · ${carrierLabel(String(r.values.carrierId))}` : bundle.courses.find((c) => c.key === r.values.courseId)?.name}
              {" · "}
              {fmtDuration(Number(r.values.durationSeconds))}
              {r.record.personalBest && <span className="badge s-awarded">Personal best</span>}
              {r.values.clean === false || r.values.completed === false ? <span className="badge">not clean</span> : null}
            </li>
          ))}
      </ul>
    </section>
  );
}

function Target({ course }: { course: CourseRow }) {
  const { service, currentId, run } = useApp();
  const [text, setText] = useState("");
  if (course.targetSeconds !== null) {
    return (
      <span>
        {fmtDuration(course.targetSeconds)} <span className="muted small">set {fmtDate(course.targetSetOn!)} · frozen</span>
      </span>
    );
  }
  const seconds = parseDuration(text);
  return (
    <span className="row">
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="m:ss" aria-label={`Target for ${course.name}`} style={{ width: "5.5rem" }} />
      {seconds !== null && currentId && (
        <ConfirmButton
          label="Set"
          confirmLabel={`Freeze target at ${fmtDuration(seconds)}`}
          onConfirm={() => run("Target set", () => service.islands.setCourseTarget(currentId, course.key, seconds))}
        />
      )}
    </span>
  );
}

function NewCourse() {
  const { service, currentId, run } = useApp();
  const { bundle } = useView();
  const [form, setForm] = useState({ name: "", kind: "script" as CourseRow["kind"], carrierKey: "" });
  return (
    <form
      className="row new-course"
      onSubmit={async (e) => {
        e.preventDefault();
        if (currentId && (await run("Course added", () => service.islands.saveCourse(currentId, { ...form, carrierKey: form.carrierKey || null })))) {
          setForm({ ...form, name: "" });
        }
      }}
    >
      <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="New course name" aria-label="Course name" required maxLength={80} />
      <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as CourseRow["kind"] })} aria-label="Course kind">
        <option value="script">Script run</option>
        <option value="app">Application navigation</option>
        <option value="general">General</option>
      </select>
      {form.kind === "app" && (
        <select value={form.carrierKey} onChange={(e) => setForm({ ...form, carrierKey: e.target.value })} aria-label="Carrier" required>
          <option value="">Carrier…</option>
          {bundle.carriers
            .filter((c) => !c.archived)
            .map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
        </select>
      )}
      <button className="btn small">Add course</button>
    </form>
  );
}

// ---------- Race log ----------

function RaceLog() {
  const { bundle } = useView();
  const days = useMemo(() => reconcileDays(bundle.dailyReports, bundle.sales), [bundle.dailyReports, bundle.sales]);
  const weeks = Array.from({ length: 12 }, (_, i) => format(startOfWeek(subWeeks(new Date(), i), { weekStartsOn: 1 }), "yyyy-MM-dd")).reverse();
  const rows = weeks.map((w) => {
    const inWeek = days.filter((d) => d.calls !== null && format(startOfWeek(parseISO(d.date), { weekStartsOn: 1 }), "yyyy-MM-dd") === w);
    const calls = inWeek.reduce((n, d) => n + d.calls!, 0);
    const hours = inWeek.reduce((n, d) => n + d.hours!, 0);
    const apps = inWeek.reduce((n, d) => n + d.applications, 0);
    return { week: w, calls, hours, apps, cph: hours > 0 ? calls / hours : null, close: calls > 0 ? apps / calls : null };
  });
  const maxCph = Math.max(1, ...rows.map((r) => r.cph ?? 0));
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Race log</h2>
        <span className="muted">Weekly pace from your daily reports (last 12 weeks).</span>
      </header>
      <table className="compact">
        <thead>
          <tr>
            <th>Week of</th>
            <th className="num">Calls</th>
            <th className="num">Hours</th>
            <th className="num">Sales</th>
            <th>Calls per hour</th>
            <th className="num">Close rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.week}>
              <td>{fmtDate(r.week)}</td>
              <td className="num">{r.calls}</td>
              <td className="num">{fmtXp(r.hours)}</td>
              <td className="num">{r.apps}</td>
              <td>
                <span className="pace">
                  <span className="mini-bar wide">
                    <span style={{ width: `${((r.cph ?? 0) / maxCph) * 100}%` }} />
                  </span>
                  {r.cph === null ? "—" : r.cph.toFixed(1)}
                </span>
              </td>
              <td className="num">{fmtPercent(r.close, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ---------- Lightspeed Garage ----------

const CHECKPOINT_LABEL: Record<CheckpointState, string> = {
  pending: "Checkpoint not reached",
  awaiting: "Awaiting your confirmation",
  confirmedOk: "Confirmed: no chargeback",
  chargeback: "Chargeback",
  anchorMissing: "Anchor date needed",
};

function Garage() {
  const { registry } = useApp();
  const { bundle, state, ruleset } = useView();
  const now = nowLocal();
  const rules = ruleset.lightspeed;
  const salesById = useMemo(() => lightspeedSales(bundle.sales), [bundle.sales]);
  const attempts = [...bundle.lightspeedAttempts].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const evals = new Map(attempts.map((a) => [a.id, evaluateAttempt(a, salesById, rules, now)]));
  const gate = gateConditions(state, ruleset, SPEED, 5, now);
  const recorded = bundle.achievements.find((a) => a.achievementId === LIGHTSPEED_ID);
  const def = registry.achievementById[LIGHTSPEED_ID]!;

  return (
    <>
      <section className="panel">
        <header className="panel-head">
          <h2>Lightspeed</h2>
          {state.skills[SPEED]!.rank === 5 ? <span className="badge s-awarded">Achieved</span> : recorded ? <span className="badge s-reduced">Evidence recorded</span> : null}
        </header>
        <p className="muted">{def.description}</p>
        <ul className="checklist">
          <li>
            <span className={`check ${recorded ? "met" : ""}`}>{recorded ? "✓" : "○"}</span> {rules.salesRequired} sales in one {rules.windowMinutes}-minute window, every policy past{" "}
            {rules.retentionMonths} calendar months with no chargeback (confirmed by you)
          </li>
          {gate
            .filter((c) => c.kind !== "achievement")
            .map((c, i) => (
              <li key={i}>
                <span className={`check ${c.met ? "met" : ""}`}>{c.met ? "✓" : "○"}</span>{" "}
                {c.kind === "score"
                  ? `Speed score ${fmtXp(c.current)} / ${fmtXp(c.required)}`
                  : c.kind === "elapsedDays"
                    ? `${c.current} / ${c.required} days since your journey began`
                    : c.kind === "activeWeeks"
                      ? `${c.current} / ${c.required} active Speed weeks`
                      : c.kind === "breadth"
                        ? `Breadth: ${c.qualifyingTypes}/${c.requiredTypes} activity types at 10%+, largest ${fmtPercent(c.largestShare)}`
                        : ""}
              </li>
            ))}
        </ul>
        <p className="muted small">
          Checkpoints use calendar months: a sale submitted Jan 31 is checked on Apr 30. Silence never counts as “no chargeback”. You confirm each one on or after its date.
          {rules.failurePolicy === "attemptIneligible" && " One chargeback makes that attempt ineligible; its history is kept and you can start another from a different window."}
        </p>
      </section>

      <WindowFinder taken={new Set(attempts.filter((a) => evals.get(a.id)?.status !== "failed" || !rules.allowSubstitutionFromSameWindow).flatMap((a) => a.saleIds))} />

      {attempts.map((a) => (
        <AttemptCard key={a.id} attempt={a} evaluation={evals.get(a.id)!} />
      ))}
    </>
  );
}

/** Finds windows of itemized sales that could form an attempt. */
function WindowFinder({ taken }: { taken: Set<string> }) {
  const { service, currentId, run } = useApp();
  const { bundle, ruleset } = useView();
  const rules = ruleset.lightspeed;
  const windows = useMemo(() => {
    const free = bundle.sales.filter((s) => !taken.has(s.id)).sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : 1));
    const out: SaleRow[][] = [];
    for (let i = 0; i < free.length; i++) {
      const start = parseISO(free[i]!.submittedAt).getTime();
      const group = free.filter((s, j) => j >= i && parseISO(s.submittedAt).getTime() - start <= rules.windowMinutes * 60_000);
      if (group.length >= 2 && !out.some((w) => group.every((s) => w.includes(s)))) out.push(group.slice(0, rules.salesRequired));
    }
    return out.sort((a, b) => b.length - a.length).slice(0, 5);
  }, [bundle.sales, taken, rules]);

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Find a window</h2>
        <span className="muted">From your itemized sales (Production Office). Sales from separate windows are never combined.</span>
      </header>
      {windows.length === 0 ? (
        <p className="muted">No {rules.windowMinutes}-minute window has two or more unused itemized sales yet.</p>
      ) : (
        <ul className="history">
          {windows.map((w) => (
            <li key={w[0]!.id} className="row">
              <span>
                {fmtDateTime(w[0]!.submittedAt)} – {w[w.length - 1]!.submittedAt.slice(11, 16)}
              </span>
              <strong>
                {w.length} sale{w.length === 1 ? "" : "s"}
              </strong>
              {w.length >= rules.salesRequired && <span className="badge s-awarded">Full attempt</span>}
              <span className="spacer" />
              {currentId && (
                <ConfirmButton
                  label="Start attempt"
                  confirmLabel={`Start with these ${w.length}`}
                  onConfirm={() => run("Lightspeed attempt started", () => service.lightspeed.createAttempt(currentId, { saleIds: w.map((s) => s.id) }))}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const STATUS_LABEL: Record<AttemptEvaluation["status"], string> = {
  invalid: "Invalid",
  collecting: "Collecting sales",
  waiting: "Waiting on checkpoints",
  failed: "Ineligible (chargeback)",
  evidenceComplete: "Evidence complete",
};

function AttemptCard({ attempt, evaluation }: { attempt: LightspeedAttemptRow; evaluation: AttemptEvaluation }) {
  const { service, currentId, run } = useApp();
  const { bundle, ruleset } = useView();
  const [showHistory, setShowHistory] = useState(false);
  const today = todayLocal();
  const sale = (id: string) => bundle.sales.find((s) => s.id === id);
  const confirmed = evaluation.sales.filter((s) => s.checkpoint === "confirmedOk").length;
  const cls = evaluation.status === "evidenceComplete" ? "s-awarded" : evaluation.status === "failed" || evaluation.status === "invalid" ? "s-blocked-cap" : "s-reduced";

  return (
    <section className="panel attempt">
      <header className="panel-head">
        <h2>
          {fmtDateTime(attempt.windowStart)} – {attempt.windowEnd.slice(11, 16)}
        </h2>
        <span className={`badge ${cls}`}>{STATUS_LABEL[evaluation.status]}</span>
        <span className="muted">
          {attempt.saleIds.length} / {ruleset.lightspeed.salesRequired} sales · {confirmed} confirmed
        </span>
        <span className="spacer" />
        {(evaluation.status === "collecting" || evaluation.status === "invalid") && currentId && (
          <ConfirmButton label="Delete" confirmLabel="Delete attempt" onConfirm={() => run("Attempt deleted", () => service.lightspeed.deleteAttempt(currentId, attempt.id))} />
        )}
      </header>
      {evaluation.issues.map((i) => (
        <p key={i} className="warn-text">
          {i}
        </p>
      ))}
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th>Submitted</th>
              <th>Carrier</th>
              <th className="num">Issue Paid</th>
              <th>Checkpoint</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {evaluation.sales.map((s) => {
              const row = sale(s.saleId);
              const cp = row ? checkpointState({ id: row.id, submittedAt: row.submittedAt, ...(row.anchorDate ? { anchorDate: row.anchorDate } : {}), ...(row.retention ? { retention: row.retention } : {}) }, ruleset.lightspeed, nowLocal()) : null;
              const due = cp?.dueDate ?? null;
              return (
                <tr key={s.saleId}>
                  <td>{row ? row.submittedAt.slice(11, 16) : "—"}</td>
                  <td>{bundle.carriers.find((c) => c.key === row?.carrierId)?.label ?? "—"}</td>
                  <td className="num">{row?.issuePaid != null ? fmtMoney(row.issuePaid, row.currency) : "—"}</td>
                  <td>{due ? fmtDate(due) : "—"}</td>
                  <td>
                    <span className={`badge ${s.checkpoint === "confirmedOk" ? "s-awarded" : s.checkpoint === "chargeback" ? "s-blocked-cap" : s.checkpoint === "awaiting" ? "s-reduced" : ""}`}>
                      {CHECKPOINT_LABEL[s.checkpoint]}
                    </span>
                  </td>
                  <td className="actions">
                    {currentId && row && !row.retention && (
                      <span className="confirm-inline">
                        {due && today >= due && (
                          <ConfirmButton
                            label="No chargeback"
                            confirmLabel="Confirm: still in force, no chargeback"
                            onConfirm={() => run("Checkpoint confirmed", () => service.lightspeed.confirmRetention(currentId, row.id, "confirmedOk"), (r) => r)}
                          />
                        )}
                        <ConfirmButton label="Chargeback" confirmLabel="Report chargeback" onConfirm={() => run("Chargeback recorded", () => service.lightspeed.confirmRetention(currentId, row.id, "chargeback"), (r) => r)} />
                      </span>
                    )}
                    {currentId && row?.retention && !attempt.achievementRecordedAt && (
                      <ConfirmButton label="Undo" confirmLabel="Clear this entry" onConfirm={() => run("Entry cleared", () => service.lightspeed.clearRetention(currentId, row.id))} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button className="link-btn" onClick={() => setShowHistory(!showHistory)} aria-expanded={showHistory}>
        {showHistory ? "Hide history" : `History (${attempt.history.length})`}
      </button>
      {showHistory && (
        <ul className="history">
          {attempt.history.map((h, i) => (
            <li key={i}>
              <span className="muted">{fmtDateTime(h.at)}</span> {h.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
