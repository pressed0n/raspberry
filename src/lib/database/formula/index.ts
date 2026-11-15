import { FormulaSyntaxError } from "./errors";
import { compileFormula } from "./parse";
import { createContext, evaluate, expressionOf, valueOfProperty } from "./evaluate";
import { formulaError, formulaText, formulaTypeName, type FormulaTypeName, type FormulaValue } from "./values";
import type { CellValue, PropertyDef, RowDef } from "../types";

/**
 * The formula API, in one place.
 * ---------------------------------------------------------------------------
 * Three callers, three shapes, one implementation:
 *
 *   `applyFormulas`  the server's read path — every row's derived columns, once
 *   `runFormula`     one expression against one row, never throwing
 *   `previewFormula` the editor's "Preview with" strip — the same value plus the type
 *                    badge and, when it failed, *where*
 *
 * None of them can disagree with the cell, because the cell is `applyFormulas`'s own
 * output and the preview is the same `evaluate` over the same row.
 */

export { FUNCTIONS, CATEGORY_ORDER, findFunction } from "./functions";
export { formulaCatalog, flatCatalog, type CatalogEntry, type CatalogSection } from "./catalog";
export { compileFormula, parseFormula } from "./parse";
export { tokenize, type Token, type TokenKind } from "./tokenize";
export { paintFormula, type PaintSpan, type PaintKind } from "./paint";
export { suggestionAt, insertEntry, filterEntries, type Suggestion } from "./suggest";
export { expressionOf } from "./evaluate";
export { formulaText, formulaTypeName, isFormulaError, type FormulaValue, type FormulaTypeName } from "./values";
export { FormulaSyntaxError, FormulaFailure } from "./errors";
export { traceFormula, type FormulaTrace } from "./trace";

/** One expression against one row. A failure is a value, not an exception: the caller
 *  is rendering a table, and a thrown error would take the other 399 rows with it. */
export function runFormula(expression: string, row: RowDef, properties: PropertyDef[], now: Date = new Date()): FormulaValue {
  const source = expression.trim();
  if (source === "") return null;
  try {
    return evaluate(compileFormula(source), createContext(row, properties, now));
  } catch (error) {
    return formulaError(error instanceof Error ? error.message : String(error));
  }
}

export interface FormulaPreview {
  value: FormulaValue;
  type: FormulaTypeName;
  /** What the cell would print. */
  text: string;
  /** The sentence under the preview when the expression did not evaluate. */
  message: string | null;
  /** The character a *syntax* error points at, so the editor can underline it. */
  position: number | null;
}

export function previewFormula(expression: string, row: RowDef, properties: PropertyDef[], now: Date = new Date()): FormulaPreview {
  const source = expression.trim();
  if (source === "") return { value: null, type: "unknown", text: "", message: null, position: null };
  try {
    const value = evaluate(compileFormula(source), createContext(row, properties, now));
    return { value, type: formulaTypeName(value), text: formulaText(value), message: null, position: null };
  } catch (error) {
    if (error instanceof FormulaSyntaxError) {
      return { value: null, type: "unknown", text: "", message: error.message, position: error.position };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { value: formulaError(message), type: "error", text: "", message, position: null };
  }
}

/**
 * Fills every formula column in a row set.
 *
 * It writes into `row.cells` under the formula property's own id, which is what makes
 * the rest of the app work unchanged: `formatCell`, filters, sorts, groups and the MCP
 * export all read `cells[id]` and none of them needs to know a formula exists. Nothing
 * is persisted — `derived: true` means the write path refuses a value for one, and the
 * cell disappears again on the next read.
 */
export function applyFormulas(properties: PropertyDef[], rows: RowDef[], now: Date = new Date()): RowDef[] {
  const formulas = properties.filter((property) => property.type === "formula" && expressionOf(property).trim() !== "");
  if (formulas.length === 0) return rows;
  return rows.map((row) => {
    const context = createContext(row, properties, now);
    const cells: Record<string, CellValue> = { ...row.cells };
    let touched = false;
    for (const property of formulas) {
      let value: FormulaValue;
      try {
        value = valueOfProperty(property, context);
      } catch (error) {
        value = formulaError(error instanceof Error ? error.message : String(error));
      }
      if (value === null) {
        if (property.id in cells) { delete cells[property.id]; touched = true; }
        continue;
      }
      cells[property.id] = value as CellValue;
      touched = true;
    }
    return touched ? { ...row, cells } : row;
  });
}
