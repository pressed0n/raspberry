import { dateText } from "./dates";

/**
 * What a formula can hold.
 * ---------------------------------------------------------------------------
 * Six shapes and no more. Every one of them is JSON, because a computed cell is
 * stored in the payload the browser already reads (`row.cells[id]`) and is *never*
 * written to `database_cells` — a formula is derived, so its value has to survive
 * `JSON.stringify` and nothing more exotic than that.
 *
 *   null      no output — the truthful rendering of "this expression says nothing"
 *   number    arithmetic and aggregation
 *   string    text
 *   boolean   a checkbox result
 *   date      the *same* record a Date column stores (`{ start, end? }`), so a
 *             formula result can be sorted, filtered and formatted by machinery
 *             that already exists rather than by a second date implementation
 *   list      a List result — the only composite, and the only one whose display
 *             is a sentence (`a, b, c`) rather than a single value
 *
 * One pseudo-shape sits beside them: `{ __error: "..." }`. A formula that cannot be
 * evaluated for *this row* is not the same thing as an empty one — divide by zero
 * happens per row — so the failure rides in the cell instead of in a column-wide
 * flag that would have to be kept somewhere else.
 *
 * Rich text is deliberately absent. `style()`/`link()` exist so a Notion formula
 * does not fail on import, and both return plain text: a cell here has one font.
 */

export interface FormulaDate { start: string; end?: string }
export interface FormulaObject { [key: string]: FormulaValue }
export interface FormulaError { __error: string }

export type FormulaValue = null | number | string | boolean | FormulaDate | FormulaObject | FormulaValue[] | FormulaError;

/** The type badge the editor shows under the preview. */
export type FormulaTypeName = "number" | "text" | "checkbox" | "date" | "list" | "object" | "error" | "unknown";

/** A string a formula may build. One `repeat("a", 1e9)` would otherwise take the tab
 *  with it, and a cell is 200px wide: nothing past this is readable anywhere the value
 *  is used. Functions that grow text check it and fail with a sentence instead. */
export const MAX_TEXT = 10_000;

export function formulaError(message: string): FormulaError {
  return { __error: message };
}

export function isFormulaError(value: unknown): value is FormulaError {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && typeof (value as FormulaError).__error === "string";
}

export function isFormulaDate(value: unknown): value is FormulaDate {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && typeof (value as FormulaDate).start === "string";
}

export function isListValue(value: unknown): value is FormulaValue[] {
  return Array.isArray(value);
}

export function formulaTypeName(value: FormulaValue): FormulaTypeName {
  if (value === null) return "unknown";
  if (isFormulaError(value)) return "error";
  if (Array.isArray(value)) return "list";
  switch (typeof value) {
    case "number": return "number";
    case "string": return "text";
    case "boolean": return "checkbox";
    default: return isFormulaDate(value) ? "date" : "object";
  }
}

/** How a cell would print this value — and therefore what `format()` returns, so a
 *  formula that builds a sentence matches the table it is read in. */
export function formulaText(value: FormulaValue): string {
  if (value === null) return "";
  if (isFormulaError(value)) return value.__error;
  if (Array.isArray(value)) return value.map(formulaText).join(", ");
  switch (typeof value) {
    case "number": return numberText(value);
    case "string": return value;
    case "boolean": return value ? "Yes" : "No";
    default:
      if (isFormulaDate(value)) return dateText(value);
      try { return JSON.stringify(value); } catch { return ""; }
  }
}

/** Integers print as integers; everything else stops at six decimals. `0.1 + 0.2`
 *  has to read `0.3` in a cell — the alternative is a number column that looks
 *  broken to anyone who ever divided something. */
export function numberText(value: number): string {
  if (!Number.isFinite(value)) return value > 0 ? "∞" : Number.isNaN(value) ? "NaN" : "-∞";
  if (Number.isInteger(value)) return String(value === 0 ? 0 : value);
  return String(Number(value.toFixed(6)));
}

/** What "if" means here. An empty string and an empty list are false — the same rule
 *  `empty()` uses — because a formula that builds text usually ends up testing it. */
export function truthy(value: FormulaValue): boolean {
  if (value === null) return false;
  if (isFormulaError(value)) return false;
  if (Array.isArray(value)) return value.length > 0;
  switch (typeof value) {
    case "boolean": return value;
    case "number": return value !== 0 && !Number.isNaN(value);
    case "string": return value !== "";
    default: return isFormulaDate(value) ? true : Object.keys(value).length > 0;
  }
}

export function valuesEqual(left: FormulaValue, right: FormulaValue): boolean {
  if (left === null || right === null) return left === right;
  if (isFormulaDate(left) && isFormulaDate(right)) return left.start === right.start && (left.end ?? "") === (right.end ?? "");
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => valuesEqual(item, right[index]));
  }
  /* A checkbox and a number are never equal, whatever `==` would say, because the
     cell they print into says `Yes` and `1`. */
  return typeof left === typeof right && left === right;
}

/** How a value is named inside an error sentence: `add() expected a number, but got
 *  the text "two"` is actionable; `expected number` is not. */
export function describeValue(value: FormulaValue): string {
  if (value === null) return "nothing";
  if (isFormulaError(value)) return "an error";
  if (Array.isArray(value)) return `a list of ${value.length}`;
  switch (typeof value) {
    case "number": return `the number ${numberText(value)}`;
    case "string": return `the text ${JSON.stringify(value.length > 24 ? `${value.slice(0, 24)}…` : value)}`;
    case "boolean": return value ? "true" : "false";
    default: return isFormulaDate(value) ? "a date" : "an object";
  }
}
