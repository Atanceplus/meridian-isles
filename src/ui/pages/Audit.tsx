import { useState } from "react";
import { useView } from "../app/context";
import { fmtDateTime } from "../format";

const PAGE = 100;

/** The audit log: every change to this map, who made it (you or a source), and what changed. */
export function Audit() {
  const { bundle } = useView();
  const [actor, setActor] = useState("all");
  const [area, setArea] = useState("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);

  const actorName = (a: string) => (a === "user" ? "You" : (bundle.integrationSources.find((s) => s.id === a)?.name ?? "Integration"));
  const areas = [...new Set(bundle.audit.map((a) => a.action.split(".")[0]!))].sort();
  const rows = bundle.audit
    .filter((a) => actor === "all" || (actor === "user" ? a.actor === "user" : a.actor !== "user"))
    .filter((a) => area === "all" || a.action.startsWith(`${area}.`))
    .filter((a) => !query.trim() || `${a.summary} ${a.action}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return (
    <div className="page audit">
      <section className="panel">
        <header className="panel-head">
          <h2>Audit log</h2>
          <span className="muted">{bundle.audit.length} entries for this map. Entries are never edited or removed.</span>
        </header>
        <div className="row">
          <select value={actor} onChange={(e) => setActor(e.target.value)} aria-label="Filter by who">
            <option value="all">Everyone</option>
            <option value="user">You</option>
            <option value="sources">Integrations</option>
          </select>
          <select value={area} onChange={(e) => setArea(e.target.value)} aria-label="Filter by area">
            <option value="all">All areas</option>
            {areas.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search the audit log" />
          <span className="muted small">{rows.length} shown</span>
        </div>
        <div className="table-wrap">
          <table className="compact audit-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>What</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((a) => (
                <tr key={a.id} onClick={() => (a.before !== undefined || a.after !== undefined) && setOpen(open === a.id ? null : a.id)} className={a.before !== undefined || a.after !== undefined ? "clickable" : ""}>
                  <td className="nowrap">{fmtDateTime(a.at)}</td>
                  <td>{actorName(a.actor)}</td>
                  <td>
                    <code className="small">{a.action}</code>
                  </td>
                  <td>
                    {a.summary}
                    {open === a.id && (
                      <div className="audit-detail">
                        {a.before !== undefined && (
                          <details open>
                            <summary>Before</summary>
                            <pre>{JSON.stringify(a.before, null, 2)}</pre>
                          </details>
                        )}
                        {a.after !== undefined && (
                          <details open>
                            <summary>After</summary>
                            <pre>{JSON.stringify(a.after, null, 2)}</pre>
                          </details>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > limit && (
          <button className="btn ghost small" onClick={() => setLimit(limit + PAGE)}>
            Show more
          </button>
        )}
      </section>
    </div>
  );
}
