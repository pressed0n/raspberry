import { propertyTypeSchema, type CellValue, type PropertyDef, type PropertyType } from "./types";

/**
 * The property-type registry.
 * ---------------------------------------------------------------------------
 * This is the decision the whole plan turns on. Sixteen property types times a
 * growing number of views is a matrix, and a matrix written as a switch statement
 * in each view has to be edited in every view for every type. So a type is a
 * *module* with one shape, and the table today — plus the board, the calendar, the
 * filter bar, the sort menu, the exporter and the MCP surface later — reads only
 * this interface and knows nothing about any particular type.
 *
 * Adding type #17 is one object literal added to `registry` below. No migration:
 * a property's `config` and a cell's `value` are both JSON columns already.
 *
 * Everything here is pure — no React, no fetch, no DOM — because the same
 * comparisons have to run in a route handler, in a unit test and (for formulas)
 * on the server.
 */

/* The spec interface and the operator/aggregate vocabulary live beside the per-type
   modules, in `property-types/shared.ts`. This file owns the **registry**; that file
   owns the **contract**. Re-exported here so every existing import site — including
   the tests — keeps working unchanged. */
import type { Aggregate, FilterOperator, PropertyTypeSpec } from "./property-types/shared";
export type { Aggregate, FilterOperator, PropertyTypeSpec };

import { checkboxProperty } from "./property-types/checkbox";
import { buttonProperty } from "./property-types/button";
import { createdTimeProperty } from "./property-types/created-time";
import { dateProperty } from "./property-types/date";
import { filesProperty } from "./property-types/files";
import { formulaProperty } from "./property-types/formula";
import { emailProperty, phoneProperty, urlProperty } from "./property-types/link";
import { multiSelectProperty, selectProperty, statusProperty } from "./property-types/option";
import { personProperty } from "./property-types/person";
import { placeProperty } from "./property-types/place";


const asText = (value: CellValue): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};

const matchesText = (operator: FilterOperator, value: CellValue, operand: unknown): boolean => {
  const haystack = asText(value).toLowerCase();
  const needle = asText(operand as CellValue).toLowerCase();
  switch (operator) {
    case "isEmpty": return haystack === "";
    case "isNotEmpty": return haystack !== "";
    case "contains": return needle === "" || haystack.includes(needle);
    case "doesNotContain": return needle !== "" && !haystack.includes(needle);
    case "isNot":
    case "notEquals": return haystack !== needle;
    default: return haystack === needle;
  }
};

/**
 * Text.
 *
 * `compare` is `localeCompare` with a numeric collator on purpose: a list of
 * "Item 2, Item 10" sorts as a person reads it, not as a byte comparison would.
 * The collator is created once at module scope because constructing one per
 * comparison is the difference between a fast sort and a visibly slow one on a
 * thousand rows.
 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export const textProperty: PropertyTypeSpec = {
  type: "text",
  label: "Text",
  empty: () => null,
  coerce: (raw) => (raw === null || raw === undefined ? null : asText(raw as CellValue)),
  isEmpty: (value) => asText(value) === "",
  compare: (a, b) => collator.compare(asText(a), asText(b)),
  format: (value) => asText(value),
  fits: (operator, value, operand) => matchesText(operator, value, operand),
  aggregates: ["count", "unique"],
};

/**
 * Number.
 *
 * The wishlist's six formats, decimal places and divide-by are all *display*:
 * the stored value is the number the person typed. Storing a formatted string
 * would make "sum this column" impossible and would lose the value the moment
 * the format changed.
 */
