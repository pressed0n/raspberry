import { asText, compareNullable, type PropertyTypeSpec } from "./shared";
import type { CellValue } from "../types";

/**
 * Checkbox. The only type whose stored value is a boolean, which is why it is also
 * the only type where "empty" and "false" are different states: a row that was
 * never touched (`null`) must not read as an unticked box that someone cleared.
 */
export const checkboxProperty: PropertyTypeSpec = {
  type: "checkbox",
  label: "Checkbox",
  empty: () => null,
  coerce: (raw) => {
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "number") return raw !== 0;
    const text = asText(raw as CellValue).trim().toLowerCase();
    if (text === "true" || text === "yes" || text === "1") return true;
    if (text === "false" || text === "no" || text === "0") return false;
    return null;
  },
  isEmpty: (value) => typeof value !== "boolean",
  compare: (a, b) => compareNullable(
    typeof a === "boolean" ? a : null,
    typeof b === "boolean" ? b : null,
    (left, right) => Number(left) - Number(right),
  ),
  format: (value) => (value === true ? "Yes" : value === false ? "No" : ""),
  fits: (operator, value, operand) => {
    const state = typeof value === "boolean" ? value : null;
    const probe = checkboxProperty.coerce(operand, {});
    switch (operator) {
      case "isEmpty": return state === null;
      case "isNotEmpty": return state !== null;
      case "is":
      case "equals": return typeof probe === "boolean" && state === probe;
      case "isNot":
      case "notEquals": return typeof probe !== "boolean" || state !== probe;
      default: return false;
    }
  },
  aggregates: ["count", "unique"],
};
