import { FormulaFailure } from "./errors";
import { floatingOf, instantOf, parseDateText, unitFrom, type FormulaUnit } from "./dates";
import { describeValue, formulaText, isFormulaDate, isFormulaError, type FormulaDate, type FormulaValue } from "./values";

/**
 * The plumbing every function in this language shares.
 * ---------------------------------------------------------------------------
 * A function receives its arguments as **thunks**, not values. That is not a
 * performance trick: `if(false, 1 / 0, 2)` has to answer `2`, and `and(x, missing)`
 * has to stop at `x` when it is already false. Eager arguments would make the
 * language's most common guards unusable, and a language whose `if` cannot guard is
 * a language where every formula has to check everything twice.
 *
 * The argument readers below exist so that forty functions do not each invent their
 * own sentence for "that isn't a number". One rule, one wording, and a formula's
 * error tells you which argument and what it actually was:
 *
 *   add() expected a number as argument 2, but got the text "two".
 */

export type Arg = () => FormulaValue;

export type FormulaCategory = "General" | "Text" | "Number" | "Date" | "List";

export interface CallContext {
  /** One clock reading per evaluation, so `now()` is the same instant everywhere in a
   *  formula — `dateBetween(now(), now(), "seconds")` is 0, not sometimes 1. */
  now: Date;
  /** `prop("Name")` — read against the row being evaluated, in the shape the other
   *  functions understand: text for a text column, a list for a multi-select, a date
   *  record for a date column. Resolution lives with the row, not with the language. */
  property: (name: string) => FormulaValue;
}

export interface FormulaFunction {
  /** The name as it is typed, and as the catalogue lists it. */
  name: string;
  /** Other spellings the evaluator resolves to this function, e.g. `Date.now`. */
  aka?: string[];
  category: FormulaCategory;
  /** What the editor's detail pane prints above the summary. */
  signature: string;
  summary: string;
  /** Each example is *executed by the test suite* against `result`, so documentation
   *  that drifts from the implementation fails the build instead of the user's day.
   *  `fails: true` marks the examples that are supposed to fail — the divide-by-zero
   *  case is worth showing, and it must keep failing. */
  examples: Array<{ code: string; result?: string; fails?: boolean }>;
  min: number;
  /** Missing means variadic. */
  max?: number;
  run: (args: Arg[], context: CallContext) => FormulaValue;
}

function label(name: string, index: number): string {
  return `${name}() argument ${index + 1}`;
}

/** Numbers accept numeric text, because a text cell holding `"42"` is a number
 *  someone forgot to put in a number column, not a mistake to punish. */
export function numberArg(args: Arg[], index: number, name: string): number {
  const value = args[index]();
  if (isFormulaError(value)) throw new FormulaFailure(value.__error);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new FormulaFailure(`${label(name, index)} should be a number, but it is ${describeValue(value)}.`);
}

export function numberOrNull(args: Arg[], index: number, name: string): number | null {
  if (args[index]() === null) return null;
  return numberArg(args, index, name);
}

export function integerArg(args: Arg[], index: number, name: string): number {
  return Math.trunc(numberArg(args, index, name));
}

/** Text is read as it prints — a number, a checkbox and a date all have a spelling,
 *  and a formula that builds a sentence should not need `format()` around every part. */
export function textArg(args: Arg[], index: number, name: string): string {
  const value = args[index]();
  if (isFormulaError(value)) throw new FormulaFailure(value.__error);
  if (typeof value === "string") return value;
  if (value === null) return "";
  if (Array.isArray(value) || isFormulaDate(value)) return formulaText(value);
  if (typeof value === "number" || typeof value === "boolean") return formulaText(value);
  throw new FormulaFailure(`${label(name, index)} should be text, but it is ${describeValue(value)}.`);
}

export function listArg(args: Arg[], index: number, name: string): FormulaValue[] {
  const value = args[index]();
  if (isFormulaError(value)) throw new FormulaFailure(value.__error);
  if (Array.isArray(value)) return value;
  if (value === null) return [];
  throw new FormulaFailure(`${label(name, index)} should be a list, but it is ${describeValue(value)}.`);
}

/** A date, or null when the cell is empty — `year()` on an empty Date column is a
 *  blank, not a red cell, and a table with one missing date should not fail. */
export function dateOrNull(args: Arg[], index: number, name: string): FormulaDate | null {
  const value = args[index]();
  if (isFormulaError(value)) throw new FormulaFailure(value.__error);
  if (value === null) return null;
  if (isFormulaDate(value)) return value;
  if (typeof value === "string") {
    const parsed = parseDateText(value);
    if (parsed) return { start: parsed };
  }
  if (typeof value === "number") return { start: floatingOf(new Date(value)) };
  throw new FormulaFailure(`${label(name, index)} should be a date, but it is ${describeValue(value)}.`);
}

export function unitArg(args: Arg[], index: number, name: string): FormulaUnit {
  const raw = textArg(args, index, name);
  const unit = unitFrom(raw);
  if (!unit) {
    throw new FormulaFailure(
      `${label(name, index)} should be a unit of time ("days", "weeks", "months"…), but it is ${JSON.stringify(raw)}.`,
    );
  }
  return unit;
}

/** Guard for the functions that can grow a string: a cell is 220px wide and one
 *  `repeat("a", 1e9)` would otherwise take the tab with it. */
export function capText(text: string, name: string): string {
  if (text.length > 10_000) throw new FormulaFailure(`${name}() would build ${text.length} characters, which is past the 10,000 a cell can use.`);
  return text;
}

/** The moment a date names, for a function that must fail rather than answer wrongly. */
export function requireInstant(value: FormulaDate, name: string): Date {
  const at = instantOf(value);
  if (!at) throw new FormulaFailure(`${name}() was given a date that does not exist (${JSON.stringify(value.start)}).`);
  return at;
}

/** Numbers arriving as one list or as many arguments, which is how `sum` can be
 *  written both `sum(prop("A"), prop("B"))` and `sum(prop("Tags"))`. */
export function numberList(args: Arg[], name: string): number[] {
  const values: number[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]();
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === null) continue;
        if (typeof item === "number" && Number.isFinite(item)) values.push(item);
        else if (typeof item === "string" && item.trim() !== "" && Number.isFinite(Number(item))) values.push(Number(item));
        else throw new FormulaFailure(`${name}() found ${describeValue(item)} in a list of numbers.`);
      }
      continue;
    }
    if (value === null) continue;
    values.push(numberArg(args, index, name));
  }
  return values;
}
