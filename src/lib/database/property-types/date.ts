import { asRecord, asText, compareNullable, type PropertyTypeSpec } from "./shared";
import type { CellValue } from "../types";

/**
 * Date (with the optional end date and time granularity the wishlist asks for).
 * ---------------------------------------------------------------------------
 * Stored value is `{ start, end }` where both are **floating** ISO strings —
 * `2026-10-30` or `2026-10-30T14:30` — with no timezone suffix and no `Z`.
 *
 * That is deliberate. An instant stored as UTC and rendered in local time is how a
 * date column ends up showing the 29th to someone west of Greenwich, and a calendar
 * view is exactly the place that bug becomes visible. A floating date means what it
 * says, compares correctly as a string, and needs no conversion at render time.
 *
 * `end` is null unless the person set one; start and end may share a day, which is
 * the wishlist's "same day lasting 8 hours".
 */

interface DateConfig {
  format?: "iso" | "dmy" | "mdy" | "long";
  includeTime?: boolean;
  timeFormat?: "12" | "24";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` and nothing else. */
const FLOATING = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

function normalizeFloating(raw: unknown): string | null {
  const text = asText(raw as CellValue).trim();
  if (text === "") return null;
  const match = FLOATING.exec(text);
  if (match) {
    const [, year, month, day, hour, minute] = match;
    if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null;
    if (hour !== undefined && (Number(hour) > 23 || Number(minute) > 59)) return null;
    return hour === undefined ? `${year}-${month}-${day}` : `${year}-${month}-${day}T${hour}:${minute}`;
  }
  /* Anything else (a Date, an epoch, "30 Oct 2026") is read in local time and
     written back out as floating, never as UTC. */
  const at = raw instanceof Date ? raw : new Date(typeof raw === "number" ? raw : text);
  if (Number.isNaN(at.getTime())) return null;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

const parts = (value: CellValue): { start: string | null; end: string | null } => {
  const record = asRecord(value);
  if (!record) return { start: normalizeFloating(value), end: null };
  return { start: normalizeFloating(record.start), end: normalizeFloating(record.end) };
};

/** The text up to the minute, or the day alone — enough to compare and to filter. */
const key = (value: CellValue): string | null => parts(value).start;

const dayOf = (value: string): string => value.slice(0, 10);

function renderOne(value: string, config: DateConfig): string {
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-");
  const includeTime = Boolean(config.includeTime) && time !== undefined;
  let head: string;
  switch (config.format ?? "iso") {
    case "dmy": head = `${day}/${month}/${year}`; break;
    case "mdy": head = `${month}/${day}/${year}`; break;
    case "long": head = `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`; break;
    default: head = date;
  }
  if (!includeTime) return head;
  const [hour, minute] = time.split(":").map(Number);
  const tail = (config.timeFormat ?? "24") === "12"
    ? `${((hour + 11) % 12) + 1}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`
    : `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return `${head} ${tail}`;
}

export const dateProperty: PropertyTypeSpec<DateConfig> = {
  type: "date",
  label: "Date",
  empty: () => null,
  coerce: (raw) => {
    const { start, end } = parts(raw as CellValue);
    if (start === null) return null;
    return end === null || end < start ? { start, end: null } : { start, end };
  },
  isEmpty: (value) => key(value) === null,
  compare: (a, b) => compareNullable(key(a), key(b), (left, right) => left < right ? -1 : left > right ? 1 : 0),
  format: (value, config) => {
    const { start, end } = parts(value);
    if (start === null) return "";
    const head = renderOne(start, config ?? {});
    return end === null ? head : `${head} → ${renderOne(end, config ?? {})}`;
  },
  fits: (operator, value, operand) => {
    const left = key(value);
    const probe = asRecord(operand as CellValue);
    const right = probe ? normalizeFloating(probe.start) : normalizeFloating(operand);
    /* A bare date as the operand means "that whole day", so `is` on 2026-10-30
       matches a 14:30 timestamp on the 30th. */
    const timed = right !== null && right.includes("T");
    const at = (text: string) => (timed ? text : dayOf(text));
    switch (operator) {
      case "isEmpty": return left === null;
      case "isNotEmpty": return left !== null;
      case "is":
      case "equals": return left !== null && right !== null && at(left) === right;
      case "isNot":
      case "notEquals": return left === null || right === null || at(left) !== right;
      case "onOrBefore":
      case "lessThan": return left !== null && right !== null && (operator === "lessThan" ? at(left) < right : at(left) <= right);
      case "onOrAfter":
      case "greaterThan": return left !== null && right !== null && (operator === "greaterThan" ? at(left) > right : at(left) >= right);
      default: return false;
    }
  },
  aggregates: ["count", "min", "max", "unique"],
};
