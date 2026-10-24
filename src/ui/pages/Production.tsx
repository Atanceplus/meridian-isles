import { format, startOfMonth, startOfWeek, subDays } from "date-fns";
import { useMemo, useState } from "react";
import type { DailyReportRow, SaleRow } from "../../persistence/types";
import { nowLocal, todayLocal } from "../../records/clock";
import { reconcileDays, summarize, type DayProduction, type ProductionSummary, type ReconciliationStatus } from "../../records/production";
import { useApp, useView } from "../app/context";
import { ConfirmButton } from "../components/Modal";
import { fmtDate, fmtMoney, fmtPercent, fmtRate, toInputDateTime } from "../format";

const STATUS: Record<ReconciliationStatus, { label: string; cls: string }> = {
  totalsOnly: { label: "Totals only", cls: "s-neutral" },
  matched: { label: "Matched", cls: "s-awarded" },
  partial: { label: "Partly itemized", cls: "s-reduced" },
  conflict: { label: "Conflict", cls: "s-blocked-cap" },
  derived: { label: "From sales", cls: "s-neutral" },
};

export function Production() {
  const { bundle } = useView();
  const currency = bundle.instance.settings.currency;
  const days = useMemo(() => reconcileDays(bundle.dailyReports, bundle.sales), [bundle.dailyReports, bundle.sales]);
  const [editDate, setEditDate] = useState(todayLocal());
  const [openDay, setOpenDay] = useState<string | null>(null);

  const now = new Date();
  const today = todayLocal();
  const ranges: { label: string; from: string }[] = [
    { label: "This week", from: format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd") },
    { label: "This month", from: format(startOfMonth(now), "yyyy-MM-dd") },
    { label: "Last 30 days", from: format(subDays(now, 29), "yyyy-MM-dd") },
  ];

  return (
    <div className="page production">
      <section className="panel">
        <header className="panel-head">
          <h2>Production Office</h2>
        </header>
        <p className="muted">
          Sales are applications submitted. Issue Paid (IP) is recorded exactly as you report it, in {currency}. It isn't annualized, and it isn't a bank
          balance.
        </p>
        <div className="summary-grid">
          {ranges.map((r) => (
            <SummaryCard key={r.label} label={r.label} s={summarize(days, r.from, today)} currency={currency} />
          ))}
        </div>
      </section>

      <div className="two-col">
        <ReportForm key={editDate + bundle.dailyReports.length} date={editDate} onDate={setEditDate} />
        <SaleForm key={`sale-${bundle.sales.length}`} />
      </div>

      <section className="panel">
        <header className="panel-head">
          <h2>Days</h2>
        </header>
        {days.length === 0 ? (
          <p className="muted">No reports yet. File today's numbers above.</p>
        ) : (
          <div className="table-wrap">
            <table className="days">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="num">Calls</th>
                  <th className="num">Hours</th>
                  <th className="num">Sales</th>
                  <th className="num">Issue Paid</th>
                  <th className="num">Itemized</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <DayRow key={d.date} d={d} currency={currency} open={openDay === d.date} onToggle={() => setOpenDay(openDay === d.date ? null : d.date)} onEdit={() => setEditDate(d.date)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryCard({ label, s, currency }: { label: string; s: ProductionSummary; currency: string }) {
  return (
    <div className="summary-card">
      <div className="eyebrow">{label}</div>
      <div className="stat-row">
        <div>
          <b>{s.calls}</b>
          <span>calls</span>
        </div>
        <div>
          <b>{fmtRate(s.hours, 1)}</b>
          <span>hours</span>
        </div>
        <div>
          <b>{s.applications}</b>
          <span>sales</span>
        </div>
      </div>
      <div className="ip">
        {s.issuePaid === 0 && s.issuePaidIncomplete ? "—" : fmtMoney(s.issuePaid, currency)}{" "}
        <span className="muted">Issue Paid{s.issuePaidIncomplete ? " (some days not entered)" : ""}</span>
      </div>
      <div className="muted rates">
        {fmtRate(s.callsPerHour)} calls/h · {fmtRate(s.salesPerHour, 2)} sales/h · {fmtPercent(s.closingRate, 1)} close
      </div>
    </div>
  );
}

function ReportForm({ date, onDate }: { date: string; onDate(d: string): void }) {
  const { service, currentId, run } = useApp();
  const { bundle } = useView();
  const existing = bundle.dailyReports.find((r) => r.date === date);
  const [form, setForm] = useState(() => ({
    calls: existing ? String(existing.calls) : "",
    hours: existing ? String(existing.hours) : "",
    apps: existing ? String(existing.applicationsSubmitted) : "",
    ip: existing?.issuePaid != null ? String(existing.issuePaid) : "",
    notes: existing?.notes ?? "",
  }));
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <form
      className="panel report-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!currentId) return;
        await run(
          existing ? `Report for ${date} updated` : `Report for ${date} filed`,
          () =>
            service.saveDailyReport(currentId, {
              date,
              calls: num(form.calls),
              hours: num(form.hours),
              applicationsSubmitted: num(form.apps),
              issuePaid: form.ip.trim() === "" ? null : Number(form.ip),
              notes: form.notes,
            }),
          (r) => r,
        );
      }}
    >
      <header className="panel-head">
        <h2>{existing ? "Update daily report" : "Daily report"}</h2>
      </header>
      <label className="field">
        <span>Date</span>
        <input type="date" value={date} max={todayLocal()} onChange={(e) => onDate(e.target.value)} required />
      </label>
      <div className="field-grid">
        <label className="field">
          <span>Calls</span>
          <input type="number" min={0} step={1} value={form.calls} onChange={set("calls")} required />
        </label>
        <label className="field">
          <span>Hours worked</span>
          <input type="number" min={0} max={24} step="any" value={form.hours} onChange={set("hours")} required />
        </label>
        <label className="field">
          <span>Sales (apps submitted)</span>
          <input type="number" min={0} step={1} value={form.apps} onChange={set("apps")} required />
        </label>
        <label className="field">
          <span>
            Issue Paid <em className="optional">optional</em>
          </span>
          <input type="number" min={0} step="0.01" value={form.ip} onChange={set("ip")} placeholder="add later if unknown" />
        </label>
      </div>
      <label className="field">
        <span>
          Notes <em className="optional">optional</em>
        </span>
        <textarea rows={2} value={form.notes} onChange={set("notes")} />
      </label>
      <p className="muted small">Hours earn XP (Speed, Tonality, Objections, Small Talk). Changing calls, sales or IP later never changes XP.</p>
      <div className="row">
        <span className="spacer" />
        <button className="btn primary">{existing ? "Update report" : "File report"}</button>
      </div>
    </form>
  );
}

function SaleForm({ sale, onDone }: { sale?: SaleRow; onDone?: () => void }) {
  const { service, currentId, run } = useApp();
  const { bundle } = useView();
  const [form, setForm] = useState(() => ({
    submittedAt: toInputDateTime(sale?.submittedAt ?? nowLocal()),
    carrierId: sale?.carrierId ?? "",
    product: sale?.product ?? "",
    ip: sale?.issuePaid != null ? String(sale.issuePaid) : "",
    policyRef: sale?.policyRef ?? "",
    notes: sale?.notes ?? "",
  }));
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <form
      className={sale ? "sale-form inline" : "panel sale-form"}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!currentId) return;
        const input = {
          submittedAt: form.submittedAt,
          carrierId: form.carrierId || null,
          product: form.product,
          issuePaid: form.ip.trim() === "" ? null : Number(form.ip),
          policyRef: form.policyRef,
          notes: form.notes,
        };
        const saved = await run(sale ? "Sale updated" : "Sale itemized", () => service.saveSale(currentId, sale ? { ...input, id: sale.id } : input));
        if (saved) onDone?.();
      }}
    >
      {!sale && (
        <header className="panel-head">
          <h2>Itemize a sale</h2>
        </header>
      )}
      {!sale && <p className="muted small">Optional. Daily totals work without itemized sales; itemize when you need a record (e.g. for Speed achievements).</p>}
      <div className="field-grid">
        <label className="field">
          <span>Application submitted</span>
          <input type="datetime-local" value={form.submittedAt} max={toInputDateTime(nowLocal())} onChange={set("submittedAt")} required />
        </label>
        <label className="field">
          <span>
            Carrier <em className="optional">optional</em>
          </span>
          <select value={form.carrierId} onChange={set("carrierId")}>
            <option value="">—</option>
            {bundle.carriers.filter((c) => !c.archived || c.key === form.carrierId).map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>
            Product <em className="optional">optional</em>
          </span>
          <input value={form.product} onChange={set("product")} />
        </label>
        <label className="field">
          <span>
            Issue Paid <em className="optional">optional</em>
          </span>
          <input type="number" min={0} step="0.01" value={form.ip} onChange={set("ip")} />
        </label>
        <label className="field">
          <span>
            Policy reference <em className="optional">private</em>
          </span>
          <input value={form.policyRef} onChange={set("policyRef")} />
        </label>
      </div>
      <div className="row">
        <span className="spacer" />
        {onDone && (
          <button type="button" className="btn ghost small" onClick={onDone}>
            Cancel
          </button>
        )}
        <button className={sale ? "btn primary small" : "btn primary"}>{sale ? "Save sale" : "Add sale"}</button>
      </div>
    </form>
  );
}

