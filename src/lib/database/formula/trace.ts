import { compileFormula, type Node } from "./parse";
import { createContext, evaluate } from "./evaluate";
import { formulaText, formulaTypeName, type FormulaTypeName } from "./values";
import type { PropertyDef, RowDef } from "../types";

/**
 * Debug mode.
 * ---------------------------------------------------------------------------
 * The evaluator records each node's value as it produces it, so what this shows is not
 * a second opinion about the formula — it is the values the cell was built from, in the
 * order they were computed, with `let`'s bindings in force.
 *
 * Nodes come back leaves-first (a parent is recorded after its children), which is why
 * the editor reverses them for display: reading `2 + 3` before `let(total, 2 + 3, …)`
 * is reading the answer before the question.
 */

export interface FormulaTrace {
  /** The piece of formula this value belongs to, from the tree rather than the source,
   *  so a value is never matched to the wrong characters. */
  label: string;
  type: FormulaTypeName;
  text: string;
  /** How deep in the tree — the editor indents by this. */
  depth: number;
}

const LABEL_LIMIT = 72;

function label(node: Node): string {
  const cut = (text: string) => (text.length > LABEL_LIMIT ? `${text.slice(0, LABEL_LIMIT - 1)}…` : text);
  switch (node.kind) {
    case "number": return String(node.value);
    case "string": return JSON.stringify(node.value);
    case "boolean": return String(node.value);
    case "name": return node.name;
    case "list": return cut(`[${node.items.map(label).join(", ")}]`);
    case "object": return cut(`{${node.entries.map((entry) => `${entry.key}: ${label(entry.value)}`).join(", ")}}`);
    case "member": return cut(`${label(node.object)}.${node.name}`);
    case "unary": return cut(`${node.op}${label(node.value)}`);
    case "binary": return cut(`${label(node.left)} ${node.op} ${label(node.right)}`);
    case "call": {
      const name = node.callee.kind === "name"
        ? node.callee.name
        : node.callee.kind === "member" && node.callee.object.kind === "name"
          ? `${node.callee.object.name}.${node.callee.name}`
          : "…";
      return cut(`${name}(${node.args.map(label).join(", ")})`);
    }
  }
}

export function traceFormula(expression: string, row: RowDef, properties: PropertyDef[], now: Date = new Date()): FormulaTrace[] {
  const source = expression.trim();
  if (source === "") return [];
  const context = createContext(row, properties, now);
  context.trace = [];
  try {
    evaluate(compileFormula(source), context);
  } catch {
    /* The failure is the preview's to report; whatever did evaluate is still useful. */
  }
  return (context.trace ?? []).map((record) => ({
    label: label(record.node),
    type: formulaTypeName(record.value),
    text: formulaText(record.value),
    depth: record.depth,
  }));
}
