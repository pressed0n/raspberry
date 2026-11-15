import { FormulaFailure } from "../errors";
import { textArg, type Arg, type FormulaFunction } from "../calls";
import { formulaText, isFormulaError, truthy, valuesEqual, type FormulaValue } from "../values";

/**
 * General: conditions, comparisons and the two things every other category needs.
 * ---------------------------------------------------------------------------
 * `if`, `ifs`, `and`, `or` and `let` are **lazy** — they take thunks and call only the
 * branches they need. That is what makes `if(prop("Due"), dateBetween(now(), prop("Due"), "days"), 0)`
 * a formula a person can actually write: the guard has to run before the thing it
 * guards, or every row with an empty date turns red.
 */

function value(args: Arg[], index: number): FormulaValue {
  const result = args[index]();
  /* An error from a *reference* has to keep travelling: `equal(prop("Broken"), 1)`
     should say what broke, not answer "no". */
  if (isFormulaError(result)) throw new FormulaFailure(result.__error);
  return result;
}

export const generalFunctions: FormulaFunction[] = [
  {
    name: "if",
    category: "General",
    signature: "if(condition, then, else?)",
    summary: "The first value when the condition is true, the second when it is not. Leave the third out and a false condition gives an empty cell.",
    examples: [
      { code: 'if(2 > 1, "yes", "no")', result: "yes" },
      { code: "if(0, 10, 20)", result: "20" },
    ],
    min: 2,
    max: 3,
    run: (args) => (truthy(value(args, 0)) ? value(args, 1) : args.length > 2 ? value(args, 2) : null),
  },
  {
    name: "ifs",
    category: "General",
    signature: "ifs(condition, value, …, else?)",
    summary: "Reads pairs from the left and returns the value of the first true condition. An odd last argument is the fallback.",
    examples: [
      { code: 'ifs(1 > 2, "a", 2 > 1, "b")', result: "b" },
      { code: 'ifs(false, "a", false, "b", "fallback")', result: "fallback" },
    ],
    min: 2,
    run: (args) => {
      const paired = args.length % 2 === 0 ? args.length : args.length - 1;
      for (let index = 0; index < paired; index += 2) {
        if (truthy(value(args, index))) return value(args, index + 1);
      }
      return args.length % 2 === 0 ? null : value(args, args.length - 1);
    },
  },
  {
    name: "and",
    category: "General",
    signature: "and(condition, …)",
    summary: "True when every condition is true. Stops at the first false one.",
    examples: [
      { code: "and(true, 1 < 2)", result: "Yes" },
      { code: "and(true, false)", result: "No" },
    ],
    min: 1,
    run: (args) => {
      for (let index = 0; index < args.length; index += 1) if (!truthy(value(args, index))) return false;
      return true;
    },
  },
  {
    name: "or",
    category: "General",
    signature: "or(condition, …)",
    summary: "True when any condition is true. Stops at the first true one.",
    examples: [
      { code: "or(false, 1 > 2)", result: "No" },
      { code: 'or(false, "x" != "")', result: "Yes" },
    ],
    min: 1,
    run: (args) => {
      for (let index = 0; index < args.length; index += 1) if (truthy(value(args, index))) return true;
      return false;
    },
  },
  {
    name: "not",
    category: "General",
    signature: "not(condition)",
    summary: "The opposite of a condition.",
    examples: [
      { code: "not(true)", result: "No" },
      { code: "not (2 > 3)", result: "Yes" },
    ],
    min: 1,
    max: 1,
    run: (args) => !truthy(value(args, 0)),
  },
  {
    name: "empty",
    category: "General",
    signature: "empty(value)",
    summary: "True for an empty cell, an empty text and an empty list. A number is never empty, not even zero.",
    examples: [
      { code: 'empty("")', result: "Yes" },
      { code: "empty(0)", result: "No" },
      { code: "empty([])", result: "Yes" },
    ],
    min: 1,
    max: 1,
    run: (args) => {
      const result = value(args, 0);
      if (result === null || result === "") return true;
      return Array.isArray(result) && result.length === 0;
    },
  },
  {
    name: "length",
    category: "General",
    signature: "length(value)",
    summary: "How many characters a text has, or how many items a list has.",
    examples: [
      { code: 'length("hello")', result: "5" },
      { code: "length([1, 2, 3])", result: "3" },
    ],
    min: 1,
    max: 1,
    run: (args) => {
      const result = value(args, 0);
      if (result === null) return 0;
      if (Array.isArray(result)) return result.length;
      return formulaText(result).length;
    },
  },
  {
    name: "format",
    category: "General",
    signature: "format(value)",
    summary: "A value as the text it prints as — the same text the cell shows, so a formula can build the sentence a column would.",
    examples: [
      { code: "format(1234.5)", result: "1234.5" },
      { code: "format(true)", result: "Yes" },
    ],
    min: 1,
    max: 1,
    run: (args) => formulaText(value(args, 0)),
  },
  {
    name: "equal",
    category: "General",
    signature: "equal(a, b)",
    summary: "True when two values are the same. A checkbox is never equal to a number, whatever the text looks like.",
    examples: [
      { code: 'equal("a", "a")', result: "Yes" },
      { code: "equal(1, true)", result: "No" },
    ],
    min: 2,
    max: 2,
    run: (args) => valuesEqual(value(args, 0), value(args, 1)),
  },
  {
    name: "unequal",
    category: "General",
    signature: "unequal(a, b)",
    summary: "The opposite of equal().",
    examples: [
      { code: "unequal(1, 2)", result: "Yes" },
      { code: "unequal(1, 1)", result: "No" },
    ],
    min: 2,
    max: 2,
    run: (args) => !valuesEqual(value(args, 0), value(args, 1)),
  },
  {
    name: "prop",
    category: "General",
    signature: 'prop("Property")',
    summary: "The value of another property on the same page. The property list in this editor inserts this for you.",
    examples: [{ code: 'prop("Name")' }],
    min: 1,
    max: 1,
    run: (args, context) => context.property(textArg(args, 0, "prop")),
  },
];
