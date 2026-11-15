import { FormulaFailure } from "../errors";
import { capText, integerArg, textArg, type Arg, type FormulaFunction } from "../calls";
import { formulaText, isFormulaError, type FormulaValue } from "../values";

/**
 * Text.
 * ---------------------------------------------------------------------------
 * Every reader here goes through `textArg`, which renders *any* value the way the
 * cell would — so `concat("Due ", prop("When"))` reads "Due October 30, 2026" without
 * a `format()` in the middle, and `lower(prop("Code"))` works on a number column.
 *
 * Patterns are **regular expressions**, as they are in Notion, and accept the
 * `/pattern/flags` spelling so a case-insensitive match does not need its own
 * argument: `test(prop("Name"), "/^mr/i")`. A plain string is still a regex — `"."`
 * matches any character — which is the one sharp edge here, and the reason `test`
 * documents it rather than pretending otherwise.
 */

function toRegex(pattern: string, global: boolean): RegExp {
  const slashed = /^\/([\s\S]*)\/([a-z]*)$/.exec(pattern);
  const source = slashed ? slashed[1] : pattern;
  let flags = (slashed ? slashed[2] : "").replace(/[gy]/g, "");
  if (global) flags += "g";
  try {
    return new RegExp(source, flags);
  } catch (error) {
    throw new FormulaFailure(`${JSON.stringify(pattern)} is not a pattern I can read: ${(error as Error).message}`);
  }
}

function unwrap(value: FormulaValue): FormulaValue {
  if (isFormulaError(value)) throw new FormulaFailure(value.__error);
  return value;
}

