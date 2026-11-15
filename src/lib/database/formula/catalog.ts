import type { FormulaFunction } from "./calls";
import { CATEGORY_ORDER, FUNCTIONS } from "./functions";
import type { PropertyDef } from "../types";

/**
 * What the editor's browser lists.
 * ---------------------------------------------------------------------------
 * Generated, never hand-written: `FUNCTIONS` is the registry the evaluator resolves
 * names against, so a function cannot be listed-but-not-callable. The only entries not
 * in the registry are:
 *
 *   **properties** — which depend on the table being edited, so they are built per row,
 *   **true / false** — literals, not calls,
 *   **let / lets** — special forms: the evaluator reads their first argument as a name
 *   rather than evaluating it, which a normal function signature cannot express.
 */

export interface CatalogEntry {
  /** Unique across sections; also the React key. */
  key: string;
  /** What the row reads. */
  label: string;
  /** What pressing it inserts into the formula. */
  insert: string;
  kind: "property" | "value" | "function";
  signature: string;
  summary: string;
  examples: Array<{ code: string; result?: string; fails?: boolean }>;
  /** Lower-case text the filter searches. */
  search: string;
}

export interface CatalogSection {
  id: string;
  title: string;
  entries: CatalogEntry[];
}

const fromFunction = (definition: FormulaFunction): CatalogEntry => ({
  key: `fn:${definition.name}`,
  label: definition.name,
  insert: `${definition.name}()`,
  kind: "function",
  signature: definition.signature,
  summary: definition.summary,
  examples: definition.examples,
  search: `${definition.name} ${definition.aka?.join(" ") ?? ""} ${definition.summary}`.toLowerCase(),
});

const literal = (name: string, summary: string): CatalogEntry => ({
  key: `value:${name}`,
  label: name,
  insert: name,
  kind: "value",
  signature: name,
  summary,
  examples: [{ code: name, result: name === "true" ? "Yes" : "No" }],
  search: name,
});

/** The special forms, documented exactly like functions but handled by the evaluator.
 *  `run` is unreachable — `evaluate()` matches these two names before it looks in the
 *  registry — and throwing is the right answer if that ever stops being true. */
const specials: FormulaFunction[] = [
  {
    name: "let",
    category: "General",
    signature: "let(name, value, expression)",
    summary: "Names a value so a long formula can say it once: let(total, add(2, 3), multiply(total, 2)).",
    examples: [{ code: "let(total, 2 + 3, total * 2)", result: "10" }],
    min: 3,
    max: 3,
    run: () => { throw new Error("let() is a special form"); },
  },
  {
    name: "lets",
    category: "General",
    signature: "lets({ name: value, … }, expression)",
    summary: "Names several values at once: lets({a: 2, b: 3}, a * b).",
    examples: [{ code: "lets({a: 2, b: 3}, a * b)", result: "6" }],
    min: 2,
    max: 2,
    run: () => { throw new Error("lets() is a special form"); },
  },
];

export function formulaCatalog(properties: PropertyDef[], excludeId?: string): CatalogSection[] {
  /* A property cannot reference itself: the value would be the formula being written.
     Listing it would be offering a click that always produces a loop error. */
  const usable = properties.filter((property) => property.id !== excludeId);
  const propertySection: CatalogSection = {
    id: "properties",
    title: "Properties",
    entries: usable.map((property) => ({
      key: `prop:${property.id}`,
      label: property.name,
      insert: `prop("${property.name.replace(/"/g, '\\"')}")`,
      kind: "property",
      signature: `prop("${property.name}")`,
      summary: `The value of ${property.name} on this page.`,
      examples: [{ code: `prop("${property.name.replace(/"/g, '\\"')}")` }],
      search: `${property.name} prop`.toLowerCase(),
    })),
  };

  const builtinSection: CatalogSection = {
    id: "builtins",
    title: "Built-ins",
    entries: [
      literal("true", "Yes, as a value."),
      literal("false", "No, as a value."),
    ],
  };

  const categories = CATEGORY_ORDER.map((category) => ({
    id: category.toLowerCase(),
    title: category,
    entries: [
      ...(category === "General" ? specials.map(fromFunction) : []),
      ...FUNCTIONS.filter((definition) => definition.category === category).map(fromFunction),
    ],
  }));

  return [propertySection, builtinSection, ...categories].filter((section) => section.entries.length > 0);
}

/** Every entry in one list, for the filter and for keyboard traversal. */
export function flatCatalog(sections: CatalogSection[]): CatalogEntry[] {
  return sections.flatMap((section) => section.entries);
}
