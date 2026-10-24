import { buildRuleset, createInitialState, replayEvents, type ReplayableEvent } from "../domain";
import type { PersonalSave } from "../persistence/exportSave";
import { freshIds, remapIds, type ParsedFile } from "../persistence/importSave";
import type { StarterMap } from "../persistence/starterFormat";
import type { StorageAdapter } from "../persistence/storage";
import { SCHEMA_VERSION, TABLES, type ChangeSet, type InstanceRow } from "../persistence/types";
import type { CommandService } from "./commands";
import { ValidationError } from "./errors";
import { seedRows } from "./seed";
import { starterRows } from "./starterMaps";

/**
 * Bringing maps in. Imports always create a new map first; "replace" then
 * removes the old one, so a failed import never loses anything.
 */

export interface ImportPreview {
  kind: "personal" | "starter";
  name: string;
  exportedAt: string;
  appVersion: string;
  counts: { label: string; n: number }[];
  firstActivity: string | null;
  lastActivity: string | null;
  ranks: { skill: string; rank: string; score: number }[];
  warnings: string[];
}

export class ArchiveCommands {
  constructor(
    private svc: CommandService,
    private storage: StorageAdapter,
  ) {}

  preview(file: ParsedFile): ImportPreview {
    const registry = this.svc.registry;
    const warnings = [...file.warnings];
    const packs = file.kind === "personal" ? file.save.packRefs : file.starter.packRefs;
    for (const ref of packs) {
      const loaded = registry.packs.find((p) => p.id === ref.id);
      if (!loaded) warnings.push(`Made with content pack "${ref.id}", which isn't installed here; its content will be missing.`);
      else if (loaded.version !== ref.version) warnings.push(`Made with ${ref.id} ${ref.version}; this app has ${loaded.version}.`);
    }

    if (file.kind === "starter") {
      const c = file.starter.curriculum;
      return {
        kind: "starter",
        name: file.starter.name,
        exportedAt: file.starter.exportedAt,
        appVersion: file.starter.appVersion,
        counts: [
          { label: "Carriers", n: c.carriers.length },
          { label: "Products", n: c.products.length },
          { label: "Knowledge entries", n: c.knowledge.length },
          { label: "Docket cases", n: c.docket.length },
          { label: "Courses", n: c.courses.length },
          { label: "Rapport cards", n: c.rapportCards.length },
          { label: "Script sections", n: c.script?.sections.length ?? 0 },
        ],
        firstActivity: null,
        lastActivity: null,
        ranks: [],
        warnings,
      };
    }

    const { save } = file;
    const unknownTypes = new Set(save.data.activities.map((a) => a.typeId).filter((t) => !registry.activityTypeById[t]));
    if (unknownTypes.size) warnings.push(`Contains activities this app doesn't know (${[...unknownTypes].join(", ")}); they won't count toward progress.`);
    const times = save.data.activities.map((a) => a.occurredAt).sort();
    const state = save.snapshot?.state;
    return {
      kind: "personal",
      name: save.instance.name,
      exportedAt: save.exportedAt,
      appVersion: save.appVersion,
      counts: [
        { label: "Activities", n: save.data.activities.filter((a) => a.status === "active").length },
        { label: "Daily reports", n: save.data.dailyReports.length },
        { label: "Itemized sales", n: save.data.sales.length },
        { label: "Achievements", n: save.data.achievements.length },
        { label: "Carriers", n: save.data.carriers.length },
        { label: "Products", n: save.data.products.length },
        { label: "Script versions", n: save.data.scriptVersions.length },
        { label: "Docket cases", n: save.data.docket.length },
        { label: "Lightspeed attempts", n: save.data.lightspeedAttempts.length },
        { label: "Owned upgrades", n: save.data.ownedUpgrades.length },
      ],
      firstActivity: times[0] ?? null,
      lastActivity: times[times.length - 1] ?? null,
      ranks: state
        ? registry.skills.map((s) => {
            const p = (state.skills as Record<string, { rank: number; score: number }>)[s.id];
            return { skill: s.name, rank: s.ranks[(p?.rank ?? 1) - 1]!.name, score: p?.score ?? 0 };
          })
        : [],
      warnings,
    };
  }

