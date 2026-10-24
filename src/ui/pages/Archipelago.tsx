import { Fragment, useMemo, useState } from "react";
import type { CategoryLevelDef } from "../../content/schema";
import type { CarrierRow, ChecklistItem, ProductRow, ResourceRef } from "../../persistence/types";
import { daysBetween } from "../../domain";
import { todayLocal } from "../../records/clock";
import { STUDY_TYPE, SUMMARY_MIN_CHARS, atlasComplete, buildCurriculumView, type CarrierView, type CategoryView, type CurriculumView } from "../../records/curriculum";
import { useApp, useView } from "../app/context";
import { ConfirmButton } from "../components/Modal";
import { QuickLog, type QuickLogStart } from "../components/QuickLog";
import { fmtDate, fmtXp } from "../format";

/**
 * Carrier Archipelago: your own research on each carrier and product. The app
 * ships carrier names only; every detail here is yours to enter and verify.
 */
export function Archipelago() {
  const { registry } = useApp();
  const { bundle } = useView();
  const today = todayLocal();
  const view = useMemo(() => buildCurriculumView(bundle, registry, today), [bundle, registry, today]);
  const [tab, setTab] = useState<"strongholds" | "atlas">("strongholds");
  const [openCarrier, setOpenCarrier] = useState<string | null>(null);
  const [logStart, setLogStart] = useState<QuickLogStart | null>(null);

  const selected = view.carriers.find((c) => c.carrier.key === openCarrier);

  return (
    <div className="page archipelago">
      <header className="island-head island-carrier-archipelago">
        <div>
          <div className="eyebrow">Carrier Archipelago</div>
          <h1>Lift the fog from every stronghold</h1>
          <p className="muted">
            A carrier is only as charted as its weakest category, across its carrier-wide knowledge and every active product. Nothing is pre-filled: products
            and details start empty until you enter and verify them.
          </p>
        </div>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "strongholds"} className={tab === "strongholds" ? "on" : ""} onClick={() => setTab("strongholds")}>
            Strongholds
          </button>
          <button role="tab" aria-selected={tab === "atlas"} className={tab === "atlas" ? "on" : ""} onClick={() => setTab("atlas")}>
            Comparison Atlas
          </button>
        </div>
      </header>

      {tab === "atlas" ? (
        <Atlas view={view} />
      ) : selected ? (
        <CarrierDetail cv={selected} levels={view.levels} onBack={() => setOpenCarrier(null)} onLog={setLogStart} />
      ) : (
        <Strongholds view={view} onOpen={setOpenCarrier} />
      )}

      {logStart && <QuickLog start={logStart} onClose={() => setLogStart(null)} />}
    </div>
  );
}

function levelName(levels: CategoryLevelDef[], i: number): string {
  return levels[i]?.name ?? "—";
}

function LevelBadge({ levels, level, peak }: { levels: CategoryLevelDef[]; level: number; peak: number }) {
  return (
    <span className={`badge lvl-${level}`} title={peak > level ? `Reached ${levelName(levels, peak)}; review to restore` : undefined}>
      {levelName(levels, level)}
      {peak > level && ` · review due (${levelName(levels, peak)})`}
    </span>
  );
}

// ---------- Strongholds ----------

