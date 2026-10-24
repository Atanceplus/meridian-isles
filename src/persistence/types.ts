import type { ActivityRecord, AwardLine, ProgressState, RulesetOverrides } from "../domain";

/**
 * Stored rows. Every row belongs to one instance (one independent map), so an
 * instance can be exported, deleted or (later) synced as a unit.
 */

/**
 * Save format version. History:
 * 1 — Phases 0–4 (tables were added along the way; missing ones are treated as empty).
 * 2 — adds owned upgrades (Outfitter's Wharf).
 * 3 — adds integration sources and submissions (approval inbox).
 */
export const SCHEMA_VERSION = 3;

/** Where a record came from. Integrations (later) carry their own ids for duplicate prevention. */
export type SourceMeta = { kind: "manual" } | { kind: "integration"; sourceId: string; externalId: string };

export interface InstanceSettings {
  currency: string;
}

export interface InstanceRow {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
  packRefs: { id: string; version: string }[];
  overrides: RulesetOverrides;
  settings: InstanceSettings;
}

/** Engine-level event log, the append-only source of truth the snapshot is derived from. */
export type EngineEvent =
  | { kind: "activity"; record: ActivityRecord }
  | { kind: "reversal"; recordId: string }
  | { kind: "achievement"; achievementId: string }
  | { kind: "time" };

export interface EventRow {
  id: string;
  instanceId: string;
  /** Per-instance order. */
  seq: number;
  at: string;
  rulesetVersion: string;
  event: EngineEvent;
}

export interface ActivityRow {
  id: string;
  instanceId: string;
  typeId: string;
  occurredAt: string;
  recordedAt: string;
  /** Form values as entered. */
  values: Record<string, unknown>;
  /** The record handed to the engine. */
  record: ActivityRecord;
  status: "active" | "reversed";
  reversedAt: string | null;
  /** Set when this row was edited: the id of the row that replaced it. */
  replacedBy: string | null;
  /** Set for call-report activities created from a daily report. */
  dailyReportId: string | null;
  source: SourceMeta;
}

export interface DailyReportRow {
  id: string;
  instanceId: string;
  date: string;
  calls: number;
  hours: number;
  /** Sales = applications submitted. */
  applicationsSubmitted: number;
  /** Issue Paid (IP), as reported. Not a bank balance, not annualized. */
  issuePaid: number | null;
  currency: string;
  notes: string;
  /** The call-report activity that turned these hours into XP, if any. */
  activityId: string | null;
  createdAt: string;
  updatedAt: string;
  source: SourceMeta;
}

export interface SaleRow {
  id: string;
  instanceId: string;
  /** Application submission time: this is the sale. */
  submittedAt: string;
  carrierId: string | null;
  product: string;
  issuePaid: number | null;
  currency: string;
  policyRef: string;
  notes: string;
  /** Retention anchor you enter (issue or first-draft date), used only if the ruleset anchors checkpoints to it. */
  anchorDate?: string | null;
  /** Your self-reported retention result. Never assumed. */
  retention?: { status: "confirmedOk" | "chargeback"; reportedAt: string } | null;
  createdAt: string;
  updatedAt: string;
  source: SourceMeta;
}

export interface LedgerRow extends AwardLine {
  id: string;
  instanceId: string;
}

export interface AchievementRow {
  id: string;
  instanceId: string;
  achievementId: string;
  completedAt: string;
  evidenceNote: string;
  /** What your records showed when you completed it. */
  evidence?: { text: string; current: number; required: number }[];
}

export interface AuditRow {
  id: string;
  instanceId: string;
  at: string;
  actor: "user" | string;
  action: string;
  target: string;
  summary: string;
  before?: unknown;
  after?: unknown;
}

export interface SnapshotRow {
  instanceId: string;
  state: ProgressState;
  lastSeq: number;
  updatedAt: string;
}

// ---------- Curriculum (per-map, editable; seeded from content packs) ----------

/**
 * Curriculum rows have a logical `key` that records refer to (activity values,
 * sales). Seeded rows use the pack id ("fe:carrier.americo"); user-added rows
 * use "user:<uuid>". The row `id` is `${instanceId}::${key}` so keys only need
 * to be unique within a map.
 */
