import { useState } from "react";
import type { CatalogItem } from "../../content/schema";
import type { OwnedUpgradeRow, UpgradeCategory } from "../../persistence/types";
import { todayLocal } from "../../records/clock";
import type { UpgradeInput } from "../../records/shopCommands";
import { useApp, useView } from "../app/context";
import { ConfirmButton } from "../components/Modal";
import { fmtDate, fmtDateTime, fmtMoney } from "../format";
import { href } from "../routes";

const CATEGORY_LABEL: Record<UpgradeCategory, string> = {
  leads: "Leads",
  crm: "CRM",
  dialer: "Dialers",
  training: "Training",
  equipment: "Equipment",
  service: "Services",
  other: "Other",
};

/**
 * Outfitter's Wharf: what you've bought for the business, recorded after the
 * fact. Purchases decorate HQ; they never grant XP or mastery.
 */
export function Wharf() {
  const { registry } = useApp();
  const { bundle } = useView();
  const [editing, setEditing] = useState<{ item?: CatalogItem; row?: OwnedUpgradeRow } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const currency = bundle.instance.settings.currency;
  const owned = bundle.ownedUpgrades.filter((u) => showArchived || !u.archived).sort((a, b) => (a.purchasedOn < b.purchasedOn ? 1 : -1));
  const spend = new Map<UpgradeCategory, number>();
  for (const u of bundle.ownedUpgrades) if (u.reportedCost !== null) spend.set(u.category, (spend.get(u.category) ?? 0) + u.reportedCost);

  return (
    <div className="page wharf">
      <a className="link-btn" href={href({ page: "hq" })}>
        ← Headquarters
      </a>
      <header className="island-head island-wharf">
        <div>
          <div className="eyebrow">Outfitter's Wharf</div>
          <h1>Your tools of the trade</h1>
          <p className="muted">
            Record what you've bought for the business: leads, a CRM, training, gear. The app never makes payments. Purchases decorate your headquarters, but only
            practice and achievements build mastery.
          </p>
        </div>
      </header>

      <section className="panel">
        <header className="panel-head">
          <h2>Record a purchase</h2>
        </header>
        <div className="type-grid">
          {registry.seeds.catalog.map((c) => (
            <button key={c.id} className="type-card" onClick={() => setEditing({ item: c })}>
              <strong>{c.name}</strong>
              <span>{c.description}</span>
              <span className="weights">
                {c.tracksInventory ? "Tracks remaining · " : ""}
                {c.subscription ? "Subscription" : "One-time"}
              </span>
            </button>
          ))}
          <button className="type-card" onClick={() => setEditing({})}>
            <strong>Something else</strong>
            <span>Anything else you use for the business.</span>
          </button>
        </div>
        {editing && <UpgradeForm item={editing.item} row={editing.row} onDone={() => setEditing(null)} />}
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Inventory</h2>
          <span className="muted">{bundle.ownedUpgrades.filter((u) => !u.archived).length} active</span>
          <span className="spacer" />
          <label className="tick muted">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
          </label>
        </header>
        {owned.length === 0 ? (
          <p className="muted">Nothing recorded yet.</p>
        ) : (
          <ul className="upgrade-list">
            {owned.map((u) => (
              <UpgradeItem key={u.id} u={u} onEdit={() => setEditing({ row: u })} />
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Reported spending</h2>
          <span className="muted">As you recorded it. Not reconciled with any account, and not a measure of progress.</span>
        </header>
        {spend.size === 0 ? (
          <p className="muted">No costs recorded.</p>
        ) : (
          <table className="compact">
            <tbody>
              {[...spend.entries()].map(([cat, total]) => (
                <tr key={cat}>
                  <td>{CATEGORY_LABEL[cat]}</td>
                  <td className="num">{fmtMoney(total, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function UpgradeItem({ u, onEdit }: { u: OwnedUpgradeRow; onEdit(): void }) {
  const { service, currentId, run } = useApp();
  const [amount, setAmount] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  if (!currentId) return null;
  const adjust = (sign: 1 | -1) => {
    const n = Number(amount);
    if (!Number.isInteger(n) || n <= 0) return;
    void run(sign < 0 ? "Inventory used" : "Inventory restocked", () => service.shop.adjustRemaining(currentId, u.id, sign * n)).then((ok) => ok && setAmount(""));
  };
  return (
    <li className={u.archived ? "removed" : ""}>
      <div className="row">
        <strong>{u.name}</strong>
        <span className="badge">{CATEGORY_LABEL[u.category]}</span>
        {u.subscription && (
          <span className={`badge ${u.subscription.status === "active" ? "s-awarded" : ""}`}>
            {u.subscription.status} · {u.subscription.cadence}
            {u.subscription.renewsOn ? ` · renews ${fmtDate(u.subscription.renewsOn)}` : ""}
          </span>
        )}
        <span className="spacer" />
        <span className="muted small">
          Bought {fmtDate(u.purchasedOn)}
          {u.reportedCost !== null ? ` · ${fmtMoney(u.reportedCost, u.currency)}` : ""}
        </span>
      </div>
      {(u.description || u.capabilities) && (
        <p className="muted small">
          {u.description}
          {u.description && u.capabilities ? " · " : ""}
          {u.capabilities}
        </p>
      )}
      {u.remaining !== null && (
        <div className="row">
          <span>
            <strong>{u.remaining}</strong> of {u.quantity} remaining
          </span>
          <span className="mini-bar wide">
            <span style={{ width: `${u.quantity ? (u.remaining / u.quantity) * 100 : 0}%` }} />
          </span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="#" aria-label={`Amount for ${u.name}`} style={{ width: "4.5rem" }} />
          <button className="btn ghost small" onClick={() => adjust(-1)}>
            Use
          </button>
          <button className="btn ghost small" onClick={() => adjust(1)}>
            Restock
          </button>
        </div>
      )}
      {u.notes && <p className="small">{u.notes}</p>}
      <div className="row">
        <button className="btn ghost small" onClick={onEdit}>
          Edit
        </button>
        <button className="link-btn small" onClick={() => setShowHistory(!showHistory)} aria-expanded={showHistory}>
          History ({u.history.length})
        </button>
        <span className="spacer" />
        {u.archived ? (
          <button className="btn ghost small" onClick={() => run("Restored", () => service.shop.setArchived(currentId, u.id, false))}>
            Restore
          </button>
        ) : (
          <ConfirmButton label="Archive" confirmLabel="Archive (keeps its record)" onConfirm={() => run("Archived", () => service.shop.setArchived(currentId, u.id, true))} />
        )}
      </div>
      {showHistory && (
        <ul className="history small">
          {u.history.map((h, i) => (
            <li key={i}>
              <span className="muted">{fmtDateTime(h.at)}</span> {h.text}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function UpgradeForm({ item, row, onDone }: { item?: CatalogItem; row?: OwnedUpgradeRow; onDone(): void }) {
  const { service, currentId, run } = useApp();
  const sub = row?.subscription ?? (item?.subscription ? { status: "active" as const, cadence: "monthly" as const, renewsOn: null } : null);
  const [form, setForm] = useState({
    category: (row?.category ?? item?.category ?? "other") as UpgradeCategory,
    name: row?.name ?? "",
    description: row?.description ?? "",
    capabilities: row?.capabilities ?? item?.capabilities ?? "",
    purchasedOn: row?.purchasedOn ?? todayLocal(),
    cost: row?.reportedCost != null ? String(row.reportedCost) : "",
    quantity: row?.quantity != null ? String(row.quantity) : "",
    tracks: row ? row.quantity !== null : (item?.tracksInventory ?? false),
    isSub: sub !== null,
    status: sub?.status ?? "active",
    cadence: sub?.cadence ?? "monthly",
    renewsOn: sub?.renewsOn ?? "",
    notes: row?.notes ?? "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  if (!currentId) return null;

  return (
    <form
      className="inline-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const input: UpgradeInput = {
          ...(row ? { id: row.id } : {}),
          catalogId: row?.catalogId ?? item?.id ?? null,
          category: form.category,
          name: form.name,
          description: form.description,
          capabilities: form.capabilities,
          purchasedOn: form.purchasedOn,
          reportedCost: form.cost.trim() === "" ? null : Number(form.cost),
          quantity: form.tracks && form.quantity.trim() !== "" ? Number(form.quantity) : null,
          subscription: form.isSub ? { status: form.status as "active", cadence: form.cadence as "monthly", renewsOn: form.renewsOn || null } : null,
          notes: form.notes,
        };
        if (await run(row ? "Upgrade updated" : "Purchase recorded", () => service.shop.saveUpgrade(currentId, input))) onDone();
      }}
    >
      <h3>{row ? `Edit ${row.name}` : item ? `Record: ${item.name}` : "Record a purchase"}</h3>
      <div className="field-grid">
        <label className="field">
          <span>Name</span>
          <input value={form.name} onChange={set("name")} required maxLength={120} placeholder={item?.name} />
        </label>
        <label className="field">
          <span>Category</span>
          <select value={form.category} onChange={set("category")}>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Purchased</span>
          <input type="date" value={form.purchasedOn} max={todayLocal()} onChange={set("purchasedOn")} required />
        </label>
        <label className="field">
          <span>
            Cost, as you'd report it <em className="optional">optional</em>
          </span>
          <input type="number" min={0} step="0.01" value={form.cost} onChange={set("cost")} />
        </label>
      </div>
      <label className="field">
        <span>
          What it is <em className="optional">optional</em>
        </span>
        <input value={form.description} onChange={set("description")} />
      </label>
      <label className="field">
        <span>
          What it can do <em className="optional">optional</em>
        </span>
        <input value={form.capabilities} onChange={set("capabilities")} />
      </label>
      <div className="row">
        <label className="tick">
          <input type="checkbox" checked={form.tracks} onChange={(e) => setForm({ ...form, tracks: e.target.checked })} /> Track quantity remaining
        </label>
        {form.tracks && <input type="number" min={0} step={1} value={form.quantity} onChange={set("quantity")} placeholder="Quantity" aria-label="Quantity" style={{ width: "7rem" }} />}
      </div>
      <div className="row">
        <label className="tick">
          <input type="checkbox" checked={form.isSub} onChange={(e) => setForm({ ...form, isSub: e.target.checked })} /> Subscription
        </label>
        {form.isSub && (
          <>
            <select value={form.status} onChange={set("status")} aria-label="Subscription status">
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select value={form.cadence} onChange={set("cadence")} aria-label="Billing cadence">
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
              <option value="other">Other</option>
            </select>
            <label className="small">
              Renews <input type="date" value={form.renewsOn} onChange={set("renewsOn")} />
            </label>
          </>
        )}
      </div>
      <label className="field">
        <span>
          Notes on how you use it <em className="optional">optional</em>
        </span>
        <textarea rows={2} value={form.notes} onChange={set("notes")} />
      </label>
      <div className="row">
        <span className="spacer" />
        <button type="button" className="btn ghost small" onClick={onDone}>
          Cancel
        </button>
        <button className="btn primary small">{row ? "Save" : "Record purchase"}</button>
      </div>
    </form>
  );
}