function Strongholds({ view, onOpen }: { view: CurriculumView; onOpen(key: string): void }) {
  const [showArchived, setShowArchived] = useState(false);
  const carriers = view.carriers.filter((c) => showArchived || !c.carrier.archived);
  const active = view.carriers.filter((c) => !c.carrier.archived);
  return (
    <>
      <section className="panel">
        <div className="row">
          <span>
            <strong>{active.filter(atlasComplete).length}</strong> of {active.length} carriers have a complete Atlas column ·{" "}
            <strong>{active.filter((c) => c.level >= 2).length}</strong> charted or better
          </span>
          <span className="spacer" />
          <label className="tick muted">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
          </label>
        </div>
      </section>
      <div className="stronghold-grid">
        {carriers.map((cv) => (
          <button key={cv.carrier.key} className={`stronghold panel fog-${cv.peak}`} onClick={() => onOpen(cv.carrier.key)}>
            <div className="row">
              <strong>{cv.carrier.label}</strong>
              <span className="spacer" />
              {cv.carrier.archived && <span className="badge">Archived</span>}
            </div>
            <LevelBadge levels={view.levels} level={cv.level} peak={cv.peak} />
            <div className="muted small">
              {cv.carrier.kind === "unspecified" ? "Role not set" : cv.carrier.kind} · {cv.products.filter((p) => !p.product.archived).length} products
            </div>
            <div className="cat-dots" aria-label="Category levels">
              {[...cv.categories, ...cv.products.filter((p) => !p.product.archived).flatMap((p) => p.categories)]
                .filter((c) => c.evidence.applicable)
                .map((c, i) => (
                  <span key={i} className={`dot lvl-${c.level}`} title={`${c.def.name}: ${levelName(view.levels, c.level)}`} />
                ))}
            </div>
            {cv.needsProduct && <div className="warn-text small">Add a product to chart this carrier.</div>}
          </button>
        ))}
      </div>
      <NewCarrier />
    </>
  );
}

const KINDS: CarrierRow["kind"][] = ["unspecified", "carrier", "platform", "distributor", "other"];

function NewCarrier() {
  const { service, currentId, run } = useApp();
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<CarrierRow["kind"]>("unspecified");
  return (
    <form
      className="panel row"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!currentId) return;
        if (await run("Carrier added", () => service.curriculum.saveCarrier(currentId, { label, kind }))) setLabel("");
      }}
    >
      <strong>Add a carrier or platform</strong>
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name" aria-label="Carrier name" required maxLength={80} />
      <select value={kind} onChange={(e) => setKind(e.target.value as CarrierRow["kind"])} aria-label="Kind">
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {k === "unspecified" ? "Role not set" : k}
          </option>
        ))}
      </select>
      <button className="btn">Add</button>
    </form>
  );
}

// ---------- Carrier detail ----------

function CarrierDetail({ cv, levels, onBack, onLog }: { cv: CarrierView; levels: CategoryLevelDef[]; onBack(): void; onLog(s: QuickLogStart): void }) {
  const [openProduct, setOpenProduct] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  return (
    <div className="page">
      <button className="link-btn" onClick={onBack}>
        ← All strongholds
      </button>
      <CarrierEditor carrier={cv.carrier} level={<LevelBadge levels={levels} level={cv.level} peak={cv.peak} />} />

      <section className="panel">
        <header className="panel-head">
          <h2>Carrier-wide knowledge</h2>
          <span className="muted">Background, processes and compensation that apply across {cv.carrier.label}.</span>
        </header>
        <div className="category-list">
          {cv.categories.map((c) => (
            <CategoryCard key={c.def.id} cv={c} levels={levels} onLog={onLog} />
          ))}
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Products</h2>
          <span className="spacer" />
          <label className="tick muted">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
          </label>
        </header>
        {cv.products.length === 0 && <p className="muted">No products yet. Add the ones you sell or are studying.</p>}
        <ul className="product-list">
          {cv.products
            .filter((p) => showArchived || !p.product.archived)
            .map((p) => (
              <li key={p.product.key}>
                <div className="row">
                  <button className="link-btn" onClick={() => setOpenProduct(openProduct === p.product.key ? null : p.product.key)} aria-expanded={openProduct === p.product.key}>
                    <strong>{p.product.name}</strong>
                  </button>
                  <LevelBadge levels={levels} level={p.level} peak={p.peak} />
                  <ProductStatus product={p.product} />
                  {p.product.archived && <span className="badge">Archived</span>}
                </div>
                {openProduct === p.product.key && (
                  <div className="product-detail">
                    <ProductEditor product={p.product} />
                    <div className="category-list">
                      {p.categories.map((c) => (
                        <CategoryCard key={c.def.id} cv={c} levels={levels} onLog={onLog} />
                      ))}
                    </div>
                  </div>
                )}
              </li>
            ))}
        </ul>
        <NewProduct carrierKey={cv.carrier.key} />
      </section>
    </div>
  );
}