function DayRow({ d, currency, open, onToggle, onEdit }: { d: DayProduction; currency: string; open: boolean; onToggle(): void; onEdit(): void }) {
  const { service, currentId, run } = useApp();
  const { bundle } = useView();
  const [editingSale, setEditingSale] = useState<string | null>(null);
  const s = STATUS[d.status];
  return (
    <>
      <tr className={d.status === "conflict" ? "conflict" : ""}>
        <td>
          <button className="link-btn" onClick={onToggle} aria-expanded={open}>
            {fmtDate(d.date)}
          </button>
        </td>
        <td className="num">{d.calls ?? "—"}</td>
        <td className="num">{d.hours ?? "—"}</td>
        <td className="num">{d.applications}</td>
        <td className="num">
          {d.issuePaid !== null ? fmtMoney(d.issuePaid, currency) : "—"}
          {d.report && d.report.issuePaid === null && d.itemizedIssuePaid !== null && (
            <div className="muted small">{fmtMoney(d.itemizedIssuePaid, currency)} itemized</div>
          )}
        </td>
        <td className="num">{d.itemizedCount}</td>
        <td>
          <span className={`badge ${s.cls}`}>{s.label}</span>
        </td>
        <td className="actions">
          {d.report && (
            <button className="btn ghost small" onClick={onEdit}>
              Edit
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="day-detail">
          <td colSpan={8}>
            {d.issues.map((i) => (
              <p key={i} className="warn-text">
                {i}
              </p>
            ))}
            {d.report?.notes && <p className="muted">Notes: {d.report.notes}</p>}
            {d.sales.length === 0 ? (
              <p className="muted">No itemized sales for this day.</p>
            ) : (
              <ul className="sale-list">
                {d.sales.map((sale) =>
                  editingSale === sale.id ? (
                    <li key={sale.id}>
                      <SaleForm sale={sale} onDone={() => setEditingSale(null)} />
                    </li>
                  ) : (
                    <li key={sale.id} className="row">
                      <span>{sale.submittedAt.slice(11, 16)}</span>
                      <span>{sale.carrierId ? (bundle.carriers.find((c) => c.key === sale.carrierId)?.label ?? sale.carrierId) : "—"}</span>
                      <span className="muted">{sale.product}</span>
                      <span>{sale.issuePaid !== null ? fmtMoney(sale.issuePaid, currency) : "IP not entered"}</span>
                      <span className="spacer" />
                      <button className="btn ghost small" onClick={() => setEditingSale(sale.id)}>
                        Edit
                      </button>
                      {currentId && <ConfirmButton label="Delete" confirmLabel="Delete sale" onConfirm={() => run("Sale deleted", () => service.deleteSale(currentId, sale.id))} />}
                    </li>
                  ),
                )}
              </ul>
            )}
            {d.report && currentId && <DeleteReport report={d.report} instanceId={currentId} />}
          </td>
        </tr>
      )}
    </>
  );
}

function DeleteReport({ report, instanceId }: { report: DailyReportRow; instanceId: string }) {
  const { service, run } = useApp();
  return (
    <div className="row">
      <span className="spacer" />
      <ConfirmButton
        label="Delete report"
        confirmLabel="Delete report and its hours XP"
        onConfirm={() => run(`Report for ${report.date} deleted`, () => service.deleteDailyReport(instanceId, report.id), (r) => r)}
      />
    </div>
  );
}

function num(v: string): number {
  return v.trim() === "" ? NaN : Number(v);
}
