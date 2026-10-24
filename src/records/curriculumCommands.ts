import type { CarrierRow, ChecklistItem, KnowledgeRow, ProductRow, ResourceRef } from "../persistence/types";
import type { CommandService, Transaction } from "./commands";
import { ValidationError } from "./errors";
import { STUDY_TYPE, categoryView, creditedStudyMinutes, knowledgeId, rowKey, subjectFromValues, subjectId, type Subject } from "./curriculum";

/**
 * Carrier Archipelago commands. The app ships carrier labels only; everything
 * else here is your own knowledge, entered and verified by you.
 */

export interface CarrierInput {
  key?: string;
  label: string;
  kind: CarrierRow["kind"];
  notes?: string;
  archived?: boolean;
}

export interface ProductInput {
  key?: string;
  carrierKey: string;
  name: string;
  details?: string;
  notes?: string;
  archived?: boolean;
}

export type KnowledgePatch = Partial<Pick<KnowledgeRow, "applicable" | "summary" | "checklist" | "notes" | "resources" | "explainedWithoutNotes">>;

const KINDS: CarrierRow["kind"][] = ["carrier", "platform", "distributor", "other", "unspecified"];
const MAX_TEXT = 20_000;

export class CurriculumCommands {
  constructor(private svc: CommandService) {}

  async saveCarrier(instanceId: string, input: CarrierInput): Promise<CarrierRow> {
    const tx = await this.svc.begin(instanceId);
    const label = input.label.trim();
    const errors: string[] = [];
    if (!label) errors.push("Give the carrier a name.");
    if (label.length > 80) errors.push("Keep the name under 80 characters.");
    if (!KINDS.includes(input.kind)) errors.push("Choose what kind of company this is.");
    const existing = input.key ? tx.bundle.carriers.find((c) => c.key === input.key) : undefined;
    if (input.key && !existing) errors.push("That carrier no longer exists.");
    if (tx.bundle.carriers.some((c) => c.key !== input.key && c.label.toLowerCase() === label.toLowerCase())) errors.push(`You already have "${label}".`);
    if (errors.length) throw new ValidationError(errors);

    const key = existing?.key ?? `user:${tx.id()}`;
    const row: CarrierRow = {
      id: rowKey(instanceId, key),
      instanceId,
      key,
      label,
      kind: input.kind,
      notes: (input.notes ?? existing?.notes ?? "").slice(0, MAX_TEXT),
      archived: input.archived ?? existing?.archived ?? false,
      sortOrder: existing?.sortOrder ?? tx.bundle.carriers.length,
      createdAt: existing?.createdAt ?? tx.at,
      updatedAt: tx.at,
    };
    tx.rows("carriers").push(row);
    tx.audit(existing ? "carrier.update" : "carrier.create", key, `${existing ? "Updated" : "Added"} carrier ${label}`, existing, row);
    await tx.commit();
    return row;
  }

  async saveProduct(instanceId: string, input: ProductInput): Promise<ProductRow> {
    const tx = await this.svc.begin(instanceId);
    const name = input.name.trim();
    const errors: string[] = [];
    const carrier = tx.bundle.carriers.find((c) => c.key === input.carrierKey);
    if (!carrier) errors.push("Choose a carrier.");
    if (!name) errors.push("Give the product a name.");
    if (name.length > 80) errors.push("Keep the name under 80 characters.");
    const existing = input.key ? tx.bundle.products.find((p) => p.key === input.key) : undefined;
    if (input.key && !existing) errors.push("That product no longer exists.");
    if (existing && existing.carrierKey !== input.carrierKey) errors.push("A product can't move to another carrier.");
    if (tx.bundle.products.some((p) => p.key !== input.key && p.carrierKey === input.carrierKey && p.name.toLowerCase() === name.toLowerCase())) {
      errors.push(`${carrier?.label ?? "This carrier"} already has "${name}".`);
    }
    if (errors.length) throw new ValidationError(errors);

    const details = (input.details ?? existing?.details ?? "").slice(0, MAX_TEXT);
    // Verification is of specific details: changing them means checking again.
    const stillVerified = existing?.status === "verified" && existing.details === details;
    const key = existing?.key ?? `user:${tx.id()}`;
    const row: ProductRow = {
      id: rowKey(instanceId, key),
      instanceId,
      key,
      carrierKey: input.carrierKey,
      name,
      details,
      notes: (input.notes ?? existing?.notes ?? "").slice(0, MAX_TEXT),
      status: stillVerified ? "verified" : details.trim() ? "draft" : "empty",
      verifiedOn: stillVerified ? existing!.verifiedOn : null,
      archived: input.archived ?? existing?.archived ?? false,
      createdAt: existing?.createdAt ?? tx.at,
      updatedAt: tx.at,
    };
    tx.rows("products").push(row);
    tx.audit(existing ? "product.update" : "product.create", row.key, `${existing ? "Updated" : "Added"} product ${name}`, existing, row);
    await tx.commit();
    return row;
  }

