import { integerArg, listArg, type Arg, type FormulaFunction } from "../calls";
import { instantOf } from "../dates";
import { collator } from "../../property-types/shared";
import { isFormulaDate, formulaText, valuesEqual, type FormulaValue } from "../values";

/**
 * List.
 * ---------------------------------------------------------------------------
 * The non-lambda half of Notion's List category. `map`/`filter`/`find` are absent and
 * are not pretending to exist: they take a *formula* as an argument, which is a second
 * grammar (scoped arguments, implicit scope) and a much larger decision than one
 * category. What is here is what can be answered without one.
 */

const byValue = (left: FormulaValue, right: FormulaValue): number => {
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (isFormulaDate(left) && isFormulaDate(right)) {
    return (instantOf(left)?.getTime() ?? 0) - (instantOf(right)?.getTime() ?? 0);
  }
  return collator.compare(formulaText(left), formulaText(right));
};

/** A list index, with a negative index counting back from the end. */
const indexOf = (list: FormulaValue[], raw: number): number => (raw < 0 ? list.length + raw : raw);

export const listFunctions: FormulaFunction[] = [
  {
    name: "first",
    category: "List",
    signature: "first(list)",
    summary: "The first item of a list.",
    examples: [
      { code: 'first(["a", "b"])', result: "a" },
      { code: "first([])" },
    ],
    min: 1,
    max: 1,
    run: (args) => listArg(args, 0, "first")[0] ?? null,
  },
  {
    name: "last",
    category: "List",
    signature: "last(list)",
    summary: "The last item of a list.",
    examples: [{ code: 'last(["a", "b"])', result: "b" }],
    min: 1,
    max: 1,
    run: (args) => {
      const list = listArg(args, 0, "last");
      return list.length ? list[list.length - 1] : null;
    },
  },
  {
    name: "at",
    category: "List",
    signature: "at(list, index)",
    summary: "The item at an index, counting from 0. A negative index counts back from the end.",
    examples: [
      { code: 'at(["a", "b", "c"], 1)', result: "b" },
      { code: 'at(["a", "b", "c"], -1)', result: "c" },
    ],
    min: 2,
    max: 2,
    run: (args) => {
      const list = listArg(args, 0, "at");
      return list[indexOf(list, integerArg(args, 1, "at"))] ?? null;
    },
  },
  {
    name: "includes",
    category: "List",
    signature: "includes(list, value)",
    summary: "True when the list holds the value.",
    examples: [
      { code: 'includes(["a", "b"], "b")', result: "Yes" },
      { code: 'includes(["a", "b"], "c")', result: "No" },
    ],
    min: 2,
    max: 2,
    run: (args) => {
      const list = listArg(args, 0, "includes");
      const probe = args[1]();
      return list.some((item) => valuesEqual(item, probe) || formulaText(item) === formulaText(probe));
    },
  },
  {
    name: "slice",
    category: "List",
    signature: "slice(list, start, end?)",
    summary: "A piece of a list, from the start index up to but not including the end index.",
    examples: [{ code: 'slice(["a", "b", "c", "d"], 1, 3)', result: "b, c" }],
    min: 2,
    max: 3,
    run: (args) => {
      const list = listArg(args, 0, "slice");
      const start = indexOf(list, integerArg(args, 1, "slice"));
      const end = args.length > 2 ? indexOf(list, integerArg(args, 2, "slice")) : list.length;
      return list.slice(Math.max(0, start), Math.max(0, end));
    },
  },
  {
    name: "sort",
    category: "List",
    signature: "sort(list)",
    summary: "The list in order: numbers by size, dates by day, anything else alphabetically.",
    examples: [{ code: 'sort([3, 1, 2])', result: "1, 2, 3" }],
    min: 1,
    max: 1,
    run: (args) => [...listArg(args, 0, "sort")].sort(byValue),
  },
  {
    name: "reverse",
    category: "List",
    signature: "reverse(list)",
    summary: "The list in the opposite order.",
    examples: [{ code: 'reverse(["a", "b"])', result: "b, a" }],
    min: 1,
    max: 1,
    run: (args) => [...listArg(args, 0, "reverse")].reverse(),
  },
  {
    name: "unique",
    category: "List",
    signature: "unique(list)",
    summary: "The list with repeats removed, keeping the order things first appeared in.",
    examples: [{ code: 'unique(["a", "b", "a"])', result: "a, b" }],
    min: 1,
    max: 1,
    run: (args) => {
      const seen = new Set<string>();
      const kept: FormulaValue[] = [];
      for (const item of listArg(args, 0, "unique")) {
        const key = `${typeof item}:${formulaText(item)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        kept.push(item);
      }
      return kept;
    },
  },
];
