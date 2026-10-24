import { useState } from "react";
import { buildPersonalSave, saveFileName } from "../../persistence/exportSave";
import { ImportError, parseSaveFile, type ParsedFile } from "../../persistence/importSave";
import type { InstanceRow } from "../../persistence/types";
import type { ImportPreview } from "../../records/archiveCommands";
import { nowLocal } from "../../records/clock";
import { DEFAULT_STARTER_OPTIONS, buildStarter, type StarterOptions } from "../../records/starterMaps";
import { rememberInstance, useApp } from "../app/context";
import { ConfirmButton } from "../components/Modal";
import { fmtDateTime } from "../format";
import { href } from "../routes";

const APP_VERSION = "0.5.0";

/** Offer a JSON file to save. */
function download(obj: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Archive House: maps (instances), backups. Import and starter maps arrive in Phase 5. */
export function Archive() {
  const { instances, currentId } = useApp();
  return (
    <div className="page archive">
      <section className="panel">
        <header className="panel-head">
          <h2>Your maps</h2>
        </header>
        <p className="muted">
          <a href={href({ page: "audit" })}>Audit log for the current map</a>
        </p>
        <p className="muted">
          Each map is a completely independent world with its own progress, reports and history. Maps are stored in this browser only, so export a backup
          regularly.
        </p>
        <ul className="instance-list">
          {instances.map((i) => (
            <InstanceItem key={i.id} instance={i} current={i.id === currentId} />
          ))}
        </ul>
      </section>
      <ImportPanel />
      <NewInstance />
    </div>
  );
}

function InstanceItem({ instance, current }: { instance: InstanceRow; current: boolean }) {
  const { service, storage, selectInstance, run } = useApp();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(instance.name);
  const [deleting, setDeleting] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [starter, setStarter] = useState(false);

  const exportSave = async () => {
    const at = nowLocal();
    const save = await run("Backup exported", () => buildPersonalSave(storage, instance.id, APP_VERSION, at));
    if (save) download(save, saveFileName(instance.name, at));
  };

  return (
    <li className={`instance ${current ? "current" : ""}`}>
      <div className="row">
        {renaming ? (
          <form
            className="row"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await run("Map renamed", () => service.renameInstance(instance.id, name));
              if (ok !== null) setRenaming(false);
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus aria-label="Map name" />
            <button className="btn primary small">Save</button>
            <button type="button" className="btn ghost small" onClick={() => setRenaming(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <>
            <strong>{instance.name}</strong>
            {current && <span className="badge s-awarded">Current</span>}
          </>
        )}
        <span className="spacer" />
        <span className="muted small">Created {fmtDateTime(instance.createdAt)}</span>
      </div>
      <div className="row">
        {!current && (
          <button className="btn small" onClick={() => selectInstance(instance.id)}>
            Switch to this map
          </button>
        )}
        <button className="btn ghost small" onClick={() => setRenaming(true)}>
          Rename
        </button>
        <button className="btn ghost small" onClick={exportSave} title="Everything: your complete personal history">
          Export backup
        </button>
        <button className="btn ghost small" onClick={() => setStarter(!starter)} aria-expanded={starter} title="Curriculum only, to share">
          Export starter map…
        </button>
        <span className="spacer" />
        {!deleting ? (
          <button className="btn ghost small" onClick={() => setDeleting(true)}>
            Delete…
          </button>
        ) : (
          <span className="confirm-inline">
            <input placeholder={`Type “${instance.name}”`} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} aria-label="Confirm map name" />
            <ConfirmButton
              label="Delete forever"
              confirmLabel="Yes, delete this map"
              onConfirm={() => {
                if (confirmName.trim() !== instance.name) return;
                void run("Map deleted", () => service.deleteInstance(instance.id)).then(() => selectInstance(null));
              }}
            />
            <button className="btn ghost small" onClick={() => setDeleting(false)}>
              Cancel
            </button>
          </span>
        )}
      </div>
      {starter && <StarterExport instance={instance} onDone={() => setStarter(false)} />}
      {deleting && <p className="warn-text small">Deleting removes this map's entire history from this browser. Export a backup first.</p>}
    </li>
  );
}

export function NewInstance({ first }: { first?: boolean }) {
  const { service, run, selectInstance } = useApp();
  const [name, setName] = useState(first ? "My Final Expense journey" : "");
  return (
    <form
      className="panel new-instance"
      onSubmit={async (e) => {
        e.preventDefault();
        const created = await run("Map created", () => service.createInstance(name));
        if (created) {
          rememberInstance(created.id);
          selectInstance(created.id);
          setName("");
        }
      }}
    >
      <header className="panel-head">
        <h2>{first ? "Start your world" : "New map"}</h2>
      </header>
      {first && (
        <p>
          The Meridian Isles track your practice, calls and progress toward mastering Final Expense sales. Everything is self-reported and stays in this
          browser.
        </p>
      )}
      <label className="field">
        <span>Map name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
      </label>
      <div className="row">
        <span className="spacer" />
        <button className="btn primary">{first ? "Begin" : "Create a fresh map"}</button>
      </div>
    </form>
  );
}

const STARTER_OPTIONS: [keyof StarterOptions, string][] = [
  ["includeScript", "My script"],
  ["includeDocketResponses", "My written objection responses"],
  ["includeRapportLibrary", "My Rapport Library"],
  ["includeProductDetails", "Product details I've entered"],
  ["includeNotes", "My personal notes (carriers, products, categories, cases)"],
];

/** A shareable starter: curriculum and settings, never history, progress or purchases. */
function StarterExport({ instance, onDone }: { instance: InstanceRow; onDone(): void }) {
  const { service, run } = useApp();
  const [options, setOptions] = useState<StarterOptions>(DEFAULT_STARTER_OPTIONS);
  const [name, setName] = useState(`${instance.name} starter`.slice(0, 80));
  const [description, setDescription] = useState("");
  return (
    <form
      className="inline-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const at = nowLocal();
        const starter = await run("Starter map exported", async () => buildStarter((await service.load(instance.id)).bundle, options, { name, description, appVersion: APP_VERSION, exportedAt: at }));
        if (!starter) return;
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "starter";
        download(starter, `${slug}.meridian-starter.json`);
        onDone();
      }}
    >
      <p className="muted small">
        A starter map shares your curriculum (carriers, products, category summaries, docket, courses) and settings. It never includes activities, reports, sales,
        achievements, progress, purchases, reviews or verification. Checklists are exported unticked.
      </p>
      <div className="field-grid">
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </label>
        <label className="field">
          <span>
            Description <em className="optional">optional</em>
          </span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
      </div>
      <fieldset className="field">
        <legend>Also include</legend>
        {STARTER_OPTIONS.map(([key, label]) => (
          <label key={key} className="tick">
            <input type="checkbox" checked={options[key]} onChange={(e) => setOptions({ ...options, [key]: e.target.checked })} /> {label}
          </label>
        ))}
      </fieldset>
      <div className="row">
        <span className="spacer" />
        <button type="button" className="btn ghost small" onClick={onDone}>
          Cancel
        </button>
        <button className="btn primary small">Download starter map</button>
      </div>
    </form>
  );
}

/** Import a personal backup or a starter map, with a preview before anything is written. */
function ImportPanel() {
  const { service, instances, run, selectInstance } = useApp();
  const [file, setFile] = useState<ParsedFile | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [replaceId, setReplaceId] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [starterName, setStarterName] = useState("");
  const [result, setResult] = useState<string[] | null>(null);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setErrors([]);
    setReplaceId("");
    setConfirmName("");
  };

  const choose = async (f: File | undefined) => {
    reset();
    setResult(null);
    if (!f) return;
    setFileName(f.name);
    if (f.size > 50 * 1024 * 1024) {
      setErrors(["That file is too large to be a save (over 50 MB)."]);
      return;
    }
    try {
      const parsed = await parseSaveFile(await f.text());
      setFile(parsed);
      setPreview(service.archive.preview(parsed));
      if (parsed.kind === "starter") setStarterName(parsed.starter.name.slice(0, 60));
    } catch (e) {
      setErrors(e instanceof ImportError ? e.errors : [e instanceof Error ? e.message : String(e)]);
    }
  };

  const target = instances.find((i) => i.id === replaceId);
  const replaceConfirmed = !target || confirmName.trim() === target.name;

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Import</h2>
        <span className="muted">A personal backup or a starter map. You'll see what's inside before anything changes.</span>
      </header>
      <input type="file" accept=".json,application/json" aria-label="Choose a save or starter file" onChange={(e) => void choose(e.target.files?.[0])} />
      {errors.length > 0 && (
        <div className="callout warn" role="alert">
          <strong>{fileName} can't be imported.</strong>
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {result && (
        <div className="callout good" role="status">
          Imported.{result.length > 0 && " Notes:"}
          {result.length > 0 && (
            <ul>
              {result.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {file && preview && (
        <div className="import-preview">
          <div className="row">
            <strong>{preview.name}</strong>
            <span className="badge">{preview.kind === "personal" ? "Personal backup" : "Starter map"}</span>
            <span className="muted small">
              Exported {preview.exportedAt.slice(0, 16).replace("T", " ")} · app {preview.appVersion}
            </span>
          </div>
          <dl className="count-grid">
            {preview.counts.map((c) => (
              <div key={c.label}>
                <dt>{c.label}</dt>
                <dd>{c.n}</dd>
              </div>
            ))}
          </dl>
          {preview.firstActivity && (
            <p className="muted small">
              Activity from {preview.firstActivity.slice(0, 10)} to {preview.lastActivity?.slice(0, 10)}
            </p>
          )}
          {preview.ranks.length > 0 && <p className="small">{preview.ranks.map((r) => `${r.skill}: ${r.rank}`).join(" · ")}</p>}
          {preview.warnings.length > 0 && (
            <ul className="warn-text small">
              {preview.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}

          {file.kind === "personal" ? (
            <div className="row">
              <label className="small">
                Import as{" "}
                <select value={replaceId} onChange={(e) => setReplaceId(e.target.value)}>
                  <option value="">A new map (recommended)</option>
                  {instances.map((i) => (
                    <option key={i.id} value={i.id}>
                      Replace “{i.name}”
                    </option>
                  ))}
                </select>
              </label>
              {target && (
                <input placeholder={`Type “${target.name}” to replace it`} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} aria-label="Confirm map to replace" />
              )}
              <span className="spacer" />
              <button className="btn ghost small" onClick={reset}>
                Cancel
              </button>
              <button
                className="btn primary small"
                disabled={!replaceConfirmed}
                onClick={async () => {
                  const out = await run("Map imported", () => service.archive.importPersonal(file.save, replaceId ? { replaceId } : {}));
                  if (!out) return;
                  reset();
                  setResult(out.warnings);
                  selectInstance(out.instance.id);
                }}
              >
                {target ? `Replace “${target.name}”` : "Import as new map"}
              </button>
            </div>
          ) : (
            <div className="row">
              <label className="small">
                New map name <input value={starterName} onChange={(e) => setStarterName(e.target.value)} maxLength={60} />
              </label>
              <span className="spacer" />
              <button className="btn ghost small" onClick={reset}>
                Cancel
              </button>
              <button
                className="btn primary small"
                onClick={async () => {
                  const created = await run("Map created from starter", () => service.archive.createFromStarter(file.starter, starterName));
                  if (!created) return;
                  reset();
                  setResult([]);
                  selectInstance(created.id);
                }}
              >
                Create map from starter
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
