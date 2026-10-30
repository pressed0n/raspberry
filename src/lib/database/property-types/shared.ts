import type { CellValue } from "../types";

/**
 * Shared plumbing for the property-type modules.
 * ---------------------------------------------------------------------------
 * `properties.ts` owns the registry and the two types that shipped with the
 * substrate (text, number). The remaining fourteen live one-per-file beside this
 * one, because the registry's whole promise is that a type is a *module* — the
 * day a type needs a new method, exactly one file changes.
 *
 * Nothing in here knows about views. Nothing in a view may import from here.
 */

export type FilterOperator =
  | "is" | "isNot" | "contains" | "doesNotContain" | "isEmpty" | "isNotEmpty"
  | "equals" | "notEquals" | "greaterThan" | "lessThan" | "onOrBefore" | "onOrAfter";

export type Aggregate = "count" | "sum" | "average" | "min" | "max" | "unique";

export interface PropertyTypeSpec<C = Record<string, unknown>> {
  type: PropertyTypeName;
  /** Shown in the property menu and as the column header's fallback label. */
  label: string;
  /** What an empty cell is. `null` for most types; `[]` for the list-shaped ones. */
  empty(): CellValue;
  /** Turn anything the API, an import or a formula produced into a stored value. */
  coerce(raw: unknown, config: C): CellValue;
  isEmpty(value: CellValue, config: C): boolean;
  /** One sort order for this type, shared by every view. */
  compare(a: CellValue, b: CellValue, config: C): number;
  /** How the value reads in a cell, an export, and a formula's string cast. */
  format(value: CellValue, config: C): string;
  fits(operator: FilterOperator, value: CellValue, operand: unknown, config: C): boolean;
  aggregates?: Aggregate[];
  /**
   * The person never writes this cell, and the server must refuse a write to it.
   * `createdTime` is the only current one; a write that reached it would let a row
   * claim it was created at a time it was not.
   */
  readOnly?: boolean;
  /**
   * The value is computed from other properties and never stored — a formula cell
   * has no row in `database_cells`. Reads go through the evaluator in B44.
   */
  derived?: boolean;
}

/* Kept as a local alias so this file does not import the Zod vocabulary at
   runtime — several of these modules are pulled into client bundles. */
type PropertyTypeName = import("../types").PropertyType;

export const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function asText(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function asNumber(value: CellValue): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = asText(value).replace(/[\s,]/g, "");
  if (text === "") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A JSON object, or `null`. Every composite value in the vocabulary is a record. */
export function asRecord(value: CellValue): Record<string, CellValue> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, CellValue>)
    : null;
}

export function asList(value: CellValue): CellValue[] {
  return Array.isArray(value) ? value : [];
}

/**
 * `null` sorts after any present value. Mirrors the number type, which documents
 * why: an empty cell is "no opinion", and burying it under the smallest value
 * makes a sorted table lie about which rows are actually empty.
 */
export function compareNullable<T>(
  left: T | null,
  right: T | null,
  compare: (a: T, b: T) => number,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return compare(left, right);
}

/* ---------------------------------------------------------------------------
   Filtering. Every operator a type supports is answered here, so a view never
   has to reimplement "what does contains mean for a date".
   --------------------------------------------------------------------------- */

export function matchesText(operator: FilterOperator, value: CellValue, operand: unknown): boolean {
  const text = collator.compare(asText(value), "") === 0 ? "" : asText(value);
  const probe = asText(operand as CellValue).trim();
  switch (operator) {
    case "isEmpty": return text === "";
    case "isNotEmpty": return text !== "";
    case "is":
    case "equals": return collator.compare(text, probe) === 0;
    case "isNot":
    case "notEquals": return collator.compare(text, probe) !== 0;
    case "contains": return text.toLowerCase().includes(probe.toLowerCase());
    case "doesNotContain": return !text.toLowerCase().includes(probe.toLowerCase());
    default: return false;
  }
}

export function matchesNumber(operator: FilterOperator, value: CellValue, operand: unknown): boolean {
  const left = asNumber(value);
  const right = asNumber(operand as CellValue);
  switch (operator) {
    case "isEmpty": return left === null;
    case "isNotEmpty": return left !== null;
    case "is":
    case "equals": return left !== null && right !== null && left === right;
    case "isNot":
    case "notEquals": return left !== right;
    case "greaterThan": return left !== null && right !== null && left > right;
    case "lessThan": return left !== null && right !== null && left < right;
    default: return false;
  }
}

