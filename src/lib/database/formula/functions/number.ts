import { FormulaFailure } from "../errors";
import { integerArg, numberArg, numberList, numberOrNull, type Arg, type FormulaFunction } from "../calls";
import { isFormulaError, formulaText, type FormulaValue } from "../values";

/**
 * Number.
 * ---------------------------------------------------------------------------
 * Every function here refuses to divide by zero out loud, and `mod` follows the
 * arithmetic rule rather than JavaScript's: `mod(-1, 3)` is 2, because a formula
 * computing "days into the week" should not answer -1 for the day before Monday.
 *
 * `sum`, `min`, `max`, `mean` and `median` take both spellings — `sum(prop("A"), prop("B"))`
 * and `sum(prop("Amounts"))` — and skip empty cells rather than counting them as zero,
 * which is the difference between an average and a lie.
 */

function total(args: Arg[], name: string): number[] {
  const numbers = numberList(args, name);
  return numbers;
}

function unwrap(value: FormulaValue): FormulaValue {
  if (isFormulaError(value)) throw new FormulaFailure(value.__error);
  return value;
}

/** The pair form of every two-number function: an empty argument makes the result empty,
 *  which is the same rule the `+ - * / %` operators follow. One rule, so `add(prop("A"),
 *  prop("B"))` and `prop("A") + prop("B")` can never disagree about a row with no A. */
function pair(args: Arg[], name: string, run: (a: number, b: number) => FormulaValue): FormulaValue {
  const a = numberOrNull(args, 0, name);
  const b = numberOrNull(args, 1, name);
  return a === null || b === null ? null : run(a, b);
}

