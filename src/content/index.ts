import { corePack } from "./packs/core";
import { finalExpensePack } from "./packs/finalExpense";
import { buildRegistryOrThrow, type ContentRegistry } from "./registry";

export const BUNDLED_PACKS = [corePack, finalExpensePack];

export function loadBundledRegistry(): ContentRegistry {
  return buildRegistryOrThrow(BUNDLED_PACKS);
}

export { CORE_SKILLS } from "./packs/core";
export * from "./registry";
export type * from "./schema";