function CarrierEditor({ carrier, level }: { carrier: CarrierRow; level: React.ReactNode }) {
  const { service, currentId, run } = useApp();
  const [form, setForm] = useState({ label: carrier.label, kind: carrier.kind, notes: carrier.notes });
  const dirty = form.label !== carrier.label || form.kind !== carrier.kind || form.notes !== carrier.notes;
  const save = (archived = carrier.archived) =>
    currentId && run(archived !== carrier.archived ? (archived ? "Carrier archived" : "Carrier restored") : "Carrier saved", () =>
      service.curriculum.saveCarrier(currentId, { key: carrier.key, ...form, archived }),
    );
  return (
    <section className="panel">
      <div className="row">
        <h2>{carrier.label}</h2>
        {level}
        <span className="spacer" />
        <button className="btn ghost small" onClick={() => save(!carrier.archived)}>
          {carrier.archived ? "Restore" : "Archive"}
        </button>
      </div>
      <div className="field-grid">
        <label className="field">
          <span>Name</span>
          <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} maxLength={80} />
        </label>
        <label className="field">
          <span>Role</span>
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as CarrierRow["kind"] })}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k === "unspecified" ? "Not set" : k}
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
      {dirty && (
        <div className="row">
          <span className="spacer" />
          <button className="btn primary small" onClick={() => save()}>
            Save carrier
          </button>
        </div>
      )}
    </section>
  );
}

function ProductStatus({ product }: { product: ProductRow }) {
  if (product.status === "verified") return <span className="badge s-awarded">Verified {product.verifiedOn ? fmtDate(product.verifiedOn) : ""}</span>;
  if (product.status === "draft") return <span className="badge s-reduced">Draft</span>;
  return <span className="badge">Not yet entered</span>;
}

function ProductEditor({ product }: { product: ProductRow }) {
  const { service, currentId, run } = useApp();
  const [form, setForm] = useState({ name: product.name, details: product.details, notes: product.notes });
  const dirty = form.name !== product.name || form.details !== product.details || form.notes !== product.notes;
  if (!currentId) return null;
  const save = (archived = product.archived) =>
    run("Product saved", () => service.curriculum.saveProduct(currentId, { key: product.key, carrierKey: product.carrierKey, ...form, archived }));
  return (
    <div className="product-editor">
      <div className="field-grid">
        <label className="field">
          <span>Name</span>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} />
        </label>
      </div>
      <label className="field">
        <span>Details (your own, from sources you trust)</span>
        <textarea rows={3} value={form.details} placeholder="Not yet entered" onChange={(e) => setForm({ ...form, details: e.target.value })} />
        {product.status === "verified" && <small className="muted">Changing the details will mark them unverified until you check them again.</small>}
      </label>
      <label className="field">
        <span>
          Notes <em className="optional">optional</em>
        </span>
        <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </label>
      <div className="row">
        {product.status !== "verified" ? (
          <button className="btn ghost small" disabled={dirty || !product.details.trim()} onClick={() => run("Product verified", () => service.curriculum.verifyProduct(currentId, product.key, true))}>
            I verified these details today
          </button>
        ) : (
          <button className="btn ghost small" onClick={() => run("Verification withdrawn", () => service.curriculum.verifyProduct(currentId, product.key, false))}>
            Withdraw verification
          </button>
        )}
        <button className="btn ghost small" onClick={() => save(!product.archived)}>
          {product.archived ? "Restore" : "Archive"}
        </button>
        <span className="spacer" />
        {dirty && (
          <button className="btn primary small" onClick={() => save()}>
            Save product
          </button>
        )}
      </div>
    </div>
  );
}

