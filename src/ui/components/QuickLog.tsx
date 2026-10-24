import { useMemo, useState } from "react";
import type { ContentRegistry } from "../../content";
import type { ActivityTypeDef, FieldDef, Tier } from "../../content/schema";
import type { ActivityRow, InstanceBundle } from "../../persistence/types";
import { nowLocal } from "../../records/clock";
import { useApp, useView } from "../app/context";
import { toInputDateTime } from "../format";
import { Modal } from "./Modal";

type Values = Record<string, unknown>;

/**
 * Log any activity from anywhere. Forms are built from the content pack's
 * field definitions. Also used to edit an existing activity.
 */
export interface QuickLogStart {
  typeId: string;
  values?: Values;
}

export function QuickLog({ onClose, islandId, edit, start }: { onClose(): void; islandId?: string; edit?: ActivityRow; start?: QuickLogStart }) {
  const { registry } = useApp();
  const types = registry.activityTypes.filter((t) => t.quickLog && (!islandId || t.islandId === islandId));
  const [typeId, setTypeId] = useState<string | null>(edit?.typeId ?? start?.typeId ?? (types.length === 1 ? types[0]!.id : null));
  const type = typeId ? registry.activityTypeById[typeId] : undefined;

  return (
    <Modal title={edit ? "Edit activity" : type ? type.name : "Log activity"} onClose={onClose}>
      {!type ? (
        <TypePicker registry={registry} types={types} onPick={setTypeId} />
      ) : (
        <ActivityForm type={type} edit={edit} initial={start?.typeId === type.id ? start.values : undefined} onBack={edit || start ? undefined : () => setTypeId(null)} onDone={onClose} />
      )}
    </Modal>
  );
}

