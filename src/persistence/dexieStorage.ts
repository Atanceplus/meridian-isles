import Dexie, { type Table } from "dexie";
import type { StorageAdapter } from "./storage";
import { BUNDLE_TABLES, TABLES, type ChangeSet, type EventRow, type InstanceBundle, type InstanceRow, type SnapshotRow, type TableName } from "./types";

/** Schema history. Never edit a published version; add a new one. */
const V1 = {
  instances: "id",
  events: "id, instanceId, [instanceId+seq]",
  activities: "id, instanceId",
  dailyReports: "id, instanceId, [instanceId+date]",
  sales: "id, instanceId",
  ledger: "id, instanceId, recordId",
  achievements: "id, instanceId",
  audit: "id, instanceId",
  snapshots: "instanceId",
};
const V2 = {
  ...V1,
  carriers: "id, instanceId",
  products: "id, instanceId",
  knowledge: "id, instanceId",
  scripts: "id, instanceId",
  scriptRevisions: "id, instanceId, scriptId",
  scriptVersions: "id, instanceId, scriptId",
};

const V3 = {
  ...V2,
  docket: "id, instanceId",
  objectionEncounters: "id, instanceId",
  rebuttalTrials: "id, instanceId",
  rapportCards: "id, instanceId",
  rapportNotes: "id, instanceId",
  courses: "id, instanceId",
  lightspeedAttempts: "id, instanceId",
};
const V4 = { ...V3, ownedUpgrades: "id, instanceId" };
const V5 = { ...V4, integrationSources: "id, instanceId", submissions: "id, instanceId, [sourceId+externalId]" };

class MeridianDb extends Dexie {
  constructor(name: string) {
    super(name);
    this.version(1).stores(V1);
    this.version(2).stores(V2);
    this.version(3).stores(V3);
    this.version(4).stores(V4);
    this.version(5).stores(V5);
  }

  rows(table: TableName): Table<{ id: string; instanceId: string }, string> {
    return this.table(table);
  }
  get instances(): Table<InstanceRow, string> {
    return this.table("instances");
  }
  get snapshots(): Table<SnapshotRow, string> {
    return this.table("snapshots");
  }
}

/** IndexedDB storage, local to this browser. */
export class DexieStorage implements StorageAdapter {
  private db: MeridianDb;

  constructor(name = "meridian-isles") {
    this.db = new MeridianDb(name);
  }

  private all() {
    return [this.db.instances, this.db.snapshots, ...TABLES.map((t) => this.db.rows(t))];
  }

  async listInstances(): Promise<InstanceRow[]> {
    return this.db.instances.toArray();
  }

  async loadBundle(instanceId: string): Promise<InstanceBundle | null> {
    const db = this.db;
    return db.transaction("r", this.all(), async () => {
      const instance = await db.instances.get(instanceId);
      if (!instance) return null;
      const snapshot = (await db.snapshots.get(instanceId)) ?? null;
      const bundle: Record<string, unknown> = { instance, snapshot };
      const lists = await Promise.all(BUNDLE_TABLES.map((t) => db.rows(t).where("instanceId").equals(instanceId).toArray()));
      BUNDLE_TABLES.forEach((t, i) => (bundle[t] = lists[i]));
      return bundle as InstanceBundle;
    });
  }

  async loadEvents(instanceId: string): Promise<EventRow[]> {
    return (await this.db
      .rows("events")
      .where("[instanceId+seq]")
      .between([instanceId, Dexie.minKey], [instanceId, Dexie.maxKey])
      .toArray()) as unknown as EventRow[];
  }

  async commit(instanceId: string, c: ChangeSet): Promise<void> {
    const db = this.db;
    await db.transaction("rw", this.all(), async () => {
      if (c.instance) await db.instances.put(c.instance);
      else if (!(await db.instances.get(instanceId))) throw new Error(`Unknown instance "${instanceId}"`);
      for (const table of TABLES) {
        const put = c.put?.[table] as { id: string; instanceId: string }[] | undefined;
        if (put?.length) await db.rows(table).bulkPut(put);
        const remove = c.remove?.[table];
        if (remove?.length) await db.rows(table).bulkDelete(remove);
      }
      if (c.snapshot) await db.snapshots.put(c.snapshot);
    });
  }

  async deleteInstance(instanceId: string): Promise<void> {
    const db = this.db;
    await db.transaction("rw", this.all(), async () => {
      await db.instances.delete(instanceId);
      await db.snapshots.delete(instanceId);
      for (const table of TABLES) await db.rows(table).where("instanceId").equals(instanceId).delete();
    });
  }

  close(): void {
    this.db.close();
  }
}
