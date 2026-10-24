import { BUNDLE_TABLES, TABLES, type ChangeSet, type EventRow, type InstanceBundle, type InstanceRow, type SnapshotRow, type TableName, type TableRows } from "./types";

/**
 * Storage boundary. The browser build uses IndexedDB (DexieStorage); a hosted,
 * login-based backend can implement the same interface later without touching
 * domain or UI code.
 */
export interface StorageAdapter {
  listInstances(): Promise<InstanceRow[]>;
  loadBundle(instanceId: string): Promise<InstanceBundle | null>;
  loadEvents(instanceId: string): Promise<EventRow[]>;
  /** Apply every change in one transaction: all or nothing. */
  commit(instanceId: string, changes: ChangeSet): Promise<void>;
  deleteInstance(instanceId: string): Promise<void>;
}

type Rows = { [K in TableName]: TableRows[K][] };

/** In-memory adapter for tests and previews. */
export class MemoryStorage implements StorageAdapter {
  private instances = new Map<string, InstanceRow>();
  private data = new Map<string, { rows: Rows; snapshot: SnapshotRow | null }>();

  async listInstances(): Promise<InstanceRow[]> {
    return [...this.instances.values()].map((i) => structuredClone(i));
  }

  async loadBundle(instanceId: string): Promise<InstanceBundle | null> {
    const instance = this.instances.get(instanceId);
    const data = this.data.get(instanceId);
    if (!instance || !data) return null;
    const bundle = { instance, snapshot: data.snapshot } as InstanceBundle;
    for (const table of BUNDLE_TABLES) (bundle as Record<string, unknown>)[table] = data.rows[table];
    return structuredClone(bundle);
  }

  async loadEvents(instanceId: string): Promise<EventRow[]> {
    return structuredClone(this.data.get(instanceId)?.rows.events ?? []);
  }

  async commit(instanceId: string, changes: ChangeSet): Promise<void> {
    const c = structuredClone(changes);
    if (!c.instance && !this.instances.has(instanceId)) throw new Error(`Unknown instance "${instanceId}"`);
    const data = this.data.get(instanceId) ?? { rows: emptyRows(), snapshot: null };
    for (const table of TABLES) {
      const rows = data.rows[table] as { id: string }[];
      for (const row of (c.put?.[table] ?? []) as { id: string }[]) {
        const i = rows.findIndex((r) => r.id === row.id);
        if (i >= 0) rows[i] = row;
        else rows.push(row);
      }
      const remove = c.remove?.[table];
      if (remove?.length) (data.rows as Record<string, unknown>)[table] = rows.filter((r) => !remove.includes(r.id));
    }
    if (c.snapshot) data.snapshot = c.snapshot;
    if (c.instance) this.instances.set(instanceId, c.instance);
    this.data.set(instanceId, data);
  }

  async deleteInstance(instanceId: string): Promise<void> {
    this.instances.delete(instanceId);
    this.data.delete(instanceId);
  }
}

function emptyRows(): Rows {
  return Object.fromEntries(TABLES.map((t) => [t, []])) as unknown as Rows;
}