  /** Confirm (or withdraw) that a product's details were checked against a source. */
  async verifyProduct(instanceId: string, productKey: string, verified: boolean): Promise<ProductRow> {
    const tx = await this.svc.begin(instanceId);
    const existing = tx.bundle.products.find((p) => p.key === productKey);
    if (!existing) throw new ValidationError(["That product no longer exists."]);
    if (verified && !existing.details.trim()) throw new ValidationError(["Enter the product's details before verifying them."]);
    const row: ProductRow = {
      ...existing,
      status: verified ? "verified" : existing.details.trim() ? "draft" : "empty",
      verifiedOn: verified ? tx.at.slice(0, 10) : null,
      updatedAt: tx.at,
    };
    tx.rows("products").push(row);
    tx.audit(verified ? "product.verify" : "product.unverify", productKey, `${verified ? "Verified" : "Unverified"} ${existing.name}`);
    await tx.commit();
    return row;
  }

  async saveKnowledge(instanceId: string, subject: Subject, patch: KnowledgePatch): Promise<KnowledgeRow> {
    const tx = await this.svc.begin(instanceId);
    const def = this.checkSubject(tx, subject);
    const errors: string[] = [];
    if (patch.applicable === false && !def.canBeNotApplicable) errors.push(`${def.name} always applies.`);
    if (patch.checklist) {
      if (patch.checklist.length > 30) errors.push("Keep the checklist to 30 items.");
      if (patch.checklist.some((c) => c.text.length > 300)) errors.push("Keep each checklist item under 300 characters.");
    }
    if (patch.resources?.some((r) => r.url.trim() !== "" && !/^https?:\/\//i.test(r.url.trim()))) errors.push("Resource links must start with http:// or https://.");
    if ((patch.summary?.length ?? 0) > MAX_TEXT || (patch.notes?.length ?? 0) > MAX_TEXT) errors.push("That text is too long.");
    if (errors.length) throw new ValidationError(errors);

    const row: KnowledgeRow = { ...knowledgeRow(tx, subject), ...clean(patch), updatedAt: tx.at };
    tx.rows("knowledge").push(row);
    refreshPeak(tx, subject);
    tx.audit("knowledge.update", knowledgeId(instanceId, subject), `Updated ${def.name}`);
    await tx.commit();
    return tx.current("knowledge", row.id)!;
  }

  async markReviewed(instanceId: string, subject: Subject): Promise<KnowledgeRow> {
    const tx = await this.svc.begin(instanceId);
    const def = this.checkSubject(tx, subject);
    const row: KnowledgeRow = { ...knowledgeRow(tx, subject), lastReviewedOn: tx.at.slice(0, 10), updatedAt: tx.at };
    tx.rows("knowledge").push(row);
    refreshPeak(tx, subject);
    tx.audit("knowledge.review", row.id, `Reviewed ${def.name}`);
    await tx.commit();
    return tx.current("knowledge", row.id)!;
  }

  private checkSubject(tx: Transaction, s: Subject) {
    const problems = subjectProblems(tx, s);
    if (problems.length) throw new ValidationError(problems);
    return this.svc.registry.seeds.knowledgeCategories.find((c) => c.id === s.categoryId)!;
  }
}

/** Problems with a carrier / product / category combination, as used by study logs and knowledge edits. */
export function subjectProblems(tx: Transaction, s: Subject): string[] {
  const def = tx.registry.seeds.knowledgeCategories.find((c) => c.id === s.categoryId);
  const carrier = tx.bundle.carriers.find((c) => c.key === s.carrierKey);
  const product = s.productKey ? tx.bundle.products.find((p) => p.key === s.productKey) : undefined;
  const errors: string[] = [];
  if (!carrier) errors.push("Choose a carrier.");
  if (!def) errors.push("Choose a category.");
  if (s.productKey && (!product || product.carrierKey !== s.carrierKey)) errors.push("That product doesn't belong to this carrier.");
  if (def?.scope === "product" && !s.productKey) errors.push(`${def.name} is about a specific product. Choose the product.`);
  if (def?.scope === "carrier" && s.productKey) errors.push(`${def.name} is carrier-wide. Leave the product empty.`);
  return errors;
}

/** Curriculum checks for activities that reference carriers and products. */
export function activityRefProblems(tx: Transaction, typeId: string, values: Record<string, unknown>): string[] {
  if (typeId === STUDY_TYPE) {
    const subject = subjectFromValues(values);
    return subject ? subjectProblems(tx, subject) : [];
  }
  const errors: string[] = [];
  if (typeId === "core:act.objection-practice" && typeof values.caseId === "string" && !tx.bundle.docket.some((c) => c.key === values.caseId)) {
    errors.push("Choose a case on your docket.");
  }
  if (typeId === "core:act.time-trial" && typeof values.courseId === "string" && !tx.bundle.courses.some((c) => c.key === values.courseId)) {
    errors.push("Choose one of your courses.");
  }
  const carrierKey = values.carrierId;
  if (typeof carrierKey === "string" && carrierKey && !tx.bundle.carriers.some((c) => c.key === carrierKey)) errors.push("That carrier no longer exists.");
  const productKey = values.productId;
  if (typeof productKey === "string" && productKey) {
    const product = tx.bundle.products.find((p) => p.key === productKey);
    if (!product || product.carrierKey !== carrierKey) errors.push("That product doesn't belong to this carrier.");
  }
  return errors;
}

/** After study is logged or evidence changes, remember the highest level reached so lapses never erase it. */
export function refreshPeak(tx: Transaction, subject: Subject): void {
  const registry = tx.registry;
  const def = registry.seeds.knowledgeCategories.find((c) => c.id === subject.categoryId);
  if (!def) return;
  const merged = tx.merged();
  const minutes = creditedStudyMinutes(merged.activities, merged.ledger, registry.activityTypeById[STUDY_TYPE]?.limits.dailyPerSubject);
  const existing = merged.knowledge.find((k) => subjectId(k) === subjectId(subject)) ?? null;
  const view = categoryView(def, subject, existing, minutes, registry.seeds.categoryLevels, tx.at.slice(0, 10));
  if (view.level > (existing?.peakLevel ?? 0)) {
    tx.rows("knowledge").push({ ...(existing ?? knowledgeRow(tx, subject)), peakLevel: view.level, updatedAt: tx.at });
  }
}

function knowledgeRow(tx: Transaction, s: Subject): KnowledgeRow {
  const id = knowledgeId(tx.bundle.instance.id, s);
  return (
    tx.current("knowledge", id) ?? {
      id,
      instanceId: tx.bundle.instance.id,
      carrierKey: s.carrierKey,
      productKey: s.productKey,
      categoryId: s.categoryId,
      applicable: true,
      summary: "",
      checklist: [],
      notes: "",
      resources: [],
      lastReviewedOn: null,
      explainedWithoutNotes: false,
      peakLevel: 0,
      updatedAt: tx.at,
    }
  );
}

function clean(patch: KnowledgePatch): KnowledgePatch {
  const out: KnowledgePatch = { ...patch };
  if (patch.checklist) out.checklist = patch.checklist.map((c: ChecklistItem) => ({ id: c.id, text: c.text.trim(), done: c.done })).filter((c) => c.text);
  if (patch.resources) {
    out.resources = patch.resources
      .map((r: ResourceRef) => ({ id: r.id, label: r.label.trim(), url: r.url.trim() }))
      .filter((r) => r.label || r.url);
  }
  return out;
}
