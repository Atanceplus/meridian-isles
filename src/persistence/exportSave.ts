import type { StorageAdapter } from "./storage";
import { BUNDLE_TABLES, SCHEMA_VERSION, type EventRow, type InstanceBundle, type TableName, type TableRows } from "./types";

/**
 * Personal save: a complete, versioned backup of one map. It contains no
 * integration credentials (none exist yet; they will live outside saves).
 * Import with preview and migrations arrives in Phase 5.
 */

export interface PersonalSave {
  format: "meridian-save";
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  packRefs: { id: string; version: string }[];
  instance: InstanceBundle["instance"];
  data: { [K in TableName]: TableRows[K][] };
  snapshot: InstanceBundle["snapshot"];
  /** SHA-256 of the JSON of { instance, data, snapshot }, to detect damaged files. */
  checksum: string;
}

export async function buildPersonalSave(
  storage: StorageAdapter,
  instanceId: string,
  appVersion: string,
  exportedAt: string,
): Promise<PersonalSave> {
  const bundle = await storage.loadBundle(instanceId);
  if (!bundle) throw new Error(`Map "${instanceId}" was not found.`);
  const events: EventRow[] = [...(await storage.loadEvents(instanceId))].sort((a, b) => a.seq - b.seq);
  const { instance, snapshot } = bundle;
  const data = { events, ...Object.fromEntries(BUNDLE_TABLES.map((t) => [t, bundle[t]])) } as PersonalSave["data"];
  return {
    format: "meridian-save",
    schemaVersion: SCHEMA_VERSION,
    appVersion,
    exportedAt,
    packRefs: instance.packRefs,
    instance,
    data,
    snapshot,
    checksum: await sha256(JSON.stringify({ instance, data, snapshot })),
  };
}

export function saveFileName(name: string, exportedAt: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "map";
  return `${slug}-${exportedAt.slice(0, 10)}.meridian-save.json`;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
