import type { ContentRegistry } from "../content/registry";
import type { CarrierRow, ChangeSet, CourseRow, DocketCaseRow, InstanceBundle, ScriptRevisionRow, ScriptRow } from "../persistence/types";
import { rowKey } from "./curriculum";

/**
 * The starting curriculum for a map, seeded per group. A group is seeded only
 * while its table is empty, so maps created by earlier versions pick up new
 * groups (docket, courses) the first time they load, and nothing is seeded twice.
 */

type Groups = Pick<InstanceBundle, "carriers" | "scripts" | "docket" | "courses">;

export function seedRows(registry: ContentRegistry, instanceId: string, at: string, newId: () => string, existing?: Groups): NonNullable<ChangeSet["put"]> {
  const put: NonNullable<ChangeSet["put"]> = {};
  if (!existing?.carriers.length) put.carriers = seedCarriers(registry, instanceId, at);
  if (!existing?.scripts.length) Object.assign(put, seedScript(registry, instanceId, at, newId));
  if (!existing?.docket.length) put.docket = seedDocket(registry, instanceId, at);
  if (!existing?.courses.length) put.courses = seedCourses(instanceId, at);
  return put;
}

export function needsSeeding(bundle: Groups): boolean {
  return !bundle.carriers.length || !bundle.scripts.length || !bundle.docket.length || !bundle.courses.length;
}

function seedCarriers(registry: ContentRegistry, instanceId: string, at: string): CarrierRow[] {
  return registry.seeds.carriers.map((c, i) => ({
    id: rowKey(instanceId, c.id),
    instanceId,
    key: c.id,
    label: c.label,
    kind: c.kind,
    notes: "",
    archived: false,
    sortOrder: i,
    createdAt: at,
    updatedAt: at,
  }));
}

function seedScript(registry: ContentRegistry, instanceId: string, at: string, newId: () => string): { scripts: ScriptRow[]; scriptRevisions: ScriptRevisionRow[] } {
  const template = registry.seeds.scriptTemplate ?? { title: "My script", sections: [{ id: "main", name: "Script", body: "" }] };
  const scriptId = newId();
  const revision: ScriptRevisionRow = {
    id: newId(),
    instanceId,
    scriptId,
    parentId: null,
    createdAt: at,
    updatedAt: at,
    sections: template.sections.map((s) => ({ ...s })),
  };
  return {
    scripts: [{ id: scriptId, instanceId, title: template.title, currentRevisionId: revision.id, createdAt: at, updatedAt: at }],
    scriptRevisions: [revision],
  };
}

/** Starter objections as editable cases with empty responses: the responses are yours to write. */
function seedDocket(registry: ContentRegistry, instanceId: string, at: string): DocketCaseRow[] {
  return registry.seeds.objectionCases.map((c, i) => ({
    id: rowKey(instanceId, c.id),
    instanceId,
    key: c.id,
    title: c.label,
    response: "",
    notes: "",
    scriptSectionId: null,
    archived: false,
    sortOrder: i,
    createdAt: at,
    updatedAt: at,
  }));
}

/** One starter course, so the Off the Line target has somewhere to live. */
function seedCourses(instanceId: string, at: string): CourseRow[] {
  return [
    {
      id: rowKey(instanceId, "course:full-script"),
      instanceId,
      key: "course:full-script",
      name: "Full script run",
      kind: "script",
      carrierKey: null,
      targetSeconds: null,
      targetSetOn: null,
      archived: false,
      createdAt: at,
    },
  ];
}
