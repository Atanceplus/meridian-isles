import { z } from "zod";
import type { PersonalSave } from "./exportSave";
import { STARTER_FORMAT, STARTER_SCHEMA_VERSION, starterMapSchema, type StarterMap } from "./starterFormat";
import { SCHEMA_VERSION, TABLES, type TableName } from "./types";

/**
 * Reading save files. Parsing never writes anything: it detects the format,
 * checks the checksum, migrates old versions forward step by step, and
 * validates the result. Problems come back as readable errors and warnings.
 */

export class ImportError extends Error {
  constructor(public errors: string[]) {
    super(errors.join(" "));
  }
}

export type ParsedFile =
  | { kind: "personal"; save: PersonalSave; migratedFrom: number | null; checksumOk: boolean; warnings: string[] }
  | { kind: "starter"; starter: StarterMap; migratedFrom: number | null; warnings: string[] };

type Json = Record<string, unknown>;

/** Personal-save migrations: MIGRATIONS[n] turns version n into n + 1. */
const MIGRATIONS: Record<number, (save: Json) => Json> = {
  // v1 → v2: owned upgrades arrive. Missing tables of any kind are normalized below.
  1: (save) => ({ ...save, schemaVersion: 2 }),
  // v2 → v3: integration sources and submissions arrive (normalized below).
  2: (save) => ({ ...save, schemaVersion: 3 }),
};

const rowSchema = z.object({ id: z.string().min(1), instanceId: z.string().min(1) }).passthrough();

const personalSchema = z.object({
  format: z.literal("meridian-save"),
  schemaVersion: z.literal(SCHEMA_VERSION),
  appVersion: z.string(),
  exportedAt: z.string(),
  packRefs: z.array(z.object({ id: z.string(), version: z.string() })),
  instance: z
    .object({
      id: z.string().min(1),
      name: z.string().min(1).max(60),
      createdAt: z.string(),
      updatedAt: z.string(),
      schemaVersion: z.number(),
      packRefs: z.array(z.object({ id: z.string(), version: z.string() })),
      overrides: z.record(z.unknown()),
      settings: z.object({ currency: z.string() }),
    })
    .passthrough(),
  data: z.record(z.array(rowSchema)),
  snapshot: z
    .object({ instanceId: z.string(), lastSeq: z.number(), updatedAt: z.string(), state: z.object({ skills: z.record(z.unknown()) }).passthrough() })
    .passthrough()
    .nullable(),
  checksum: z.string(),
});

export async function parseSaveFile(text: string): Promise<ParsedFile> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportError(["This isn't a readable save file (the JSON is damaged or incomplete)."]);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ImportError(["This file doesn't contain a save."]);
  const json = raw as Json;

  if (json.format === STARTER_FORMAT) return parseStarter(json);
  if (json.format !== "meridian-save") throw new ImportError(["This isn't a Meridian Isles save or starter map."]);

  const warnings: string[] = [];
  const version = json.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) throw new ImportError(["The save's format version is missing."]);
  if (version > SCHEMA_VERSION) throw new ImportError([`This save was made by a newer version of the app (format ${version}). Update the app, then import it.`]);

  // The checksum covers the file as exported, so check it before migrating anything.
  const checksumOk = typeof json.checksum === "string" && (await sha256(JSON.stringify({ instance: json.instance, data: json.data, snapshot: json.snapshot }))) === json.checksum;
  if (!checksumOk) warnings.push("The file's checksum doesn't match: it was edited or damaged after export. Progress will be checked against its event log.");

  let migrated: Json = json;
  for (let v = version; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) throw new ImportError([`No migration from format ${v}.`]);
    migrated = step(migrated);
  }
  if (version < SCHEMA_VERSION) warnings.push(`Upgraded from save format ${version} to ${SCHEMA_VERSION}.`);
  migrated = normalizeTables(migrated, warnings);

  const parsed = personalSchema.safeParse(migrated);
  if (!parsed.success) {
    throw new ImportError(parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "file"}: ${i.message}`));
  }
  const save = parsed.data as unknown as PersonalSave;
  const errors = consistencyErrors(save);
  if (errors.length) throw new ImportError(errors);
  return { kind: "personal", save, migratedFrom: version < SCHEMA_VERSION ? version : null, checksumOk, warnings };
}

function parseStarter(json: Json): ParsedFile {
  const version = json.schemaVersion;
  if (typeof version === "number" && version > STARTER_SCHEMA_VERSION) throw new ImportError(["This starter map was made by a newer version of the app."]);
  const parsed = starterMapSchema.safeParse(json);
  if (!parsed.success) throw new ImportError(parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "file"}: ${i.message}`));
  const s = parsed.data;
  const carriers = new Set(s.curriculum.carriers.map((c) => c.key));
  const errors: string[] = [];
  if (s.curriculum.products.some((p) => !carriers.has(p.carrierKey))) errors.push("A product refers to a carrier that isn't in the map.");
  if (s.curriculum.knowledge.some((k) => !carriers.has(k.carrierKey))) errors.push("Some knowledge refers to a carrier that isn't in the map.");
  if (new Set(s.curriculum.carriers.map((c) => c.key)).size !== s.curriculum.carriers.length) errors.push("Two carriers share a key.");
  if (errors.length) throw new ImportError(errors);
  return { kind: "starter", starter: s, migratedFrom: null, warnings: [] };
}

