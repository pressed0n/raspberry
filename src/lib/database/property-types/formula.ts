import { asText, collator, compareNullable, matchesDate, matchesNumber, matchesText, type PropertyTypeSpec } from "./shared";
import type { CellValue } from "../types";
import { formulaText, isFormulaDate, type FormulaValue } from "../formula/values";

/**
 * Formula — "can take other properties to do math", per the wishlist.
 * ---------------------------------------------------------------------------
 * The expression is **data**. `config.expression` is a string that is tokenised and
 * parsed by `lib/database/formula`, evaluated against the row's other cells, and never
 * handed to `eval` or `new Function`: a formula is user input of the most arbitrary
 * kind, and the only safe reading of it is through a parser this codebase owns.
 *
 * `derived: true` means the value is never stored: there is no `database_cells` row for
 * a formula property, a write to one is refused, and the value in a payload is put
 * there by `applyFormulas` on the read path.
 *
 * What this file decides is the *type* question — how a computed value is emptied,
 * compared, sorted, filtered, formatted and aggregated — so every view can render a
 * formula column without knowing that it is one.
 */

interface FormulaConfig { expression?: string }

/* The computed value is whatever the evaluator produced: a number, a string, a
   checkbox, a date record or a list. Nothing here re-interprets it, which is why a
   formula that returns `{start: "2026-10-30"}` sorts and filters exactly like a Date
   column — it *is* one, in the shape the date spec already understands. */
const asValue = (value: CellValue): FormulaValue => value as FormulaValue;
const isBlank = (value: CellValue): boolean => {
  const raw = asValue(value);
  return raw === null || raw === "" || (Array.isArray(raw) && raw.length === 0);
};

/** One order across mixed results: numbers, then dates, then checkboxes, then text,
 *  then lists. A column whose formula returns a number for some rows and text for
 *  others has to sort *somehow*, and grouping by kind is the only stable answer. */
const KIND: Record<string, number> = { number: 0, date: 1, checkbox: 2, text: 3, list: 4, object: 5, error: 6 };

function kindOf(value: FormulaValue): string {
  if (isFormulaDate(value)) return "date";
  if (Array.isArray(value)) return "list";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "checkbox";
  if (typeof value === "string") return "text";
  return "object";
}

function order(left: FormulaValue, right: FormulaValue): number {
  const leftKind = kindOf(left);
  const rightKind = kindOf(right);
  if (leftKind !== rightKind) return KIND[leftKind] - KIND[rightKind];
  if (leftKind === "number") return (left as number) - (right as number);
  if (leftKind === "date") {
    const a = (left as { start: string }).start;
    const b = (right as { start: string }).start;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (leftKind === "checkbox") return Number(left) - Number(right);
  return collator.compare(formulaText(left), formulaText(right));
}

export const formulaProperty: PropertyTypeSpec<FormulaConfig> = {
  type: "formula",
  label: "Formula",
  derived: true,
  empty: () => null,
  /* A computed value is never written, so this is reached only by an import or a type
     change. Anything that is not a scalar result reads as empty rather than as a
     half-converted shape the formatter cannot print. */
  coerce: (raw) => {
    if (typeof raw === "number" || typeof raw === "string" || typeof raw === "boolean") return raw;
    return null;
  },
  isEmpty: (value) => isBlank(value),
  /* An empty result sorts last, like every other type: `compareNullable` owns that rule
     and a second copy of it here would eventually disagree. */
  compare: (a, b) => compareNullable(
    isBlank(a) ? null : asValue(a),
    isBlank(b) ? null : asValue(b),
    order,
  ),
  format: (value) => formulaText(asValue(value)),
  fits: (operator, value, operand) => {
    const raw = asValue(value);
    if (operator === "isEmpty") return isBlank(value);
    if (operator === "isNotEmpty") return !isBlank(value);
    if (typeof raw === "number") return matchesNumber(operator, raw, operand);
    if (isFormulaDate(raw)) return matchesDate(operator, raw as unknown as CellValue, operand);
    if (typeof raw === "boolean") {
      const probe = asText(operand as CellValue).trim().toLowerCase();
      const wanted = ["true", "yes", "1", "checked"].includes(probe);
      return operator === "is" || operator === "equals" ? raw === wanted : raw !== wanted;
    }
    return matchesText(operator, formulaText(raw), operand);
  },
  aggregates: ["count", "sum", "average", "min", "max", "unique"],
};