  /** Import a personal save as a new map (default), or replace an existing one once the import succeeds. */
  async importPersonal(save: PersonalSave, opts: { replaceId?: string } = {}): Promise<{ instance: InstanceRow; warnings: string[] }> {
    const at = this.now();
    const newInstanceId = this.newId();
    const ids = freshIds(save, () => this.newId());
    const remapped = remapIds(save, save.instance.id, newInstanceId, ids);
    const existing = await this.storage.listInstances();
    const target = opts.replaceId ? existing.find((i) => i.id === opts.replaceId) : undefined;
    if (opts.replaceId && !target) throw new ValidationError(["The map to replace no longer exists."]);

    const ruleset = buildRuleset(this.svc.registry, remapped.instance.overrides);
    const warnings: string[] = [];
    const replayable = remapped.data.events.filter((e) => e.event.kind !== "activity" || this.svc.registry.activityTypeById[e.event.record.typeId]);
    let rebuilt = createInitialState(ruleset);
    try {
      rebuilt = replayEvents(replayable as { seq: number; at: string; event: ReplayableEvent }[], ruleset);
    } catch (e) {
      warnings.push(`The event log couldn't be replayed (${e instanceof Error ? e.message : String(e)}); the saved progress snapshot is used as-is.`);
    }
    const snapshotState = remapped.snapshot?.state ?? rebuilt;
    const differs = ruleset.skillOrder.filter((id) => {
      const a = snapshotState.skills[id];
      const b = rebuilt.skills[id];
      return !a || !b || a.rank !== b.rank || Math.abs(a.score - b.score) > 0.01;
    });
    if (remapped.snapshot && differs.length) {
      warnings.push(`The saved progress doesn't match its own event log for ${differs.length} skill(s), so it was rebuilt from the log.`);
    }

    const instance: InstanceRow = {
      ...remapped.instance,
      id: newInstanceId,
      name: target ? target.name : uniqueName(`${save.instance.name} (imported)`, existing),
      schemaVersion: SCHEMA_VERSION,
      updatedAt: at,
    };
    const put: NonNullable<ChangeSet["put"]> = {};
    for (const t of TABLES) (put as Record<string, unknown>)[t] = remapped.data[t];
    // Automatic acceptance is a per-device decision: imported sources fall back to "submit for approval".
    put.integrationSources = remapped.data.integrationSources.map((s) => {
      const downgraded = Object.fromEntries(Object.entries(s.permissions).map(([k, p]) => [k, p === "autoAccept" ? "submit" : p])) as typeof s.permissions;
      if (Object.values(s.permissions).includes("autoAccept")) warnings.push(`${s.name}: automatic acceptance was turned off; turn it back on in the Inbox if you want it here.`);
      return { ...s, permissions: downgraded };
    });
    put.audit = [
      ...(put.audit ?? []),
      { id: this.newId(), instanceId: newInstanceId, at, actor: "user", action: "instance.import", target: newInstanceId, summary: `Imported from a save exported ${save.exportedAt}` },
    ];
    await this.storage.commit(newInstanceId, {
      instance,
      put,
      snapshot: { instanceId: newInstanceId, state: differs.length ? rebuilt : snapshotState, lastSeq: Math.max(0, ...remapped.data.events.map((e) => e.seq)), updatedAt: at },
    });
    if (target) await this.storage.deleteInstance(target.id);
    return { instance, warnings };
  }

  /** A fresh map from a starter: its curriculum, your new history. */
  async createFromStarter(starter: StarterMap, name: string): Promise<InstanceRow> {
    const clean = name.trim();
    if (!clean || clean.length > 60) throw new ValidationError(["Give the map a name under 60 characters."]);
    const at = this.now();
    const id = this.newId();
    const instance: InstanceRow = {
      id,
      name: clean,
      createdAt: at,
      updatedAt: at,
      schemaVersion: SCHEMA_VERSION,
      packRefs: this.svc.registry.packs,
      overrides: starter.config.overrides,
      settings: { currency: starter.config.settings.currency },
    };
    let ruleset;
    try {
      ruleset = buildRuleset(this.svc.registry, instance.overrides);
    } catch (e) {
      throw new ValidationError([`The starter's settings don't fit this app's content: ${e instanceof Error ? e.message : String(e)}`]);
    }
    const put = starterRows(starter, this.svc.registry, id, at, () => this.newId());
    const empty = { carriers: put.carriers ?? [], scripts: put.scripts ?? [], docket: put.docket ?? [], courses: put.courses ?? [] };
    Object.assign(put, seedRows(this.svc.registry, id, at, () => this.newId(), empty));
    put.audit = [{ id: this.newId(), instanceId: id, at, actor: "user", action: "instance.create", target: id, summary: `Created "${clean}" from starter map "${starter.name}"` }];
    await this.storage.commit(id, { instance, put, snapshot: { instanceId: id, state: createInitialState(ruleset), lastSeq: 0, updatedAt: at } });
    return instance;
  }

  private now(): string {
    return this.svc.now();
  }

  private newId(): string {
    return this.svc.freshId();
  }
}

function uniqueName(base: string, existing: InstanceRow[]): string {
  const trimmed = base.slice(0, 60);
  if (!existing.some((i) => i.name === trimmed)) return trimmed;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, 55)} ${n}`;
    if (!existing.some((i) => i.name === candidate)) return candidate;
  }
}