export interface CarrierRow {
  id: string;
  instanceId: string;
  key: string;
  label: string;
  kind: "carrier" | "platform" | "distributor" | "other" | "unspecified";
  notes: string;
  archived: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductRow {
  id: string;
  instanceId: string;
  key: string;
  carrierKey: string;
  name: string;
  /** Your own description of the product. Nothing is pre-filled. */
  details: string;
  notes: string;
  /** "empty" until details are entered; "verified" once you confirm them against a source. */
  status: "empty" | "draft" | "verified";
  verifiedOn: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface ResourceRef {
  id: string;
  label: string;
  url: string;
}

/** Your knowledge of one category for one carrier (carrier-wide) or one product. */
export interface KnowledgeRow {
  id: string;
  instanceId: string;
  carrierKey: string;
  productKey: string | null;
  categoryId: string;
  applicable: boolean;
  summary: string;
  checklist: ChecklistItem[];
  notes: string;
  resources: ResourceRef[];
  lastReviewedOn: string | null;
  explainedWithoutNotes: boolean;
  /** Highest level ever reached. Levels can lapse (stale reviews); restoration uses the peak. */
  peakLevel: number;
  updatedAt: string;
}

// ---------- Script Foundry ----------

export interface ScriptSection {
  id: string;
  name: string;
  body: string;
}

export interface ScriptRow {
  id: string;
  instanceId: string;
  title: string;
  currentRevisionId: string;
  createdAt: string;
  updatedAt: string;
}

/** A saved state of the whole script. Every save creates (or extends, within a short burst) a revision. */
export interface ScriptRevisionRow {
  id: string;
  instanceId: string;
  scriptId: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  sections: ScriptSection[];
}

/** A named, timestamped version pointing at a revision. */
export interface ScriptVersionRow {
  id: string;
  instanceId: string;
  scriptId: string;
  revisionId: string;
  name: string;
  note: string;
  createdAt: string;
  /** Set when you mark this version as a meaningful improvement (which logs XP). */
  meaningful: { tag: string; note: string; markedAt: string; activityId: string } | null;
}

// ---------- Court of Objections ----------

/** One case on your docket: an objection and your response(s). Seeded cases use the pack id as key. */
export interface DocketCaseRow {
  id: string;
  instanceId: string;
  key: string;
  title: string;
  response: string;
  notes: string;
  scriptSectionId: string | null;
  archived: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** An objection met on a real call. */
export interface ObjectionEncounterRow {
  id: string;
  instanceId: string;
  occurredOn: string;
  caseKey: string;
  outcome: "resolved" | "unresolved" | "callEnded";
  notes: string;
  createdAt: string;
}

/** A randomized Rebuttal Trial: each drawn case self-rated fluent or not. */
export interface RebuttalTrialRow {
  id: string;
  instanceId: string;
  at: string;
  results: { caseKey: string; fluent: boolean }[];
  activityId: string;
}

// ---------- Conversation Cove ----------

export interface RapportCardRow {
  id: string;
  instanceId: string;
  kind: "opener" | "transition" | "story" | "question";
  title: string;
  body: string;
  scenarioKey: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A rapport moment noticed on a real call. */
export interface RapportNoteRow {
  id: string;
  instanceId: string;
  occurredOn: string;
  scenarioKey: string | null;
  note: string;
  createdAt: string;
}

// ---------- Velocity Circuit ----------

/** A timed course. Its target time can be set once and is then frozen. */
export interface CourseRow {
  id: string;
  instanceId: string;
  key: string;
  name: string;
  kind: "script" | "app" | "general";
  carrierKey: string | null;
  targetSeconds: number | null;
  targetSetOn: string | null;
  archived: boolean;
  createdAt: string;
}

/** A Lightspeed attempt: up to ten sales inside one continuous window. */
export interface LightspeedAttemptRow {
  id: string;
  instanceId: string;
  windowStart: string;
  windowEnd: string;
  saleIds: string[];
  notes: string;
  createdAt: string;
  /** Set when this attempt's complete evidence was recorded as the Lightspeed achievement. */
  achievementRecordedAt: string | null;
  history: { at: string; text: string }[];
}

// ---------- Outfitter's Wharf ----------

export type UpgradeCategory = "leads" | "crm" | "dialer" | "training" | "equipment" | "service" | "other";

/**
 * Something you bought for the business, recorded after the fact. The app
 * never makes payments, and upgrades are cosmetic only: they decorate HQ but
 * never grant XP or mastery.
 */
export interface OwnedUpgradeRow {
  id: string;
  instanceId: string;
  catalogId: string | null;
  category: UpgradeCategory;
  name: string;
  description: string;
  capabilities: string;
  purchasedOn: string;
  /** Cost as you report it. Not reconciled with any account. */
  reportedCost: number | null;
  currency: string;
  /** For consumables such as leads. */
  quantity: number | null;
  remaining: number | null;
  subscription: { status: "active" | "paused" | "cancelled"; cadence: "monthly" | "annual" | "other"; renewsOn: string | null } | null;
  notes: string;
  /** Inventory changes, newest last. */
  history: { at: string; text: string }[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------- Integrations ----------

/** What an outside source can submit. Each has its own permission. */
export type SubmissionCategory = "dailyReport" | "sale";
export const SUBMISSION_CATEGORIES: SubmissionCategory[] = ["dailyReport", "sale"];

/** no access · submit for your approval · apply automatically (only if you turn it on). */
export type Permission = "none" | "submit" | "autoAccept";

/** A connected (or simulated) source such as Grokbot. Credentials are never stored here. */
export interface IntegrationSourceRow {
  id: string;
  instanceId: string;
  name: string;
  adapter: string;
  permissions: Record<SubmissionCategory, Permission>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastReceivedAt: string | null;
}

export interface SubmissionRow {
  id: string;
  instanceId: string;
  sourceId: string;
  /** The source's own id for this submission; with sourceId it makes delivery idempotent. */
  externalId: string;
  category: SubmissionCategory;
  payload: unknown;
  payloadHash: string;
  receivedAt: string;
  status: "pending" | "approved" | "rejected" | "refused";
  decidedAt: string | null;
  decidedBy: "user" | "auto" | null;
  note: string;
  /** Things to check before approving (e.g. a possible duplicate). */
  warnings: string[];
  /** Why it was refused. */
  errors: string[];
  resultingRecordIds: string[];
}

// ---------- Tables ----------

/** Every per-instance table and its row type. Storage adapters loop over this list. */
export interface TableRows {
  events: EventRow;
  activities: ActivityRow;
  dailyReports: DailyReportRow;
  sales: SaleRow;
  ledger: LedgerRow;
  achievements: AchievementRow;
  audit: AuditRow;
  carriers: CarrierRow;
  products: ProductRow;
  knowledge: KnowledgeRow;
  scripts: ScriptRow;
  scriptRevisions: ScriptRevisionRow;
  scriptVersions: ScriptVersionRow;
  docket: DocketCaseRow;
  objectionEncounters: ObjectionEncounterRow;
  rebuttalTrials: RebuttalTrialRow;
  rapportCards: RapportCardRow;
  rapportNotes: RapportNoteRow;
  courses: CourseRow;
  lightspeedAttempts: LightspeedAttemptRow;
  ownedUpgrades: OwnedUpgradeRow;
  integrationSources: IntegrationSourceRow;
  submissions: SubmissionRow;
}
export type TableName = keyof TableRows;

export const TABLES: TableName[] = [
  "events",
  "activities",
  "dailyReports",
  "sales",
  "ledger",
  "achievements",
  "audit",
  "carriers",
  "products",
  "knowledge",
  "scripts",
  "scriptRevisions",
  "scriptVersions",
  "docket",
  "objectionEncounters",
  "rebuttalTrials",
  "rapportCards",
  "rapportNotes",
  "courses",
  "lightspeedAttempts",
  "ownedUpgrades",
  "integrationSources",
  "submissions",
];

/** Tables loaded with an instance (the event log is only read for export and rebuilds). */
export type BundleTable = Exclude<TableName, "events">;
export const BUNDLE_TABLES = TABLES.filter((t): t is BundleTable => t !== "events");

export type InstanceBundle = {
  instance: InstanceRow;
  snapshot: SnapshotRow | null;
} & { [K in BundleTable]: TableRows[K][] };

/** Everything one command writes, applied atomically. */
export interface ChangeSet {
  instance?: InstanceRow;
  put?: { [K in TableName]?: TableRows[K][] };
  remove?: { [K in TableName]?: string[] };
  snapshot?: SnapshotRow;
}
