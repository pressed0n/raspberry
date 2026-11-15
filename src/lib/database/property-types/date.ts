import { dayDiff, todayKey } from "../calendar";
import { asRecord, asText, compareNullable, type PropertyTypeSpec } from "./shared";
import { dateFormats, legacyDateFormats, type CellValue, type DateFormatName } from "../types";

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

/* The vocabulary lives in `types.ts`, beside the schema's enum, because the server has to
   accept the same six words and the two retired ones. Re-exported here so a formatter that
   only needs "what can a date look like" does not have to import the whole schema module. */
export type DateFormat = DateFormatName;

export interface DateConfig {
  format?: DateFormat;
  includeTime?: boolean;
  timeFormat?: "12" | "24";
}

/**
 * The config with its defaults filled, in the shape the formatter and the picker both
 * read. `configSchemas.date` fills these on the server, but `formatCell` is also called
 * with a half-built config from the property menu's own previews, and with `undefined`
 * on a column that has never been saved.
 */
export function dateConfigOf(config?: unknown): Required<DateConfig> {
  const raw = (config ?? {}) as DateConfig;
  const named = raw.format ? legacyDateFormats[raw.format] ?? raw.format : null;
  return {
    format: named && dateFormats.includes(named) ? named : "full",
    includeTime: Boolean(raw.includeTime),
    timeFormat: raw.timeFormat === "12" ? "12" : "24",
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
/** `getUTCDay()`'s order — Sunday first. */
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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

/**
 * A stored value as its two bounds. Exported because the picker must agree with the
 * formatter about what the cell *is*: two implementations of "read a date value" would
 * eventually disagree about a string the server accepted.
 */
export const dateBounds = (value: CellValue): { start: string | null; end: string | null } => {
  const record = asRecord(value);
  if (!record) return { start: normalizeFloating(value), end: null };
  return { start: normalizeFloating(record.start), end: normalizeFloating(record.end) };
};

/** The text up to the minute, or the day alone — enough to compare and to filter. */
const key = (value: CellValue): string | null => dateBounds(value).start;

const dayOf = (value: string): string => value.slice(0, 10);

function renderOne(value: string, config: DateConfig): { day: string; time: string | null } {
  const [date, time] = value.split("T");
  /* The time is drawn only when the column *shows* times and this value has one. Turning
     "Include time" off hides the clocks; it does not throw them away, so turning it back
     on finds them again. */
  return {
    day: dayHead(date, config),
    time: Boolean(config.includeTime) && time ? clockText(time, config) : null,
  };
}

/**
 * "Today", "Yesterday", "Tomorrow"; then the weekday name for a day still inside the
 * week ahead, `Last <weekday>` for one inside the week behind, and the full date after
 * that. The cutoffs are the ones a person reading a list already uses: "Thursday" is
 * useful while the week still has a Thursday in it, and "October 17, 2026" is what a
 * date has to say once it is no longer this week's business.
 *
 * `today` is a parameter, not a call to the clock, because a formatter that reads the
 * clock cannot be tested on the day it matters — the one where the offset is 0.
 */
export function relativeLabel(day: string, today: string): string {
  const diff = dayDiff(today, day);
  if (diff === 0) return "Today";
  if (diff === -1) return "Yesterday";
  if (diff === 1) return "Tomorrow";
  const weekday = WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()] ?? "";
  if (diff > 1 && diff <= 6) return weekday;
  if (diff < -1 && diff >= -6) return `Last ${weekday}`;
  return dayHead(day, { format: "full" });
}

/** The date part, in this column's format. */
export function dayHead(day: string, config: DateConfig, today: string = todayKey()): string {
  const [year, month, date] = day.split("-");
  switch (config.format ?? "full") {
    case "mdy": return `${month}/${date}/${year}`;
    case "dmy": return `${date}/${month}/${year}`;
    case "ymd": return `${year}/${month}/${date}`;
    case "short": return `${MONTHS[Number(month) - 1]} ${Number(date)}`;
    case "relative": return relativeLabel(day, today);
    default: return `${MONTHS_LONG[Number(month) - 1]} ${Number(date)}, ${year}`;
  }
}

/** A time, on this column's clock. */
export function clockText(time: string, config: DateConfig): string {
  const [hour, minute] = time.split(":").map(Number);
  return (config.timeFormat ?? "24") === "12"
    ? `${((hour + 11) % 12) + 1}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`
    : `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const join = ({ day, time }: { day: string; time: string | null }) => (time ? `${day} ${time}` : day);

export const dateProperty: PropertyTypeSpec<DateConfig> = {
  type: "date",
  label: "Date",
  empty: () => null,
  coerce: (raw) => {
    const { start, end } = dateBounds(raw as CellValue);
    if (start === null) return null;
    return end === null || end < start ? { start, end: null } : { start, end };
  },
  isEmpty: (value) => key(value) === null,
  compare: (a, b) => compareNullable(key(a), key(b), (left, right) => left < right ? -1 : left > right ? 1 : 0),
  format: (value, config) => {
    const cfg = dateConfigOf(config);
    const { start, end } = dateBounds(value);
    if (start === null) return "";
    const from = renderOne(start, cfg);
    if (end === null) return join(from);
    const to = renderOne(end, cfg);
    /* One day, two clocks: `Oct 30, 2026 14:30 → 16:30`. Repeating the date would spend
       the cell's width restating a fact it just stated, and a range *inside* a day is
       exactly the wishlist's "same day lasting 8 hours".
       An untimed end on that same day adds nothing at all (it names the same day), so it
       draws as one date rather than as a range of zero length. */
    if (from.day === to.day) return to.time ? `${join(from)} → ${to.time}` : join(from);
    return `${join(from)} → ${join(to)}`;
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
