import Dexie, { type Table } from "dexie";

/**
 * Integration credentials (API keys, tokens). Kept in a separate browser
 * database that no export, backup or starter map ever reads, so credentials
 * never travel with a save. A hosted version would keep them server-side.
 */
export interface SecretStore {
  get(sourceId: string): Promise<string | null>;
  set(sourceId: string, secret: string): Promise<void>;
  remove(sourceId: string): Promise<void>;
  has(sourceId: string): Promise<boolean>;
}

class SecretsDb extends Dexie {
  secrets!: Table<{ sourceId: string; secret: string; updatedAt: string }, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ secrets: "sourceId" });
  }
}

export class DexieSecretStore implements SecretStore {
  private db: SecretsDb;
  constructor(name = "meridian-isles-secrets") {
    this.db = new SecretsDb(name);
  }
  async get(sourceId: string): Promise<string | null> {
    return (await this.db.secrets.get(sourceId))?.secret ?? null;
  }
  async set(sourceId: string, secret: string): Promise<void> {
    await this.db.secrets.put({ sourceId, secret, updatedAt: new Date().toISOString() });
  }
  async remove(sourceId: string): Promise<void> {
    await this.db.secrets.delete(sourceId);
  }
  async has(sourceId: string): Promise<boolean> {
    return (await this.db.secrets.get(sourceId)) !== undefined;
  }
}

export class MemorySecretStore implements SecretStore {
  private map = new Map<string, string>();
  async get(sourceId: string) {
    return this.map.get(sourceId) ?? null;
  }
  async set(sourceId: string, secret: string) {
    this.map.set(sourceId, secret);
  }
  async remove(sourceId: string) {
    this.map.delete(sourceId);
  }
  async has(sourceId: string) {
    return this.map.has(sourceId);
  }
}
