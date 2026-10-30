import { asText, compareNullable, type PropertyTypeSpec } from "./shared";
import type { CellValue } from "../types";

/**
 * Created time — the one read-only type.
 * ---------------------------------------------------------------------------
 * The value is the row's page `created_at`, a real UTC instant, and the server
 * overlays it on read. `coerce` therefore **refuses everything**: nothing a client
 * sends may become a created time, or a row could claim it was created at a time it
 * was not. `readOnly` is what the write path checks, so the refusal is declared in
 * one place instead of special-cased in the service.
 *
 * Unlike the `date` type this renders in *local* time, because unlike a chosen date
 * it genuinely is an instant.
 */

interface CreatedTimeConfig { includeTime?: boolean }

const instant = (value: CellValue): number | null => {
  const text = asText(value).trim();
  if (text === "") return null;
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : at;
};

function render(at: number, config: CreatedTimeConfig): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (config.includeTime === false) return day;
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const createdTimeProperty: PropertyTypeSpec<CreatedTimeConfig> = {
  type: "createdTime",
  label: "Created time",
  readOnly: true,
  empty: () => null,
  /* Deliberately discards its input. */
  coerce: () => null,
  isEmpty: (value) => instant(value) === null,
  compare: (a, b) => compareNullable(instant(a), instant(b), (left, right) => left - right),
  format: (value, config) => {
    const at = instant(value);
    return at === null ? "" : render(at, config ?? {});
  },
  fits: (operator, value, operand) => {
    const left = instant(value);
    const right = instant(operand as CellValue);
    switch (operator) {
      case "isEmpty": return left === null;
      case "isNotEmpty": return left !== null;
      case "is":
      case "equals": return left !== null && left === right;
      case "isNot":
      case "notEquals": return left !== right;
      case "onOrBefore":
      case "lessThan": return left !== null && right !== null && (operator === "lessThan" ? left < right : left <= right);
      case "onOrAfter":
      case "greaterThan": return left !== null && right !== null && (operator === "greaterThan" ? left > right : left >= right);
      default: return false;
    }
  },
  aggregates: ["count", "min", "max"],
};