/** ISO-8601 comparison, which is why dates are stored as ISO strings and not Dates. */
export function matchesDate(operator: FilterOperator, value: CellValue, operand: unknown): boolean {
  const left = asRecord(value)?.start ?? null;
  const right = asRecord(operand as CellValue)?.start ?? (typeof operand === "string" ? operand : null);
  const at = typeof left === "string" ? Date.parse(left) : Number.NaN;
  const to = typeof right === "string" ? Date.parse(right) : Number.NaN;
  switch (operator) {
    case "isEmpty": return Number.isNaN(at);
    case "isNotEmpty": return !Number.isNaN(at);
    case "is":
    case "equals":
    case "onOrBefore": return !Number.isNaN(at) && !Number.isNaN(to) && (operator === "onOrBefore" ? at <= to : at === to);
    case "isNot":
    case "notEquals": return at !== to;
    case "onOrAfter": return !Number.isNaN(at) && !Number.isNaN(to) && at >= to;
    /* Aliases: a date column should understand "greater than" as "after". */
    case "greaterThan": return !Number.isNaN(at) && !Number.isNaN(to) && at > to;
    case "lessThan": return !Number.isNaN(at) && !Number.isNaN(to) && at < to;
    default: return false;
  }
}

/* ---------------------------------------------------------------------------
   Options — the tag lists behind Select, Multi-select and Status.
   A cell stores the option *id*, so renaming a tag is one property write.
   --------------------------------------------------------------------------- */

export interface OptionLike { id: string; name: string; color?: string; groupId?: string | null }

export function optionsOf(config: Record<string, unknown> | undefined): OptionLike[] {
  const list = (config as { options?: unknown } | undefined)?.options;
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is OptionLike =>
    typeof item === "object" && item !== null && typeof (item as OptionLike).id === "string");
}

export function optionById(config: Record<string, unknown> | undefined, id: string): OptionLike | null {
  return optionsOf(config).find((option) => option.id === id) ?? null;
}

/** An id from a cell, an operand or a label typed into a filter. */
export function optionIdFrom(value: unknown, config: Record<string, unknown> | undefined): string | null {
  if (typeof value !== "string" || value === "") return null;
  const options = optionsOf(config);
  if (options.some((option) => option.id === value)) return value;
  /* Filters are typed by a person, who types the *name*, not the uuid. */
  const byName = options.find((option) => collator.compare(option.name, value) === 0);
  return byName?.id ?? null;
}

export function optionIdsOf(value: CellValue, config: Record<string, unknown> | undefined): string[] {
  const options = optionsOf(config);
  return asList(value)
    .map((item) => optionIdFrom(asText(item), config) ?? optionIdFrom(item as string, config))
    .filter((id): id is string => id !== null && options.some((option) => option.id === id));
}

/** Option order is the property's own order — the order a person arranged. */
export function compareOptions(config: Record<string, unknown> | undefined, a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const order = optionsOf(config).map((option) => option.id);
  const left = order.indexOf(a), right = order.indexOf(b);
  if (left === -1 && right === -1) return collator.compare(a, b);
  if (left === -1) return 1;
  if (right === -1) return -1;
  return left - right;
}

/* ---------------------------------------------------------------------------
   Shape validation, shared by URL / Email / Phone so the three stay consistent.
   --------------------------------------------------------------------------- */

export function isEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(text);
}

/** Digits, spaces, dashes, dots, parens and one leading `+`. Nothing else. */
export function isPhone(text: string): boolean {
  /* Six digits is the floor for anything anyone would call a phone number; "123"
     is an extension or a typo, and accepting it makes the column untrustworthy. */
  return /^\+?[\d\s().-]+$/.test(text) && (text.match(/\d/g) ?? []).length >= 6;
}

/** A URL is stored with its scheme so it is never guessed at render time. */
export function normalizeUrl(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "mailto:") return null;
    if (!url.hostname.includes(".") && url.protocol !== "mailto:") return null;
    return url.toString();
  } catch {
    return null;
  }
}
