import type { CatalogEntry } from "./catalog";

/**
 * What the caret is in the middle of typing.
 * ---------------------------------------------------------------------------
 * Two questions, one function, because they are the same question asked at different
 * places in the formula:
 *
 *   `dateA|`            → the fragment `dateA`, filtered against every name
 *   `prop("Du|`         → the property `Du`, filtered against the columns *and* the
 *                        replacement covers `prop("` too, so inserting a column never
 *                        leaves a half-typed `prop("` in front of it
 *
 * Pure and separate from the editor so the arithmetic of "which characters does this
 * replace" can be tested at the edges — the first character, the last, and the caret in
 * the middle of a word — instead of being inferred from a screenshot.
 */

export type Suggestion = {
  /** The text before the caret that filters the list. Empty means "show everything". */
  query: string;
  /** Where the replacement starts. For a property this is the `p` of `prop(`. */
  start: number;
  /** Where the replacement ends (the caret). */
  end: number;
  /** Property names are being typed, so the list narrows to columns. */
  wanted: "any" | "property";
};

const WORD = /[\p{L}\p{N}_$]/u;

export function suggestionAt(source: string, caret: number): Suggestion {
  const at = Math.max(0, Math.min(caret, source.length));
  const before = source.slice(0, at);

  /* Inside `prop("…`, and only inside it: an escaped quote does not end the string, and a
     `)` before the caret means the call is already closed. */
  const open = /prop\(\s*(["'])/g;
  let match: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((match = open.exec(before)) !== null) last = match;
  if (last) {
    const after = before.slice(last.index + last[0].length);
    const quote = last[1];
    if (!after.includes(quote) && !after.includes(")")) {
      return { query: after, start: last.index, end: at, wanted: "property" };
    }
  }

  let start = at;
  while (start > 0 && WORD.test(source[start - 1])) start -= 1;
  /* A dotted name (`Date.no`) is one token: the dot belongs to the fragment only when the
     character before it is part of a name, so `.5` in `1.5` stays a number. */
  if (start > 0 && source[start - 1] === "." && start > 1 && WORD.test(source[start - 2])) {
    start -= 1;
    while (start > 0 && WORD.test(source[start - 1])) start -= 1;
  }
  return { query: source.slice(start, at), start, end: at, wanted: "any" };
}

/**
 * The formula after pressing an entry, and where the caret should be.
 *
 * `add()` puts the caret *between* the brackets: a function that leaves the caret after
 * the closing bracket makes the next keystroke a syntax error, which is the same as not
 * inserting it at all.
 */
export function insertEntry(source: string, entry: CatalogEntry, suggestion: Suggestion): { next: string; caret: number } {
  const before = source.slice(0, suggestion.start);
  const after = source.slice(suggestion.end);
  const insert = entry.insert;
  const opensCall = insert.endsWith("()");
  /* The caret goes *inside* the brackets of `name()`, or straight after everything else. */
  return { next: `${before}${insert}${after}`, caret: before.length + insert.length - (opensCall ? 1 : 0) };
}

export function filterEntries(entries: CatalogEntry[], suggestion: Suggestion): CatalogEntry[] {
  if (suggestion.wanted === "property") {
    return entries.filter((entry) => entry.kind === "property" && matches(entry, suggestion.query));
  }
  return entries.filter((entry) => matches(entry, suggestion.query));
}

function matches(entry: CatalogEntry, query: string): boolean {
  if (query === "") return true;
  const needle = query.toLowerCase();
  /* The search text includes the aliases, so `Date.ad` finds `dateAdd` through
     `Date.dateAdd` rather than only through its bare name. */
  return entry.search.includes(needle) || entry.label.toLowerCase().startsWith(needle);
}
