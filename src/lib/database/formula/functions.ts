import type { FormulaFunction, FormulaCategory } from "./calls";
import { generalFunctions } from "./functions/general";
import { textFunctions } from "./functions/text";
import { numberFunctions } from "./functions/number";
import { dateFunctions } from "./functions/date";
import { listFunctions } from "./functions/list";

/**
 * The one registry.
 * ---------------------------------------------------------------------------
 * The evaluator resolves a name here, the editor's catalogue is *generated* from here,
 * and the documentation pane reads its signature, summary and examples from here. A
 * function cannot be callable-but-undocumented or documented-but-uncallable, which is
 * the failure mode of a hand-written help page — and the examples are executed by the
 * test suite, so a summary that stops being true fails the build rather than the user.
 */

export const FUNCTIONS: FormulaFunction[] = [
  ...generalFunctions,
  ...textFunctions,
  ...numberFunctions,
  ...dateFunctions,
  ...listFunctions,
];

const BY_NAME = new Map<string, FormulaFunction>();
const BY_LOWER = new Map<string, FormulaFunction>();

for (const definition of FUNCTIONS) {
  for (const name of [definition.name, ...(definition.aka ?? [])]) {
    BY_NAME.set(name, definition);
    if (!BY_LOWER.has(name.toLowerCase())) BY_LOWER.set(name.toLowerCase(), definition);
  }
}

export function findFunction(name: string): FormulaFunction | null {
  return BY_NAME.get(name) ?? BY_LOWER.get(name.toLowerCase()) ?? null;
}

/** The order the catalogue lists categories in: the two that answer "which value" and
 *  "which condition" first, then the families people reach for by name. */
export const CATEGORY_ORDER: FormulaCategory[] = ["General", "Text", "Number", "Date", "List"];

export type { FormulaFunction, FormulaCategory };