function TypePicker({ registry, types, onPick }: { registry: ContentRegistry; types: ActivityTypeDef[]; onPick(id: string): void }) {
  const byIsland = new Map<string, ActivityTypeDef[]>();
  for (const t of types) byIsland.set(t.islandId, [...(byIsland.get(t.islandId) ?? []), t]);
  return (
    <div className="type-picker">
      {[...byIsland.entries()].map(([islandId, list]) => (
        <section key={islandId}>
          <h3>{registry.islandById[islandId]?.name}</h3>
          <div className="type-grid">
            {list.map((t) => (
              <button key={t.id} className="type-card" onClick={() => onPick(t.id)}>
                <strong>{t.name}</strong>
                <span>{t.description}</span>
                <span className="weights">
                  {Object.entries(t.skillWeights)
                    .map(([id, w]) => `${registry.skillById[id]?.name} ${w}%`)
                    .join(" · ")}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
      <p className="muted">Call hours are logged in the Production Office's daily report; script revisions in the Script Foundry (Phase 2).</p>
    </div>
  );
}

function ActivityForm({
  type,
  edit,
  initial,
  onBack,
  onDone,
}: {
  type: ActivityTypeDef;
  edit?: ActivityRow;
  initial?: Values;
  onBack?: () => void;
  onDone(): void;
}) {
  const { registry, service, currentId, run } = useApp();
  const { bundle } = useView();
  const modeKeys = Object.keys(type.modes);
  const [values, setValues] = useState<Values>(() => edit?.values ?? { ...initialValues(type), ...initial });
  const ctx: OptionContext = { registry, bundle, values };
  /** Change a field, clearing any dependent choice that no longer fits (e.g. a product of another carrier). */
  const change = (key: string, v: unknown) =>
    setValues((prev) => {
      const next = { ...prev, [key]: v };
      for (const f of type.fields) {
        if (f.kind !== "select" || f.key === key || typeof next[f.key] !== "string") continue;
        if (!optionsFor(f, { registry, bundle, values: next }).some((o) => o.value === next[f.key])) next[f.key] = undefined;
      }
      return next;
    });
  // Default to the first standard-rate mode, so nothing is quietly logged at a reduced rate.
  const [mode, setMode] = useState<string | undefined>(
    edit?.record.mode ?? modeKeys.find((k) => type.modes[k]!.multiplier === 1) ?? modeKeys[0],
  );
  const [occurredAt, setOccurredAt] = useState(() => toInputDateTime(edit?.occurredAt ?? nowLocal()));
  const [busy, setBusy] = useState(false);
  const limits = useMemo(() => describeLimits(type), [type]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentId || busy) return;
    setBusy(true);
    const opts = mode !== undefined ? { occurredAt, mode } : { occurredAt };
    const result = edit
      ? await run(`Edited ${type.name}`, () => service.editActivity(currentId, edit.id, values, opts), (r) => r)
      : await run(type.name, () => service.logActivity(currentId, type.id, values, opts), (r) => r);
    setBusy(false);
    if (result) onDone();
  };

  return (
    <form className="activity-form" onSubmit={submit}>
      <p className="muted">{type.description}</p>
      <div className="weights">
        Trains{" "}
        {Object.entries(mode ? (type.modes[mode]?.skillWeights ?? type.skillWeights) : type.skillWeights)
          .map(([id, w]) => `${registry.skillById[id]?.name} ${w}%`)
          .join(" · ")}
      </div>

      <label className="field">
        <span>When</span>
        <input type="datetime-local" value={occurredAt} max={toInputDateTime(nowLocal())} onChange={(e) => setOccurredAt(e.target.value)} required />
      </label>

      {modeKeys.length > 0 && (
        <label className="field">
          <span>Mode</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            {modeKeys.map((k) => (
              <option key={k} value={k}>
                {type.modes[k]!.label}
                {type.modes[k]!.multiplier !== 1 ? ` (×${type.modes[k]!.multiplier} XP)` : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      {type.fields.map((f) => (
        <FieldInput key={f.key} field={f} ctx={ctx} value={values[f.key]} onChange={(v) => change(f.key, v)} />
      ))}

      {limits.length > 0 && (
        <ul className="limits muted">
          {limits.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}

      <div className="row">
        {onBack && (
          <button type="button" className="btn ghost" onClick={onBack}>
            ← Other activity
          </button>
        )}
        <span className="spacer" />
        <button className="btn primary" disabled={busy}>
          {edit ? "Save changes" : "Log it"}
        </button>
      </div>
    </form>
  );
}

function FieldInput({ field, ctx, value, onChange }: { field: FieldDef; ctx: OptionContext; value: unknown; onChange(v: unknown): void }) {
  const label = (
    <span>
      {field.label}
      {field.required ? "" : <em className="optional"> optional</em>}
    </span>
  );
  switch (field.kind) {
    case "number":
      return (
        <label className="field">
          {label}
          <input
            type="number"
            step="any"
            min={field.min}
            max={field.max}
            value={typeof value === "number" ? value : ""}
            onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          />
          {field.help && <small className="muted">{field.help}</small>}
        </label>
      );
    case "rating":
      return (
        <fieldset className="field rating">
          <legend>{label}</legend>
          {[1, 2, 3, 4, 5].map((n) => (
            <button type="button" key={n} className={value === n ? "on" : ""} aria-pressed={value === n} onClick={() => onChange(value === n ? undefined : n)}>
              {n}
            </button>
          ))}
        </fieldset>
      );
    case "text":
    case "datetime":
      return (
        <label className="field">
          {label}
          <input type={field.kind === "datetime" ? "datetime-local" : "text"} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />
          {field.help && <small className="muted">{field.help}</small>}
        </label>
      );
    case "longtext": {
      const text = typeof value === "string" ? value : "";
      return (
        <label className="field">
          {label}
          <textarea rows={3} value={text} onChange={(e) => onChange(e.target.value)} />
          {field.minLength && (
            <small className="muted">
              {text.trim().length} / {field.minLength} characters minimum
            </small>
          )}
        </label>
      );
    }
    case "select": {
      const options = optionsFor(field, ctx);
      return (
        <label className="field">
          {label}
          <select value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || undefined)}>
            <option value="">Choose…</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      );
    }
    case "multiselect": {
      const options = optionsFor(field, ctx);
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <fieldset className="field multi">
          <legend>{label}</legend>
          {options.map((o) => (
            <label key={o.value} className="tick">
              <input
                type="checkbox"
                checked={selected.includes(o.value)}
                onChange={(e) => onChange(e.target.checked ? [...selected, o.value] : selected.filter((v) => v !== o.value))}
              />{" "}
              {o.label}
            </label>
          ))}
        </fieldset>
      );
    }
    case "boolean":
      return (
        <label className="tick field-bool">
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} /> {field.label}
        </label>
      );
  }
}

export interface OptionContext {
  registry: ContentRegistry;
  bundle: InstanceBundle;
  values: Values;
}

/** Options for a select field: a fixed list, or your curriculum (carriers, products, docket, script sections). */
export function optionsFor(field: FieldDef, { registry, bundle, values }: OptionContext): { value: string; label: string }[] {
  if (field.options) return field.options.map((o) => ({ value: o, label: o[0]!.toUpperCase() + o.slice(1) }));
  const seeds = registry.seeds;
  switch (field.source) {
    case "carriers":
      return bundle.carriers
        .filter((c) => !c.archived || c.key === values[field.key])
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => ({ value: c.key, label: c.label }));
    case "products":
      return bundle.products
        .filter((p) => p.carrierKey === values.carrierId && (!p.archived || p.key === values[field.key]))
        .map((p) => ({ value: p.key, label: p.name }));
    case "knowledgeCategories": {
      const scope = values.productId ? "product" : undefined;
      return seeds.knowledgeCategories
        .filter((c) => !scope || c.scope === scope)
        .map((c) => ({ value: c.id, label: `${c.name} (${c.scope === "carrier" ? "carrier-wide" : "product"})` }));
    }
    case "objectionCases":
      return bundle.docket
        .filter((c) => !c.archived || c.key === values[field.key])
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => ({ value: c.key, label: c.title }));
    case "courses":
      return bundle.courses.filter((c) => !c.archived || c.key === values[field.key]).map((c) => ({ value: c.key, label: c.name }));
    case "rapportScenarios":
      return seeds.rapportScenarios.map((c) => ({ value: c.id, label: c.label }));
    case "scriptSections": {
      const script = bundle.scripts[0];
      const revision = script && bundle.scriptRevisions.find((r) => r.id === script.currentRevisionId);
      return (revision?.sections ?? seeds.scriptTemplate?.sections ?? []).map((s) => ({ value: s.id, label: s.name }));
    }
    default:
      return [];
  }
}

function initialValues(type: ActivityTypeDef): Values {
  const out: Values = {};
  for (const f of type.fields) if (f.kind === "boolean") out[f.key] = false;
  return out;
}

const SUBJECT_LABEL: Record<string, string> = {
  objectionCase: "per docket case",
  knowledgeCategory: "per category",
  carrier: "per carrier",
  course: "per course",
  scriptSection: "per section",
};

function describeLimits(type: ActivityTypeDef): string[] {
  const unit = type.measure === "count" ? "logs" : type.measure;
  const tier = (t: Tier, period: string) =>
    t.reducedUpTo > t.fullUpTo
      ? `Full credit for the first ${t.fullUpTo} ${unit} ${period}, half up to ${t.reducedUpTo}, then none.`
      : `Credit for up to ${t.fullUpTo} ${unit} ${period}.`;
  const out: string[] = [];
  if (type.limits.daily) out.push(tier(type.limits.daily, "a day"));
  if (type.limits.dailyPerSubject) out.push(tier(type.limits.dailyPerSubject, `${SUBJECT_LABEL[type.subjectKind ?? ""] ?? "per subject"} a day`));
  if (type.limits.weekly) out.push(tier(type.limits.weekly, "a week"));
  return out;
}
