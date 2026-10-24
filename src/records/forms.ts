import type { ActivityTypeDef, FieldDef } from "../content/schema";
import type { ActivityRow } from "../persistence/types";

/**
 * Turning form values into an engine record. Field definitions come from the
 * content pack, so a new activity type needs no new form code.
 */

export type FieldValues = Record<string, unknown>;

export function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

export function validateValues(type: ActivityTypeDef, values: FieldValues, mode: string | undefined): string[] {
  const errors: string[] = [];
  const modeKeys = Object.keys(type.modes);
  if (modeKeys.length > 0 && (mode === undefined || !modeKeys.includes(mode))) errors.push("Choose a mode.");

  for (const field of type.fields) {
    const value = values[field.key];
    if (isEmpty(value)) {
      if (field.required) errors.push(`${field.label} is required.`);
      continue;
    }
    const problem = checkField(field, value);
    if (problem) errors.push(problem);
  }
  if (type.unitsField !== undefined && !(Number(values[type.unitsField]) > 0)) {
    const label = type.fields.find((f) => f.key === type.unitsField)?.label ?? type.unitsField;
    errors.push(`${label} must be more than 0.`);
  }
  return [...new Set(errors)];
}

function checkField(field: FieldDef, value: unknown): string | null {
  switch (field.kind) {
    case "number":
    case "rating": {
      if (typeof value !== "number" || !Number.isFinite(value)) return `${field.label} must be a number.`;
      if (field.min !== undefined && value < field.min) return `${field.label} must be at least ${field.min}.`;
      if (field.max !== undefined && value > field.max) return `${field.label} must be at most ${field.max}.`;
      return null;
    }
    case "text":
    case "longtext":
    case "datetime": {
      if (typeof value !== "string") return `${field.label} must be text.`;
      if (field.minLength !== undefined && value.trim().length < field.minLength) {
        return `${field.label} needs at least ${field.minLength} characters.`;
      }
      return null;
    }
    case "select":
      if (typeof value !== "string") return `${field.label} must be one option.`;
      if (field.options && !field.options.includes(value)) return `${field.label} has an unknown option.`;
      return null;
    case "multiselect":
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) return `${field.label} must be a list.`;
      return null;
    case "boolean":
      return typeof value === "boolean" ? null : `${field.label} must be yes or no.`;
  }
}

export function unitsFor(type: ActivityTypeDef, values: FieldValues): number {
  return type.unitsField !== undefined ? Number(values[type.unitsField]) : 1;
}

/** Subject for per-subject limits and personal bests. Text is normalized so "Full script" = "full script ". */
export function subjectKeyFor(type: ActivityTypeDef, values: FieldValues): string | undefined {
  if (type.subjectFields.length === 0) return undefined;
  return type.subjectFields
    .map((key) => {
      const v = values[key];
      return typeof v === "string" ? v.trim().toLowerCase() : isEmpty(v) ? "" : String(v);
    })
    .join("|");
}

/**
 * A personal best is a clean run faster than every earlier clean run on the
 * same subject. The first run sets the mark but earns no bonus.
 */
export function isPersonalBest(type: ActivityTypeDef, values: FieldValues, earlier: ActivityRow[]): boolean {
  if (type.timeField === undefined || type.personalBestBonus <= 0) return false;
  const time = Number(values[type.timeField]);
  if (!(time > 0)) return false;
  if (type.cleanField !== undefined && values[type.cleanField] !== true) return false;

  const subject = subjectKeyFor(type, values);
  const priorTimes = earlier
    .filter((row) => row.status === "active" && row.typeId === type.id && subjectKeyFor(type, row.values) === subject)
    .filter((row) => type.cleanField === undefined || row.values[type.cleanField] === true)
    .map((row) => Number(row.values[type.timeField!]))
    .filter((t) => t > 0);
  return priorTimes.length > 0 && time < Math.min(...priorTimes);
}