export const numberProperty: PropertyTypeSpec<{
  format?: string; currency?: string; decimals?: number; divideBy?: number; showNumber?: boolean;
}> = {
  type: "number",
  label: "Number",
  empty: () => null,
  coerce: (raw) => {
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
    if (typeof raw === "boolean") return raw ? 1 : 0;
    const cleaned = String(raw ?? "").replace(/[\s,]/g, "").replace(/[^\d.eE+-]/g, "");
    const value = Number(cleaned);
    return cleaned !== "" && Number.isFinite(value) ? value : null;
  },
  isEmpty: (value) => typeof value !== "number" || !Number.isFinite(value),
  /* Missing values sort last in both directions: an empty cell is "no opinion",
     and burying it under the smallest number makes a sorted table lie about which
     rows are actually empty. */
  compare: (a, b) => {
    const left = typeof a === "number" ? a : null, right = typeof b === "number" ? b : null;
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return left - right;
  },
  format: (value, config) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return "";
    const divisor = Number(config.divideBy ?? 1) || 1;
    const decimals = Math.min(6, Math.max(0, Number(config.decimals ?? 0)));
    const scaled = value / divisor;
    switch (config.format) {
      case "percent": return `${scaled.toFixed(decimals)}%`;
      case "currency":
        try {
          return new Intl.NumberFormat(undefined, { style: "currency", currency: String(config.currency ?? "USD"), minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(scaled);
        } catch { return scaled.toFixed(decimals); }
      case "duration": {
        const total = Math.abs(Math.round(scaled));
        const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), seconds = total % 60;
        const sign = scaled < 0 ? "-" : "";
        return hours ? `${sign}${hours}h ${minutes}m` : minutes ? `${sign}${minutes}m ${seconds}s` : `${sign}${seconds}s`;
      }
      case "separators": return new Intl.NumberFormat(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(scaled);
      default: return scaled.toFixed(decimals);
    }
  },
  fits: (operator, value, operand) => {
    const left = typeof value === "number" ? value : null;
    const right = typeof operand === "number" ? operand : Number(operand);
    if (operator === "isEmpty") return left === null;
    if (operator === "isNotEmpty") return left !== null;
    if (left === null || !Number.isFinite(right)) return false;
    switch (operator) {
      case "greaterThan": case "onOrAfter": return left > right;
      case "lessThan": case "onOrBefore": return left < right;
      case "isNot": case "notEquals": case "doesNotContain": return left !== right;
      default: return left === right;
    }
  },
  aggregates: ["count", "sum", "average", "min", "max", "unique"],
};

/**
 * The registry — every type, and the compile-time proof that it is every type.
 *
 * It is a **complete** `Record<PropertyType, PropertyTypeSpec>`, not a `Partial`.
 * Adding a name to `propertyTypes` in `types.ts` now breaks the build until a module
 * exists for it, which is the whole point: a type that silently falls back to text
 * behaviour is a type whose filter, sort and format are wrong in a way nobody sees
 * until a person trusts a sorted column.
 *
 * `resolveProperty` keeps a fallback anyway, for a property written by a *newer*
 * build than the one reading it — a degraded text render beats a crash on someone's
 * existing data.
 */
const registry: Record<PropertyType, PropertyTypeSpec> = {
  text: textProperty,
  number: numberProperty as PropertyTypeSpec,
  checkbox: checkboxProperty,
  url: urlProperty,
  email: emailProperty,
  phone: phoneProperty,
  person: personProperty as PropertyTypeSpec,
  files: filesProperty,
  createdTime: createdTimeProperty as PropertyTypeSpec,
  place: placeProperty as PropertyTypeSpec,
  select: selectProperty,
  multiSelect: multiSelectProperty,
  status: statusProperty,
  date: dateProperty as PropertyTypeSpec,
  formula: formulaProperty as PropertyTypeSpec,
  button: buttonProperty as PropertyTypeSpec,
};

export function resolveProperty(property: Pick<PropertyDef, "type">): PropertyTypeSpec {
  return registry[property.type] ?? { ...textProperty, type: property.type };
}

/** Types this build can actually render and edit, in wishlist order. */
export function availableTypes(): PropertyType[] {
  return propertyTypeSchema.options.filter((type) => registry[type] !== undefined);
}

/** One cell, as text. The only way a view should ever turn a value into a string. */
export function formatCell(property: Pick<PropertyDef, "type" | "config">, value: CellValue): string {
  const spec = resolveProperty(property);
  return spec.format(value, (property.config ?? {}) as Record<string, unknown>);
}

/* ---------------------------------------------------------------------------
   How a sort explains itself
   ---------------------------------------------------------------------------
   "A → Z" is a claim about the comparison, and it is only true for the types that
   compare as text. A number column sorted ascending is not A to Z; neither is a
   date column. The wording lives here, beside the registry, because it is a fact
   about the *type* — the same reason `label` and `format` do.

   `kind` is not decoration either: the arrow drawn beside a sorted header is the
   same claim in a glyph, and a column of numbers showing `ArrowUpAZ` is the
   original bug in a smaller font. Views map the kind to an icon; nothing else
   may guess.
   --------------------------------------------------------------------------- */

export type SortKind = "alpha" | "ordered";

export function sortKind(type: PropertyType): SortKind {
  switch (type) {
    case "number":
    case "date":
    case "createdTime":
    case "checkbox":
      return "ordered";
    default:
      return "alpha";
  }
}

export type SortLabels = { ascending: string; descending: string; manual?: string };

/**
 * The three ways a column can be ordered, named for the comparison that will run.
 *
 * `manual` is present only for the types that own a sequence — see
 * `PropertyTypeSpec.order`. The menu reads its presence as "show the row", so a type
 * cannot advertise an order it cannot produce, and a type that gains one gets the row
 * without anyone editing the menu.
 */
export function sortLabels(type: PropertyType): SortLabels {
  const labels = baseSortLabels(type);
  return registry[type]?.order ? { ...labels, manual: "Manual order" } : labels;
}

function baseSortLabels(type: PropertyType): SortLabels {
  switch (type) {
    case "number":
      return { ascending: "Low → High", descending: "High → Low" };
    case "date":
    case "createdTime":
      return { ascending: "Earliest → Latest", descending: "Latest → Earliest" };
    case "checkbox":
      return { ascending: "Unchecked first", descending: "Checked first" };
    default:
      return { ascending: "A → Z", descending: "Z → A" };
  }
}

/* ---------------------------------------------------------------------------
   Currencies
   ---------------------------------------------------------------------------
   Presentation only — nothing converts, and the stored value is the number that
   was typed. `currencySymbol` asks `Intl` rather than carrying a table of glyphs,
   so the symbol on the menu row is the exact one the cell will render with, in
   the reader's own locale. A code `Intl` rejects falls back to the code itself,
   which is what the formatter does too.
   --------------------------------------------------------------------------- */

export const currencies = [
  { code: "USD", name: "US dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British pound" },
  { code: "JPY", name: "Japanese yen" },
  { code: "CNY", name: "Chinese yuan" },
  { code: "INR", name: "Indian rupee" },
  { code: "AUD", name: "Australian dollar" },
  { code: "CAD", name: "Canadian dollar" },
  { code: "CHF", name: "Swiss franc" },
  { code: "SEK", name: "Swedish krona" },
  { code: "PLN", name: "Polish złoty" },
  { code: "BRL", name: "Brazilian real" },
] as const;

export function currencySymbol(code: string): string {
  try {
    const parts = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    return parts.find((part) => part.type === "currency")?.value ?? code;
  } catch {
    return code;
  }
}

/* The number formats, in the order a menu should list them. The *sample* beside each
   one is not listed here on purpose: the menu renders it with `formatCell` and the
   column's own config, so the number a person is shown is the number they will get.
   A hand-written "1,234" would be an English guess in every other locale. */
export const numberFormatChoices = [
  { format: "number", label: "Number" },
  { format: "separators", label: "Number with separators" },
  { format: "percent", label: "Percentage" },
  { format: "duration", label: "Duration" },
] as const;

/* The date formats, in the order the menu lists them — and the same rule about samples:
   the row above carries the one sample, rendered through `formatCell` with this column's
   config, because four previews beside four labels would truncate every label in a 200px
   submenu (the number menu paid for that lesson). */
export const dateFormatChoices = [
  { format: "long", label: "Month day, year" },
  { format: "mdy", label: "Month/day/year" },
  { format: "dmy", label: "Day/month/year" },
  { format: "iso", label: "Year-month-day" },
] as const;
