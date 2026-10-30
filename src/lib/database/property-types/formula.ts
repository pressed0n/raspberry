import { asNumber, compareNullable, matchesNumber, type PropertyTypeSpec } from "./shared";
import type { CellValue } from "../types";

/**
 * Formula — "can take other properties to do math", per the wishlist.
 * ---------------------------------------------------------------------------
 * The expression is **data**. `config.expression` is a string that gets parsed into
 * an AST and evaluated against the row's other cells. Nothing here is ever passed to
 * `eval` or `new Function`, and nothing ever will be: a formula is user input of the
 * most arbitrary kind, and the only safe reading of it is through a parser this
 * codebase owns.
 *
 * B39 settles the *type* — how a computed value is emptied, compared, formatted,
 * filtered and aggregated, so every view can already handle a formula column.
 * The parser, dependency graph and evaluator are B44 and land in `formula.ts`
 * beside this file. Until then a formula cell reads as empty, which is the truthful
 * rendering of "this expression has not been evaluated yet".
 *
 * `derived: true` means the value is never stored: there is no `database_cells` row
 * for a formula property, and a write to one is a bug, not a value.
 */

interface FormulaConfig { expression?: string }

const computed = (value: CellValue): number | null => asNumber(value);

export const formulaProperty: PropertyTypeSpec<FormulaConfig> = {
  type: "formula",
  label: "Formula",
  derived: true,
  empty: () => null,
  /* A formula *result* is a number. Strings are accepted and parsed so that a
     pasted "42" from an export does not silently become empty. */
  coerce: (raw) => asNumber(raw as CellValue),
  isEmpty: (value) => computed(value) === null,
  compare: (a, b) => compareNullable(computed(a), computed(b), (left, right) => left - right),
  format: (value) => {
    const result = computed(value);
    if (result === null) return "";
    /* No grouping or currency here: those belong to the number type's display
       config, and a formula has no such config of its own. */
    return Number.isInteger(result) ? String(result) : String(Number(result.toFixed(6)));
  },
  fits: (operator, value, operand) => matchesNumber(operator, value, operand),
  aggregates: ["count", "sum", "average", "min", "max", "unique"],
};