export const textFunctions: FormulaFunction[] = [
  {
    name: "substring",
    category: "Text",
    signature: "substring(text, start, end?)",
    summary: "A piece of a text, counting from 0 and stopping before the end index. A negative index counts back from the end.",
    examples: [
      { code: 'substring("hello world", 0, 5)', result: "hello" },
      { code: 'substring("hello world", 6)', result: "world" },
      { code: 'substring("hello", -3)', result: "llo" },
    ],
    min: 2,
    max: 3,
    run: (args) => {
      const text = textArg(args, 0, "substring");
      const start = integerArg(args, 1, "substring");
      const end = args.length > 2 ? integerArg(args, 2, "substring") : text.length;
      const from = start < 0 ? Math.max(0, text.length + start) : Math.min(start, text.length);
      const to = end < 0 ? Math.max(0, text.length + end) : Math.min(end, text.length);
      return text.slice(from, Math.max(from, to));
    },
  },
  {
    name: "contains",
    category: "Text",
    signature: "contains(text, value)",
    summary: "True when a text holds another text, or when a list holds the value.",
    examples: [
      { code: 'contains("hello", "ell")', result: "Yes" },
      { code: 'contains("hello", "z")', result: "No" },
    ],
    min: 2,
    max: 2,
    run: (args) => {
      const haystack = unwrap(args[0]());
      const needle = unwrap(args[1]());
      /* A multi-select is a list, and "does this page carry this tag" is the question
         people actually ask of one; a substring search over a rendered list would say
         yes to "a" because "Design" contains one. */
      if (Array.isArray(haystack)) return haystack.some((item) => formulaText(item) === formulaText(needle));
      return formulaText(haystack).includes(formulaText(needle));
    },
  },
  {
    name: "test",
    category: "Text",
    signature: "test(text, pattern)",
    summary: "True when the text matches the pattern. The pattern is a regular expression — \".\" matches any character — and /pattern/flags works too.",
    examples: [
      { code: 'test("hello", "l+")', result: "Yes" },
      { code: 'test("hello", "/^H/i")', result: "Yes" },
    ],
    min: 2,
    max: 2,
    run: (args) => toRegex(textArg(args, 1, "test"), false).test(textArg(args, 0, "test")),
  },
  {
    name: "match",
    category: "Text",
    signature: "match(text, pattern)",
    summary: "Every piece of the text the pattern matches, as a list.",
    examples: [
      { code: 'match("a1 b2", "\\d")', result: "1, 2" },
      { code: 'match("nothing here", "\\d")', result: "" },
    ],
    min: 2,
    max: 2,
    run: (args) => {
      const text = textArg(args, 0, "match");
      const pattern = toRegex(textArg(args, 1, "match"), true);
      return text.match(pattern) ?? [];
    },
  },
  {
    name: "replace",
    category: "Text",
    signature: "replace(text, pattern, replacement)",
    summary: "Replaces the first match of the pattern.",
    examples: [{ code: 'replace("hello", "l", "L")', result: "heLlo" }],
    min: 3,
    max: 3,
    run: (args) => textArg(args, 0, "replace").replace(toRegex(textArg(args, 1, "replace"), false), textArg(args, 2, "replace")),
  },
  {
    name: "replaceAll",
    category: "Text",
    signature: "replaceAll(text, pattern, replacement)",
    summary: "Replaces every match of the pattern.",
    examples: [{ code: 'replaceAll("hello", "l", "L")', result: "heLLo" }],
    min: 3,
    max: 3,
    run: (args) => textArg(args, 0, "replaceAll").replace(toRegex(textArg(args, 1, "replaceAll"), true), textArg(args, 2, "replaceAll")),
  },
  {
    name: "lower",
    category: "Text",
    signature: "lower(text)",
    summary: "The text in lower case.",
    examples: [{ code: 'lower("HeLLo")', result: "hello" }],
    min: 1,
    max: 1,
    run: (args) => textArg(args, 0, "lower").toLowerCase(),
  },
  {
    name: "upper",
    category: "Text",
    signature: "upper(text)",
    summary: "The text in upper case.",
    examples: [{ code: 'upper("HeLLo")', result: "HELLO" }],
    min: 1,
    max: 1,
    run: (args) => textArg(args, 0, "upper").toUpperCase(),
  },
  {
    name: "trim",
    category: "Text",
    signature: "trim(text)",
    summary: "The text without the spaces around it.",
    examples: [{ code: 'trim("  hi  ")', result: "hi" }],
    min: 1,
    max: 1,
    run: (args) => textArg(args, 0, "trim").trim(),
  },
  {
    name: "repeat",
    category: "Text",
    signature: "repeat(text, times)",
    summary: "The text repeated a number of times.",
    examples: [{ code: 'repeat("ab", 3)', result: "ababab" }],
    min: 2,
    max: 2,
    run: (args) => {
      const text = textArg(args, 0, "repeat");
      const times = Math.max(0, integerArg(args, 1, "repeat"));
      if (text.length * times > 10_000) {
        throw new FormulaFailure(`repeat() would build ${text.length * times} characters, which is past the 10,000 a cell can use.`);
      }
      return text.repeat(times);
    },
  },
  {
    name: "padStart",
    category: "Text",
    signature: "padStart(text, length, pad?)",
    summary: "Pads the start until the text is that long.",
    examples: [{ code: 'padStart("7", 3, "0")', result: "007" }],
    min: 2,
    max: 3,
    run: (args) => capText(textArg(args, 0, "padStart").padStart(integerArg(args, 1, "padStart"), args.length > 2 ? textArg(args, 2, "padStart") : " "), "padStart"),
  },
  {
    name: "padEnd",
    category: "Text",
    signature: "padEnd(text, length, pad?)",
    summary: "Pads the end until the text is that long.",
    examples: [{ code: 'padEnd("7", 3, "0")', result: "700" }],
    min: 2,
    max: 3,
    run: (args) => capText(textArg(args, 0, "padEnd").padEnd(integerArg(args, 1, "padEnd"), args.length > 2 ? textArg(args, 2, "padEnd") : " "), "padEnd"),
  },
  {
    name: "link",
    category: "Text",
    signature: "link(label, url)",
    summary: "A link. Cells here hold plain text, so this keeps the label and drops the destination — a formula imported from Notion still runs.",
    examples: [{ code: 'link("Notion", "https://notion.so")', result: "Notion" }],
    min: 2,
    max: 2,
    run: (args) => textArg(args, 0, "link"),
  },
  {
    name: "style",
    category: "Text",
    signature: "style(text, style)",
    summary: "Bold, italic, underline and the rest. Cells here have one font, so the text comes back unchanged.",
    examples: [{ code: 'style("hi", "b")', result: "hi" }],
    min: 2,
    max: 2,
    run: (args) => textArg(args, 0, "style"),
  },
  {
    name: "unstyle",
    category: "Text",
    signature: "unstyle(text, style)",
    summary: "The opposite of style(). Text again, because there is nothing to strip.",
    examples: [{ code: 'unstyle("hi", "b")', result: "hi" }],
    min: 2,
    max: 2,
    run: (args) => textArg(args, 0, "unstyle"),
  },
  {
    name: "concat",
    category: "Text",
    signature: "concat(a, b, …)",
    summary: "Joins values into one text, or joins lists into one list.",
    examples: [
      { code: 'concat("Total: ", 42)', result: "Total: 42" },
      { code: 'concat(["a"], ["b"])', result: "a, b" },
    ],
    min: 1,
    run: (args) => {
      const values = args.map((_, index) => unwrap(args[index]()));
      if (values.some((item) => Array.isArray(item))) {
        const merged: FormulaValue[] = [];
        for (const item of values) {
          if (Array.isArray(item)) merged.push(...item);
          else if (item !== null) merged.push(item);
        }
        return merged;
      }
      return values.filter((item) => item !== null).map(formulaText).join("");
    },
  },
  {
    name: "join",
    category: "Text",
    signature: "join(list, separator?)",
    summary: "A list as one text. The separator defaults to a comma and a space.",
    examples: [
      { code: 'join(["a", "b"], " & ")', result: "a & b" },
      { code: 'join(["a", "b"])', result: "a, b" },
    ],
    min: 1,
    max: 2,
    run: (args) => {
      const list = unwrap(args[0]());
      const items = Array.isArray(list) ? list : list === null ? [] : [list];
      const separator = args.length > 1 ? textArg(args, 1, "join") : ", ";
      return capText(items.map(formulaText).join(separator), "join");
    },
  },
  {
    name: "split",
    category: "Text",
    signature: "split(text, separator)",
    summary: "Cuts a text into a list wherever the separator appears. An empty separator cuts it into characters.",
    examples: [
      { code: 'split("a,b,c", ",")', result: "a, b, c" },
      { code: 'split("abc", "")', result: "a, b, c" },
    ],
    min: 2,
    max: 2,
    run: (args) => {
      const text = textArg(args, 0, "split");
      const separator = textArg(args, 1, "split");
      return separator === "" ? [...text] : text.split(separator);
    },
  },
];