function NewProduct({ carrierKey }: { carrierKey: string }) {
  const { service, currentId, run } = useApp();
  const [name, setName] = useState("");
  return (
    <form
      className="row new-product"
      onSubmit={async (e) => {
        e.preventDefault();
        if (currentId && (await run("Product added", () => service.curriculum.saveProduct(currentId, { carrierKey, name })))) setName("");
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Product name" aria-label="Product name" required maxLength={80} />
      <button className="btn small">Add product</button>
    </form>
  );
}

// ---------- Category card ----------

function CategoryCard({ cv, levels, onLog }: { cv: CategoryView; levels: CategoryLevelDef[]; onLog(s: QuickLogStart): void }) {
  const { service, currentId, run } = useApp();
  const [open, setOpen] = useState(false);
  const row = cv.row;
  const [form, setForm] = useState(() => ({
    summary: row?.summary ?? "",
    notes: row?.notes ?? "",
    checklist: row?.checklist ?? ([] as ChecklistItem[]),
    resources: row?.resources ?? ([] as ResourceRef[]),
    explainedWithoutNotes: row?.explainedWithoutNotes ?? false,
  }));
  const [newItem, setNewItem] = useState("");
  const e = cv.evidence;
  const next = cv.next;

  if (!e.applicable) {
    return (
      <div className="category-card na">
        <div className="row">
          <strong>{cv.def.name}</strong>
          <span className="badge">Not applicable</span>
          <span className="spacer" />
          {currentId && (
            <button className="btn ghost small" onClick={() => run("Category restored", () => service.curriculum.saveKnowledge(currentId, cv.subject, { applicable: true }))}>
              It applies after all
            </button>
          )}
        </div>
      </div>
    );
  }

  const save = () => currentId && run(`${cv.def.name} saved`, () => service.curriculum.saveKnowledge(currentId, cv.subject, form));

  return (
    <div className={`category-card ${open ? "open" : ""}`}>
      <div className="row">
        <button className="link-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
          <strong>{cv.def.name}</strong>
        </button>
        <LevelBadge levels={levels} level={cv.level} peak={cv.peak} />
        <span className="muted small">{fmtXp(e.creditedMinutes)} min studied</span>
        <span className="spacer" />
        <button
          className="btn ghost small"
          onClick={() =>
            onLog({ typeId: STUDY_TYPE, values: { carrierId: cv.subject.carrierKey, categoryId: cv.def.id, ...(cv.subject.productKey ? { productId: cv.subject.productKey } : {}) } })
          }
        >
          Log study
        </button>
      </div>
      {!open && (row?.summary ? <p className="summary-preview">{row.summary}</p> : <p className="muted small">{cv.def.description}</p>)}

      {open && currentId && (
        <div className="category-body">
          {next && (
            <div className="next-level">
              <div className="eyebrow">Next: {next.name}</div>
              <ul className="checklist small">
                <Req met={e.creditedMinutes >= next.minCreditedMinutes}>
                  {fmtXp(Math.min(e.creditedMinutes, next.minCreditedMinutes))} / {next.minCreditedMinutes} credited study minutes
                </Req>
                {next.requires.summaryWritten && <Req met={e.summaryWritten}>A summary in your own words ({SUMMARY_MIN_CHARS}+ characters)</Req>}
                {next.requires.checklistMinItems !== undefined && (
                  <Req met={e.checklistItems >= next.requires.checklistMinItems}>
                    {e.checklistItems} / {next.requires.checklistMinItems} “I can explain…” checklist items
                  </Req>
                )}
                {next.requires.checklistComplete && <Req met={e.checklistItems > 0 && e.checklistDone === e.checklistItems}>Every checklist item ticked</Req>}
                {next.requires.reviewedWithinDays !== undefined && (
                  <Req met={e.lastReviewedOn !== null && daysBetween(e.lastReviewedOn, todayLocal()) <= next.requires.reviewedWithinDays}>Reviewed within the last {next.requires.reviewedWithinDays} days</Req>
                )}
                {next.requires.explainedWithoutNotes && <Req met={e.explainedWithoutNotes}>Explained it without notes</Req>}
                {next.requires.minResources !== undefined && <Req met={e.resourceCount >= next.requires.minResources}>A resource reference attached</Req>}
              </ul>
            </div>
          )}

          <label className="field">
            <span>Summary in your own words</span>
            <textarea rows={3} value={form.summary} onChange={(ev) => setForm({ ...form, summary: ev.target.value })} placeholder={cv.def.description} />
          </label>

          <fieldset className="field">
            <legend>“I can explain…” checklist</legend>
            {form.checklist.map((item) => (
              <div key={item.id} className="row check-item">
                <input
                  type="checkbox"
                  checked={item.done}
                  aria-label={`Done: ${item.text}`}
                  onChange={(ev) => setForm({ ...form, checklist: form.checklist.map((c) => (c.id === item.id ? { ...c, done: ev.target.checked } : c)) })}
                />
                <input
                  value={item.text}
                  aria-label="Checklist item"
                  onChange={(ev) => setForm({ ...form, checklist: form.checklist.map((c) => (c.id === item.id ? { ...c, text: ev.target.value } : c)) })}
                />
                <button type="button" className="icon-btn" aria-label="Remove item" onClick={() => setForm({ ...form, checklist: form.checklist.filter((c) => c.id !== item.id) })}>
                  ×
                </button>
              </div>
            ))}
            <div className="row">
              <input value={newItem} onChange={(ev) => setNewItem(ev.target.value)} placeholder="I can explain…" aria-label="New checklist item" />
              <button
                type="button"
                className="btn ghost small"
                disabled={!newItem.trim()}
                onClick={() => {
                  setForm({ ...form, checklist: [...form.checklist, { id: crypto.randomUUID(), text: newItem.trim(), done: false }] });
                  setNewItem("");
                }}
              >
                Add
              </button>
            </div>
          </fieldset>

          <fieldset className="field">
            <legend>Resources</legend>
            {form.resources.map((r) => (
              <div key={r.id} className="row">
                <input value={r.label} placeholder="Label" aria-label="Resource label" onChange={(ev) => setForm({ ...form, resources: form.resources.map((x) => (x.id === r.id ? { ...x, label: ev.target.value } : x)) })} />
                <input value={r.url} placeholder="https://…" aria-label="Resource link" onChange={(ev) => setForm({ ...form, resources: form.resources.map((x) => (x.id === r.id ? { ...x, url: ev.target.value } : x)) })} />
                <button type="button" className="icon-btn" aria-label="Remove resource" onClick={() => setForm({ ...form, resources: form.resources.filter((x) => x.id !== r.id) })}>
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="btn ghost small" onClick={() => setForm({ ...form, resources: [...form.resources, { id: crypto.randomUUID(), label: "", url: "" }] })}>
              Add resource
            </button>
          </fieldset>

          <label className="field">
            <span>
              Notes <em className="optional">optional</em>
            </span>
            <textarea rows={2} value={form.notes} onChange={(ev) => setForm({ ...form, notes: ev.target.value })} />
          </label>
          <label className="tick">
            <input type="checkbox" checked={form.explainedWithoutNotes} onChange={(ev) => setForm({ ...form, explainedWithoutNotes: ev.target.checked })} /> I can explain this
            category without notes
          </label>

          <div className="row">
            <span className="muted small">Last reviewed: {e.lastReviewedOn ? fmtDate(e.lastReviewedOn) : "never"}</span>
            <button className="btn ghost small" onClick={() => run(`${cv.def.name} reviewed`, () => service.curriculum.markReviewed(currentId, cv.subject))}>
              Mark reviewed today
            </button>
            {cv.def.canBeNotApplicable && (
              <ConfirmButton
                label="Not applicable"
                confirmLabel="Mark not applicable"
                onConfirm={() => run("Marked not applicable", () => service.curriculum.saveKnowledge(currentId, cv.subject, { applicable: false }))}
              />
            )}
            <span className="spacer" />
            <button className="btn primary small" onClick={save}>
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Req({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <li>
      <span className={`check ${met ? "met" : ""}`}>{met ? "✓" : "○"}</span> {children}
    </li>
  );
}

// ---------- Comparison Atlas ----------

function Atlas({ view }: { view: CurriculumView }) {
  const active = view.carriers.filter((c) => !c.carrier.archived);
  const allProducts = active.flatMap((c) => c.products.filter((p) => !p.product.archived).map((p) => ({ carrier: c.carrier, pv: p })));
  const [mode, setMode] = useState<"carrier" | "product">("carrier");
  const [picked, setPicked] = useState<string[]>(() => active.map((c) => c.products.find((p) => !p.product.archived)?.product.key).filter((k): k is string => !!k).slice(0, 6));
  const columns = allProducts.filter((p) => picked.includes(p.pv.product.key));

  const cell = (c: CategoryView | undefined) =>
    !c ? (
      <td className="muted">—</td>
    ) : !c.evidence.applicable ? (
      <td className="muted">Not applicable</td>
    ) : (
      <td>
        <LevelBadge levels={view.levels} level={c.level} peak={c.peak} />
        <div className={c.row?.summary ? "atlas-text" : "atlas-text muted"}>{c.row?.summary || "Not yet entered"}</div>
      </td>
    );

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Comparison Atlas</h2>
        <span className="muted">Built from your own summaries. Complete columns: {active.filter(atlasComplete).length} of {active.length} carriers.</span>
        <span className="spacer" />
        <div className="tabs small" role="tablist">
          <button role="tab" aria-selected={mode === "carrier"} className={mode === "carrier" ? "on" : ""} onClick={() => setMode("carrier")}>
            Carrier-wide
          </button>
          <button role="tab" aria-selected={mode === "product"} className={mode === "product" ? "on" : ""} onClick={() => setMode("product")}>
            Products
          </button>
        </div>
      </header>

      {mode === "product" && (
        <fieldset className="field multi">
          <legend>Products to compare (up to 6)</legend>
          {allProducts.length === 0 && <span className="muted">Add products in each stronghold first.</span>}
          {allProducts.map(({ carrier, pv }) => (
            <label key={pv.product.key} className="tick">
              <input
                type="checkbox"
                checked={picked.includes(pv.product.key)}
                disabled={!picked.includes(pv.product.key) && picked.length >= 6}
                onChange={(e) => setPicked(e.target.checked ? [...picked, pv.product.key] : picked.filter((k) => k !== pv.product.key))}
              />{" "}
              {carrier.label} · {pv.product.name}
            </label>
          ))}
        </fieldset>
      )}

      <div className="table-wrap">
        <table className="atlas">
          <thead>
            <tr>
              <th>Category</th>
              {mode === "carrier"
                ? active.map((c) => <th key={c.carrier.key}>{c.carrier.label}</th>)
                : columns.map(({ carrier, pv }) => (
                    <th key={pv.product.key}>
                      {pv.product.name}
                      <div className="muted small">{carrier.label}</div>
                    </th>
                  ))}
            </tr>
          </thead>
          <tbody>
            {(mode === "carrier" ? view.carrierCategories : view.productCategories).map((def, row) => (
              <tr key={def.id}>
                <th scope="row">{def.name}</th>
                {mode === "carrier"
                  ? active.map((c) => <Fragment key={c.carrier.key}>{cell(c.categories[row])}</Fragment>)
                  : columns.map(({ pv }) => <Fragment key={pv.product.key}>{cell(pv.categories[row])}</Fragment>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
