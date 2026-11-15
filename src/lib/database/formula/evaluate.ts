import { FormulaFailure } from "./errors";
import { callName, compileFormula, type Node } from "./parse";
import { findFunction } from "./functions";
import type { Arg } from "./calls";
import { asList, asNumber, asRecord, asText, optionById, optionIdsOf } from "../property-types/shared";
import { dateBounds } from "../property-types/date";
import { fileList } from "../property-types/files";
import { placeReading } from "../property-types/place";
import { primaryPropertyId, type CellValue, type PropertyDef, type RowDef } from "../types";
import { floatingOf, parseDateText } from "./dates";
import { formulaError, formulaText, isFormulaDate, type FormulaValue } from "./values";

/**
 * The tree walk.
 * ---------------------------------------------------------------------------
 * A formula is evaluated *per row*, against the values that row already carries — the
 * payload the table reads, never a second query. That is why this lives in `lib` and
 * not in a service: the server, the editor's preview and the tests all run this exact
 * function over an exact row, so the value in a cell and the value under "Preview with"
 * cannot be two different opinions about the same expression.
 *
 * Three things it refuses to do:
 *
 *   **No `eval`.** Nothing here builds code from the expression. The worst a formula
 *   can do is loop over its own arguments.
 *   **No silent failure.** A row that cannot be evaluated gets `{ __error }`, and the
 *   sentence names the argument and what it actually was.
 *   **No hidden columns.** `prop("Name")` reads the title, a formula may read another
 *   formula (memoised, with loop detection), and a `createdTime` reads the page's own
 *   timestamp — the three values that are not `database_cells` rows.
 */

export interface FormulaContext {
  row: RowDef;
  properties: PropertyDef[];
  now: Date;
  /** One value per formula property, so a column referenced twice is computed once. */
  cache: Map<string, FormulaValue>;
  /** Properties currently being evaluated — a formula that reads itself is a loop. */
  running: Set<string>;
  /** `let` and `lets` bindings, innermost last. */
  variables: Map<string, FormulaValue>;
  byLowerName: Map<string, PropertyDef>;
  /** Debug mode: when present, every node's value is appended as it is produced, in the
   *  order the evaluator saw them. Recorded by the evaluator itself rather than by a
   *  second walk, because a second walk would not have `let`'s bindings and would report
   *  a failure the real evaluation never had. */
  trace?: Array<{ node: Node; value: FormulaValue; depth: number }>;
  depth: number;
}

export function createContext(row: RowDef, properties: PropertyDef[], now: Date = new Date()): FormulaContext {
  const byLowerName = new Map<string, PropertyDef>();
  for (const property of properties) {
    byLowerName.set(property.name.toLowerCase(), property);
    if (property.id === primaryPropertyId) byLowerName.set("name", property);
  }
  return { row, properties, now, cache: new Map(), running: new Set(), variables: new Map(), byLowerName, depth: 0 };
}

/** The expression a formula property carries, normalised. */
export function expressionOf(property: Pick<PropertyDef, "config">): string {
  const raw = (property.config as { expression?: unknown } | undefined)?.expression;
  return typeof raw === "string" ? raw : "";
}

export function evaluate(node: Node, context: FormulaContext): FormulaValue {
  const depth = context.depth;
  context.depth += 1;
  let value: FormulaValue;
  try {
    value = evaluateNode(node, context);
  } finally {
    context.depth -= 1;
  }
  if (context.trace) context.trace.push({ node, value, depth });
  return value;
}

function evaluateNode(node: Node, context: FormulaContext): FormulaValue {
  switch (node.kind) {
    case "number":
    case "string":
    case "boolean":
      return node.value;
    case "list":
      return node.items.map((item) => evaluate(item, context));
    case "object": {
      const record: Record<string, FormulaValue> = {};
      for (const entry of node.entries) record[entry.key] = evaluate(entry.value, context);
      return record;
    }
    case "name": {
      if (context.variables.has(node.name)) return context.variables.get(node.name) ?? null;
      throw new FormulaFailure(
        `There is nothing called "${node.name}". A property has to be read with prop("${node.name}").`,
      );
    }
    case "member": {
      const object = evaluate(node.object, context);
      const record = asRecord(object as CellValue);
      if (!record) throw new FormulaFailure(`"${node.name}" was read from something that is not a group of values.`);
      return (record[node.name] as FormulaValue) ?? null;
    }
    case "unary": {
      const value = evaluate(node.value, context);
      if (node.op === "!") return !truthyOf(value);
      if (value === null) return null;
      if (typeof value === "number") return -value;
      const parsed = Number(formulaText(value).trim());
      if (Number.isFinite(parsed)) return -parsed;
      throw new FormulaFailure(`A minus sign needs a number, but it was given ${formulaText(value) || "nothing"}.`);
    }
    case "binary":
      return binary(node.op, evaluate(node.left, context), evaluate(node.right, context));
    case "call":
      return call(node, context);
  }
}

