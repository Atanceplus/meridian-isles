import type { ContentRegistry } from "../content/registry";
import { STARTER_FORMAT, STARTER_SCHEMA_VERSION, type StarterMap } from "../persistence/starterFormat";
import type { ChangeSet, InstanceBundle } from "../persistence/types";
import { knowledgeId, rowKey } from "./curriculum";

/** What a starter map includes beyond carriers, products and categories. */
export interface StarterOptions {
  /** Your current script's sections. */
  includeScript: boolean;
  /** Your written docket responses (titles are always included). */
  includeDocketResponses: boolean;
  includeRapportLibrary: boolean;
  /** Your product details text. */
  includeProductDetails: boolean;
  /** Personal notes on carriers, products, categories and cases. Off by default. */
  includeNotes: boolean;
}

export const DEFAULT_STARTER_OPTIONS: StarterOptions = {
  includeScript: true,
  includeDocketResponses: true,
  includeRapportLibrary: true,
  includeProductDetails: true,
  includeNotes: false,
};

/**
 * Build a shareable starter map from a map's curriculum. Progress, history,
 * verification, reviews, targets and purchases are never included; checklist
 * items are exported unticked.
 */
export function buildStarter(bundle: InstanceBundle, o: StarterOptions, meta: { name: string; description: string; appVersion: string; exportedAt: string }): StarterMap {
  const notes = (s: string) => (o.includeNotes ? s : "");
  const script = bundle.scripts[0];
  const revision = script && bundle.scriptRevisions.find((r) => r.id === script.currentRevisionId);
  return {
    format: STARTER_FORMAT,
    schemaVersion: STARTER_SCHEMA_VERSION,
    appVersion: meta.appVersion,
    exportedAt: meta.exportedAt,
    name: meta.name,
    description: meta.description,
    packRefs: bundle.instance.packRefs,
    config: { overrides: bundle.instance.overrides as Record<string, unknown>, settings: { currency: bundle.instance.settings.currency } },
    curriculum: {
      carriers: bundle.carriers.map((c) => ({ key: c.key, label: c.label, kind: c.kind, notes: notes(c.notes), archived: c.archived, sortOrder: c.sortOrder })),
      products: bundle.products.map((p) => ({ key: p.key, carrierKey: p.carrierKey, name: p.name, details: o.includeProductDetails ? p.details : "", notes: notes(p.notes), archived: p.archived })),
      knowledge: bundle.knowledge
        .filter((k) => !k.applicable || k.summary.trim() || k.checklist.length || k.resources.length || (o.includeNotes && k.notes.trim()))
        .map((k) => ({
          carrierKey: k.carrierKey,
          productKey: k.productKey,
          categoryId: k.categoryId,
          applicable: k.applicable,
          summary: k.summary,
          checklist: k.checklist.map((c) => ({ text: c.text })),
          resources: k.resources.map((r) => ({ label: r.label, url: r.url })),
          notes: notes(k.notes),
        })),
      docket: bundle.docket.map((c) => ({ key: c.key, title: c.title, response: o.includeDocketResponses ? c.response : "", notes: notes(c.notes), archived: c.archived, sortOrder: c.sortOrder })),
      courses: bundle.courses.filter((c) => !c.archived).map((c) => ({ key: c.key, name: c.name, kind: c.kind, carrierKey: c.carrierKey })),
      rapportCards: o.includeRapportLibrary ? bundle.rapportCards.map((c) => ({ kind: c.kind, title: c.title, body: c.body, scenarioKey: c.scenarioKey })) : [],
      script: o.includeScript && script && revision ? { title: script.title, sections: revision.sections.map((s) => ({ ...s })) } : null,
    },
  };
}

/** Rows for a new map created from a starter. Groups the starter leaves out are seeded from the content packs afterwards. */
export function starterRows(starter: StarterMap, registry: ContentRegistry, instanceId: string, at: string, newId: () => string): NonNullable<ChangeSet["put"]> {
  const c = starter.curriculum;
  const categoryIds = new Set(registry.seeds.knowledgeCategories.map((k) => k.id));
  const scenarioIds = new Set(registry.seeds.rapportScenarios.map((s) => s.id));
  const put: NonNullable<ChangeSet["put"]> = {
    carriers: c.carriers.map((x) => ({ id: rowKey(instanceId, x.key), instanceId, key: x.key, label: x.label, kind: x.kind, notes: x.notes, archived: x.archived, sortOrder: x.sortOrder, createdAt: at, updatedAt: at })),
    products: c.products.map((p) => ({
      id: rowKey(instanceId, p.key),
      instanceId,
      key: p.key,
      carrierKey: p.carrierKey,
      name: p.name,
      details: p.details,
      notes: p.notes,
      // Verification is personal: you check imported details yourself.
      status: p.details.trim() ? "draft" : "empty",
      verifiedOn: null,
      archived: p.archived,
      createdAt: at,
      updatedAt: at,
    })),
    knowledge: c.knowledge
      .filter((k) => categoryIds.has(k.categoryId))
      .map((k) => {
        const subject = { carrierKey: k.carrierKey, productKey: k.productKey, categoryId: k.categoryId };
        return {
          id: knowledgeId(instanceId, subject),
          instanceId,
          ...subject,
          applicable: k.applicable,
          summary: k.summary,
          checklist: k.checklist.map((x) => ({ id: newId(), text: x.text, done: false })),
          notes: k.notes,
          resources: k.resources.map((r) => ({ id: newId(), ...r })),
          lastReviewedOn: null,
          explainedWithoutNotes: false,
          peakLevel: 0,
          updatedAt: at,
        };
      }),
    docket: c.docket.map((d) => ({ id: rowKey(instanceId, d.key), instanceId, key: d.key, title: d.title, response: d.response, notes: d.notes, scriptSectionId: null, archived: d.archived, sortOrder: d.sortOrder, createdAt: at, updatedAt: at })),
    courses: c.courses.map((x) => ({ id: rowKey(instanceId, x.key), instanceId, key: x.key, name: x.name, kind: x.kind, carrierKey: x.carrierKey, targetSeconds: null, targetSetOn: null, archived: false, createdAt: at })),
    rapportCards: c.rapportCards.map((r) => ({ id: newId(), instanceId, kind: r.kind, title: r.title, body: r.body, scenarioKey: r.scenarioKey && scenarioIds.has(r.scenarioKey) ? r.scenarioKey : null, createdAt: at, updatedAt: at })),
  };
  if (c.script) {
    const scriptId = newId();
    const revisionId = newId();
    put.scripts = [{ id: scriptId, instanceId, title: c.script.title, currentRevisionId: revisionId, createdAt: at, updatedAt: at }];
    put.scriptRevisions = [{ id: revisionId, instanceId, scriptId, parentId: null, createdAt: at, updatedAt: at, sections: c.script.sections.map((s) => ({ ...s })) }];
  }
  return put;
}