/** Every known table present (missing → empty), unknown tables dropped with a warning. */
function normalizeTables(save: Json, warnings: string[]): Json {
  const data = (save.data && typeof save.data === "object" ? save.data : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const t of TABLES) out[t] = Array.isArray(data[t]) ? data[t] : [];
  const unknown = Object.keys(data).filter((k) => !TABLES.includes(k as TableName));
  if (unknown.length) warnings.push(`Ignored data this version doesn't know: ${unknown.join(", ")}.`);
  return { ...save, data: out };
}

function consistencyErrors(save: PersonalSave): string[] {
  const errors: string[] = [];
  for (const t of TABLES) {
    const rows = save.data[t] as { id: string; instanceId: string }[];
    if (rows.some((r) => r.instanceId !== save.instance.id)) errors.push(`Some ${t} belong to a different map.`);
    if (new Set(rows.map((r) => r.id)).size !== rows.length) errors.push(`Duplicate ids in ${t}.`);
  }
  const seqs = save.data.events.map((e) => e.seq);
  if (new Set(seqs).size !== seqs.length) errors.push("The event log has duplicate entries.");
  if (save.snapshot && save.snapshot.instanceId !== save.instance.id) errors.push("The progress snapshot belongs to a different map.");
  return errors;
}

/**
 * Give an imported map fresh identities. Every row id (and the instance id) is
 * replaced throughout the save, wherever it appears: as a value or as an object
 * key (the progress snapshot is keyed by record ids). Ids derived from the
 * instance id ("<instance>::key", "<instance>|achievement") keep their suffix.
 */
export function remapIds<T>(value: T, oldInstanceId: string, newInstanceId: string, ids: Map<string, string>): T {
  const map = (s: string): string => {
    const direct = ids.get(s);
    if (direct !== undefined) return direct;
    if (s === oldInstanceId) return newInstanceId;
    if (s.startsWith(`${oldInstanceId}::`) || s.startsWith(`${oldInstanceId}|`)) return newInstanceId + s.slice(oldInstanceId.length);
    return s;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return map(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [map(k), walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/** New ids for every row whose id isn't derived from the instance id. */
export function freshIds(save: PersonalSave, newId: () => string): Map<string, string> {
  const ids = new Map<string, string>();
  const old = save.instance.id;
  for (const t of TABLES) {
    for (const row of save.data[t] as { id: string }[]) {
      if (!row.id.startsWith(`${old}::`) && !row.id.startsWith(`${old}|`)) ids.set(row.id, newId());
    }
  }
  return ids;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