function truthyOf(value: FormulaValue): boolean {
  if (value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value !== "";
  if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
  if (typeof value === "boolean") return value;
  return isFormulaDate(value) ? true : Object.keys(value).length > 0;
}

/**
 * Operators are the arithmetic everyone already knows, with two deliberate refusals:
 * `"2" + 1` does not concatenate (that is what `concat()` is for, and `"2" + 1` being
 * `"21"` is the bug every JavaScript codebase has had at least once), and comparing a
 * date to text is an error rather than `false`.
 */
function binary(op: string, left: FormulaValue, right: FormulaValue): FormulaValue {
  switch (op) {
    case "&&": return truthyOf(left) && truthyOf(right);
    case "||": return truthyOf(left) || truthyOf(right);
    case "==": return valuesEqualish(left, right);
    case "!=": return !valuesEqualish(left, right);
  }
  if (op === "+" || op === "-" || op === "*" || op === "/" || op === "%") {
    /* An empty cell is *nothing*, not the wrong type: `prop("Price") * 2` on a row with no
       price reads blank, and a column of red sentences is not what a table wants from a
       formula that is working. Wrong *types* still fail — that is a real mistake. */
    if (left === null || right === null) return null;
    const a = asNumberLike(left, op);
    const b = asNumberLike(right, op);
    if ((op === "/" || op === "%") && b === 0) throw new FormulaFailure(`Can't divide by zero.`);
    switch (op) {
      case "+": return a + b;
      case "-": return a - b;
      case "*": return a * b;
      case "/": return a / b;
      default: {
        const remainder = a % b;
        return remainder < 0 ? remainder + Math.abs(b) : remainder;
      }
    }
  }
  /* An empty operand is false rather than an error: `prop("Due") > today()` on a row with no
     due date is a no, not a broken cell. */
  if (left === null || right === null) return false;
  const order = compareValues(left, right);
  if (order === null) {
    throw new FormulaFailure(`"${op}" needs two values of the same kind, but it was given ${formulaText(left) || "nothing"} and ${formulaText(right) || "nothing"}.`);
  }
  switch (op) {
    case ">": return order > 0;
    case ">=": return order >= 0;
    case "<": return order < 0;
    default: return order <= 0;
  }
}

function valuesEqualish(left: FormulaValue, right: FormulaValue): boolean {
  if (isFormulaDate(left) && isFormulaDate(right)) return left.start === right.start;
  if (left === null || right === null) return left === right;
  if (typeof left === "number" && typeof right === "string") return formulaText(left) === right;
  if (typeof left === "string" && typeof right === "number") return left === formulaText(right);
  if (Array.isArray(left) || Array.isArray(right)) return formulaText(left) === formulaText(right);
  return left === right;
}

function asNumberLike(value: FormulaValue, op: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  throw new FormulaFailure(`"${op}" needs numbers, but it was given ${formulaText(value) || "nothing"}.`);
}

function compareValues(left: FormulaValue, right: FormulaValue): number | null {
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (isFormulaDate(left) && isFormulaDate(right)) return left.start < right.start ? -1 : left.start > right.start ? 1 : 0;
  if (typeof left === "string" && typeof right === "string") return left < right ? -1 : left > right ? 1 : 0;
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  /* A date compared to the text of that date is a comparison people write; a text that
     is not a date at all is incomparable, and says so instead of answering false. */
  if (isFormulaDate(left) && typeof right === "string") {
    const written = parseDateText(right);
    return written === null ? null : compareValues(left, { start: written });
  }
  if (typeof left === "string" && isFormulaDate(right)) {
    const written = parseDateText(left);
    return written === null ? null : compareValues({ start: written }, right);
  }
  return null;
}

function call(node: Extract<Node, { kind: "call" }>, context: FormulaContext): FormulaValue {
  const name = callName(node.callee);
  if (!name) throw new FormulaFailure("Only a named function can be called.");

  /* The two special forms. `let` needs its first argument as a *name*, not a value,
     which is the one thing a normal function signature cannot express. */
  if (name === "let" || name.toLowerCase() === "let") return letForm(node.args, context);
  if (name === "lets" || name.toLowerCase() === "lets") return letsForm(node.args, context);

  const definition = findFunction(name);
  if (!definition) throw new FormulaFailure(`There is no function called ${name}().`);
  if (node.args.length < definition.min || (definition.max !== undefined && node.args.length > definition.max)) {
    const expected = definition.max === undefined ? `at least ${definition.min}` : definition.min === definition.max ? `${definition.min}` : `${definition.min} to ${definition.max}`;
    throw new FormulaFailure(`${definition.name}() takes ${expected} ${definition.min === 1 && definition.max === 1 ? "argument" : "arguments"}, but it was given ${node.args.length}.`);
  }

  const args: Arg[] = node.args.map((argument) => () => evaluate(argument, context));
  return definition.run(args, { now: context.now, property: (wanted) => propertyValue(wanted, context) });
}

function letForm(args: Node[], context: FormulaContext): FormulaValue {
  if (args.length !== 3) throw new FormulaFailure(`let() takes three arguments — a name, a value and the expression that uses it — but it was given ${args.length}.`);
  const [rawName, rawValue, rawBody] = args;
  if (rawName.kind !== "name") throw new FormulaFailure("The first argument of let() has to be a name, like let(total, 1, total + 1).");
  return withBindings(new Map([[rawName.name, evaluate(rawValue, context)]]), rawBody, context);
}

function letsForm(args: Node[], context: FormulaContext): FormulaValue {
  if (args.length !== 2) throw new FormulaFailure(`lets() takes a group of values and the expression that uses them, like lets({a: 1, b: 2}, a + b).`);
  const [rawObject, rawBody] = args;
  if (rawObject.kind !== "object") throw new FormulaFailure("The first argument of lets() has to be a group in braces, like {a: 1, b: 2}.");
  const bindings = new Map<string, FormulaValue>();
  for (const entry of rawObject.entries) bindings.set(entry.key, evaluate(entry.value, context));
  return withBindings(bindings, rawBody, context);
}

function withBindings(bindings: Map<string, FormulaValue>, body: Node, context: FormulaContext): FormulaValue {
  const saved = new Map(context.variables);
  for (const [name, value] of bindings) context.variables.set(name, value);
  try {
    return evaluate(body, context);
  } finally {
    context.variables = saved;
  }
}

/**
 * A property's value, in the shape the functions understand.
 *
 * Three properties are not cells: the title (a page's own name), a formula (computed,
 * memoised, loop-checked) and created time (the page's timestamp). Everything else is
 * read by its declared type, so a multi-select arrives as a list of *names* rather than
 * of option ids — a formula should not have to translate ids, and a formula that did
 * would break the moment an option was renamed.
 */
export function propertyValue(wanted: string, context: FormulaContext): FormulaValue {
  const property = context.byLowerName.get(wanted.toLowerCase());
  if (!property) throw new FormulaFailure(`There is no property called "${wanted}".`);
  return valueOfProperty(property, context);
}

/** The same read, given the property rather than its name — what the server's
 *  read path uses for the formula columns it already has in hand. */
export function valueOfProperty(property: PropertyDef, context: FormulaContext): FormulaValue {
  if (property.type === "formula") {
    if (context.cache.has(property.id)) return context.cache.get(property.id) ?? null;
    if (context.running.has(property.id)) throw new FormulaFailure(`The formula "${property.name}" depends on itself.`);
    const expression = expressionOf(property).trim();
    if (expression === "") return null;
    context.running.add(property.id);
    try {
      const result = evaluate(compileFormula(expression), context);
      context.cache.set(property.id, result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.cache.set(property.id, formulaError(message));
      return formulaError(message);
    } finally {
      context.running.delete(property.id);
    }
  }

  if (property.id === primaryPropertyId) return context.row.title;
  if (property.type === "createdTime") {
    const at = new Date(context.row.createdAt);
    return Number.isNaN(at.getTime()) ? null : { start: floatingOf(at) };
  }

  const raw = context.row.cells[property.id] ?? null;
  return cellValueAs(property, raw);
}

function cellValueAs(property: PropertyDef, raw: CellValue): FormulaValue {
  const config = property.config as Record<string, unknown> | undefined;
  switch (property.type) {
    case "number": {
      const value = asNumber(raw);
      return value === null ? null : value;
    }
    case "checkbox": return raw === true;
    case "date": {
      const bounds = dateBounds(raw);
      return bounds.start === null ? null : bounds.end ? { start: bounds.start, end: bounds.end } : { start: bounds.start };
    }
    case "select":
    case "status": {
      const id = asText(raw).trim();
      if (id === "") return null;
      return optionById(config, id)?.name ?? id;
    }
    case "multiSelect": {
      const names = optionIdsOf(raw, config).map((id) => optionById(config, id)?.name ?? id).filter((name) => name !== "");
      return names;
    }
    case "person": return asList(raw).map((entry) => {
      const record = asRecord(entry);
      return record ? asText(record.name ?? record.id) : asText(entry);
    });
    case "files": return fileList(raw).map((file) => file.name);
    case "place": return placeReading(raw).address;
    case "button": return null;
    default: return asText(raw);
  }
}