export const numberFunctions: FormulaFunction[] = [
  {
    name: "toNumber",
    category: "Number",
    signature: "toNumber(value)",
    summary: "Text as a number. Anything that is not a number gives an empty cell rather than an error.",
    examples: [
      { code: 'toNumber("42")', result: "42" },
      { code: 'toNumber("four")' },
    ],
    min: 1,
    max: 1,
    run: (args) => {
      const result = unwrap(args[0]());
      if (typeof result === "number") return Number.isFinite(result) ? result : null;
      if (result === null) return null;
      const parsed = Number(formulaText(result).trim());
      return Number.isFinite(parsed) ? parsed : null;
    },
  },
  {
    name: "formatNumber",
    category: "Number",
    signature: "formatNumber(value, decimals?)",
    summary: "A number as text with thousands separators, rounded to the number of decimals you ask for.",
    examples: [{ code: "formatNumber(1234.5678, 2)" }],
    min: 1,
    max: 2,
    run: (args) => {
      const value = numberArg(args, 0, "formatNumber");
      const decimals = args.length > 1 ? Math.max(0, Math.min(20, integerArg(args, 1, "formatNumber"))) : undefined;
      return new Intl.NumberFormat(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals ?? 3,
      }).format(value);
    },
  },
  {
    name: "add",
    category: "Number",
    signature: "add(a, b)",
    summary: "The sum of two numbers.",
    examples: [{ code: "add(2, 3)", result: "5" }],
    min: 2,
    max: 2,
    run: (args) => pair(args, "add", (a, b) => a + b),
  },
  {
    name: "subtract",
    category: "Number",
    signature: "subtract(a, b)",
    summary: "The first number minus the second.",
    examples: [{ code: "subtract(10, 4)", result: "6" }],
    min: 2,
    max: 2,
    run: (args) => pair(args, "subtract", (a, b) => a - b),
  },
  {
    name: "multiply",
    category: "Number",
    signature: "multiply(a, b)",
    summary: "The first number times the second.",
    examples: [{ code: "multiply(6, 7)", result: "42" }],
    min: 2,
    max: 2,
    run: (args) => pair(args, "multiply", (a, b) => a * b),
  },
  {
    name: "divide",
    category: "Number",
    signature: "divide(a, b)",
    summary: "The first number divided by the second.",
    examples: [
      { code: "divide(10, 4)", result: "2.5" },
      { code: "divide(1, 0)", fails: true },
    ],
    min: 2,
    max: 2,
    run: (args) => pair(args, "divide", (a, b) => {
      if (b === 0) throw new FormulaFailure("divide() can't divide by zero.");
      return a / b;
    }),
  },
  {
    name: "mod",
    category: "Number",
    signature: "mod(a, b)",
    summary: "The remainder after dividing, counted the arithmetic way: mod(-1, 3) is 2, not -1.",
    examples: [
      { code: "mod(7, 3)", result: "1" },
      { code: "mod(-1, 3)", result: "2" },
    ],
    min: 2,
    max: 2,
    run: (args) => pair(args, "mod", (a, b) => {
      if (b === 0) throw new FormulaFailure("mod() can't divide by zero.");
      const remainder = a % b;
      return remainder < 0 ? remainder + Math.abs(b) : remainder;
    }),
  },
  {
    name: "pow",
    category: "Number",
    signature: "pow(a, b)",
    summary: "The first number raised to the power of the second.",
    examples: [{ code: "pow(2, 10)", result: "1024" }],
    min: 2,
    max: 2,
    run: (args) => pair(args, "pow", (a, b) => a ** b),
  },
  {
    name: "min",
    category: "Number",
    signature: "min(a, b, …)",
    summary: "The smallest of the numbers, or of a list of them.",
    examples: [{ code: "min(4, 2, 9)", result: "2" }],
    min: 1,
    run: (args) => {
      const numbers = total(args, "min");
      return numbers.length ? Math.min(...numbers) : null;
    },
  },
  {
    name: "max",
    category: "Number",
    signature: "max(a, b, …)",
    summary: "The largest of the numbers, or of a list of them.",
    examples: [{ code: "max(4, 2, 9)", result: "9" }],
    min: 1,
    run: (args) => {
      const numbers = total(args, "max");
      return numbers.length ? Math.max(...numbers) : null;
    },
  },
  {
    name: "sum",
    category: "Number",
    signature: "sum(a, b, …)",
    summary: "Adds the numbers up, or all the numbers in a list. An empty column sums to 0.",
    examples: [{ code: "sum(1, 2, 3)", result: "6" }],
    min: 1,
    run: (args) => total(args, "sum").reduce((left, right) => left + right, 0),
  },
  {
    name: "mean",
    category: "Number",
    signature: "mean(a, b, …)",
    summary: "The average, ignoring empty cells. An empty column has no average.",
    examples: [{ code: "mean(2, 4, 6)", result: "4" }],
    min: 1,
    run: (args) => {
      const numbers = total(args, "mean");
      return numbers.length ? numbers.reduce((left, right) => left + right, 0) / numbers.length : null;
    },
  },
  {
    name: "median",
    category: "Number",
    signature: "median(a, b, …)",
    summary: "The middle number, or the average of the two middle numbers.",
    examples: [
      { code: "median(1, 3, 5)", result: "3" },
      { code: "median(1, 2, 3, 4)", result: "2.5" },
    ],
    min: 1,
    run: (args) => {
      const numbers = total(args, "median");
      if (!numbers.length) return null;
      const sorted = [...numbers].sort((left, right) => left - right);
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    },
  },
  {
    name: "abs",
    category: "Number",
    signature: "abs(number)",
    summary: "The number without its sign.",
    examples: [{ code: "abs(-5)", result: "5" }],
    min: 1,
    max: 1,
    run: (args) => Math.abs(numberArg(args, 0, "abs")),
  },
  {
    name: "round",
    category: "Number",
    signature: "round(number, decimals?)",
    summary: "Rounds to the nearest whole number, or to the number of decimals you ask for.",
    examples: [
      { code: "round(2.6)", result: "3" },
      { code: "round(2.345, 2)", result: "2.35" },
    ],
    min: 1,
    max: 2,
    run: (args) => {
      const value = numberArg(args, 0, "round");
      const decimals = args.length > 1 ? Math.max(0, Math.min(10, integerArg(args, 1, "round"))) : 0;
      const factor = 10 ** decimals;
      return Math.round(value * factor) / factor;
    },
  },
  {
    name: "ceil",
    category: "Number",
    signature: "ceil(number)",
    summary: "The next whole number up.",
    examples: [{ code: "ceil(2.1)", result: "3" }],
    min: 1,
    max: 1,
    run: (args) => Math.ceil(numberArg(args, 0, "ceil")),
  },
  {
    name: "floor",
    category: "Number",
    signature: "floor(number)",
    summary: "The next whole number down.",
    examples: [{ code: "floor(2.9)", result: "2" }],
    min: 1,
    max: 1,
    run: (args) => Math.floor(numberArg(args, 0, "floor")),
  },
  {
    name: "sqrt",
    category: "Number",
    signature: "sqrt(number)",
    summary: "The square root.",
    examples: [{ code: "sqrt(9)", result: "3" }],
    min: 1,
    max: 1,
    run: (args) => Math.sqrt(numberArg(args, 0, "sqrt")),
  },
  {
    name: "cbrt",
    category: "Number",
    signature: "cbrt(number)",
    summary: "The cube root.",
    examples: [{ code: "cbrt(27)", result: "3" }],
    min: 1,
    max: 1,
    run: (args) => Math.cbrt(numberArg(args, 0, "cbrt")),
  },
  {
    name: "exp",
    category: "Number",
    signature: "exp(number)",
    summary: "e raised to the power of the number.",
    examples: [{ code: "exp(0)", result: "1" }],
    min: 1,
    max: 1,
    run: (args) => Math.exp(numberArg(args, 0, "exp")),
  },
  {
    name: "ln",
    category: "Number",
    signature: "ln(number)",
    summary: "The natural logarithm.",
    examples: [{ code: "ln(1)", result: "0" }],
    min: 1,
    max: 1,
    run: (args) => Math.log(numberArg(args, 0, "ln")),
  },
  {
    name: "log10",
    category: "Number",
    signature: "log10(number)",
    summary: "The base-10 logarithm.",
    examples: [{ code: "log10(1000)", result: "3" }],
    min: 1,
    max: 1,
    run: (args) => Math.log10(numberArg(args, 0, "log10")),
  },
  {
    name: "log2",
    category: "Number",
    signature: "log2(number)",
    summary: "The base-2 logarithm.",
    examples: [{ code: "log2(8)", result: "3" }],
    min: 1,
    max: 1,
    run: (args) => Math.log2(numberArg(args, 0, "log2")),
  },
  {
    name: "sign",
    category: "Number",
    signature: "sign(number)",
    summary: "1 for a positive number, -1 for a negative one, 0 for zero.",
    examples: [
      { code: "sign(-3)", result: "-1" },
      { code: "sign(0)", result: "0" },
    ],
    min: 1,
    max: 1,
    run: (args) => Math.sign(numberArg(args, 0, "sign")),
  },
  {
    name: "pi",
    category: "Number",
    signature: "pi()",
    summary: "π, to the precision this machine has.",
    examples: [{ code: "round(pi(), 2)", result: "3.14" }],
    min: 0,
    max: 0,
    run: () => Math.PI,
  },
  {
    name: "e",
    category: "Number",
    signature: "e()",
    summary: "Euler's number, to the precision this machine has.",
    examples: [{ code: "round(e(), 2)", result: "2.72" }],
    min: 0,
    max: 0,
    run: () => Math.E,
  },
  {
    name: "unaryMinus",
    category: "Number",
    signature: "unaryMinus(number)",
    summary: "The number with its sign flipped — what the `-` in front of a value does.",
    examples: [{ code: "unaryMinus(5)", result: "-5" }],
    min: 1,
    max: 1,
    run: (args) => -numberArg(args, 0, "unaryMinus"),
  },
];
