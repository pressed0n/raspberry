import { dateProperty } from "../property-types/date";
import type { FormulaDate } from "./values";

/**
 * Dates in a formula.
 * ---------------------------------------------------------------------------
 * A formula date is the record a Date column already stores: a *floating* wall clock
 * (`2026-10-30` or `2026-10-30T14:30`), no timezone, no epoch. Floating is the right
 * shape here for the reason `date.ts` gives: a birthday is not an instant, and a
 * formula that added "one day" across a DST boundary must land on the next date, not
 * on 23:00 the same evening.
 *
 * So the arithmetic below parses a floating string into a local `Date`, does the
 * calendar work, and writes it back out as floating. `new Date("2026-10-30")` is
 * deliberately *not* used: that parses as UTC midnight, which is the 29th for anyone
 * west of Greenwich, and a formula that answers "yesterday" for today is worse than
 * one that answers nothing.
 */

const FLOATING = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

export const FORMULA_UNITS = [
  "years", "quarters", "months", "weeks", "days", "hours", "minutes", "seconds", "milliseconds",
] as const;

export type FormulaUnit = typeof FORMULA_UNITS[number];

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

/** A floating string as a `Date` on this machine's wall clock, or null. */
export function parseFloating(text: string): Date | null {
  const match = FLOATING.exec(text.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const value = new Date(
    Number(year), Number(month) - 1, Number(day),
    Number(hour ?? 0), Number(minute ?? 0), Number(second ?? 0), 0,
  );
  /* `new Date(2026, 1, 31)` is March 3rd — a rollover, not a date. A formula that
     silently answers the wrong day is the one failure worth refusing outright. */
  if (value.getFullYear() !== Number(year) || value.getMonth() !== Number(month) - 1 || value.getDate() !== Number(day)) return null;
  /* A trailing `T00:00` is the same day as no time at all; dropping it keeps
     `2026-10-30T00:00` and `2026-10-30` from comparing unequal for no reason. */
  return value;
}

export function floatingOf(value: Date): string {
  const day = `${pad(value.getFullYear(), 4)}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  const hours = value.getHours();
  const minutes = value.getMinutes();
  const seconds = value.getSeconds();
  if (hours === 0 && minutes === 0 && seconds === 0) return day;
  return seconds === 0 ? `${day}T${pad(hours)}:${pad(minutes)}` : `${day}T${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Anything a person might paste as a date, as floating text — `2026-10-30`,
 * `2026-10-30T14:30`, or `30 Oct 2026` read in this machine's timezone. Returns null
 * rather than a guess: `parseDate("next tuesday")` is not a date anyone wrote down.
 */
export function parseDateText(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const floating = parseFloating(trimmed);
  if (floating) return floatingOf(floating);
  const at = new Date(trimmed);
  return Number.isNaN(at.getTime()) ? null : floatingOf(at);
}

/** A stored date record as one instant to do arithmetic on: the start, or the end of
 *  a range when the formula asks for it. */
export function instantOf(value: FormulaDate, edge: "start" | "end" = "start"): Date | null {
  return parseFloating(edge === "end" ? value.end ?? value.start : value.start);
}

export function dateFrom(at: Date): FormulaDate {
  return { start: floatingOf(at) };
}

/** What a formula date prints as. Delegated to the Date column's own formatter, with
 *  times on: two formatters for "a date" would eventually disagree in the same table. */
export function dateText(value: FormulaDate): string {
  return dateProperty.format(value as unknown as Parameters<typeof dateProperty.format>[0], { format: "full", includeTime: true, timeFormat: "24" });
}

export function unitFrom(raw: string): FormulaUnit | null {
  const text = raw.trim().toLowerCase();
  const singular = text.endsWith("s") ? text.slice(0, -1) : text;
  const found = FORMULA_UNITS.find((unit) => unit === `${singular}s`);
  return found ?? null;
}

/** Month arithmetic clamps instead of rolling over: 31 Jan + 1 month is 28 Feb, which
 *  is what every calendar does and what a person expects a "due next month" to say. */
function addMonths(at: Date, months: number): Date {
  const next = new Date(at.getTime());
  const day = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, last));
  return next;
}

export function addUnits(value: FormulaDate, amount: number, unit: FormulaUnit): FormulaDate {
  const at = instantOf(value);
  if (!at) return value;
  const next = new Date(at.getTime());
  switch (unit) {
    case "years": return dateFrom(addMonths(next, Math.trunc(amount) * 12));
    case "quarters": return dateFrom(addMonths(next, Math.trunc(amount) * 3));
    case "months": return dateFrom(addMonths(next, Math.trunc(amount)));
    case "weeks": next.setDate(next.getDate() + Math.trunc(amount) * 7); break;
    case "days": next.setDate(next.getDate() + Math.trunc(amount)); break;
    case "hours": next.setHours(next.getHours() + Math.trunc(amount)); break;
    case "minutes": next.setMinutes(next.getMinutes() + Math.trunc(amount)); break;
    case "seconds": next.setSeconds(next.getSeconds() + Math.trunc(amount)); break;
    case "milliseconds": next.setMilliseconds(next.getMilliseconds() + Math.trunc(amount)); break;
  }
  return dateFrom(next);
}

/**
 * `dateBetween(start, end, unit)` — the distance from start to end, so a positive
 * number means "end is later". Whole units, so a due date three hours ago is 0 days
 * rather than -0.125; months and years are counted on the calendar, because a month
 * is not 30 days and February must not answer 0.
 */
export function unitsBetween(start: FormulaDate, end: FormulaDate, unit: FormulaUnit): number {
  const from = instantOf(start);
  const to = instantOf(end, "end");
  if (!from || !to) return 0;
  if (unit === "months" || unit === "quarters" || unit === "years") {
    let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
    /* Half a month is not a month: stepping back one when the day has not arrived
       yet is what makes 30 Jan → 1 Mar read as one month rather than two. */
    if (months > 0 && to.getDate() < from.getDate()) months -= 1;
    if (months < 0 && to.getDate() > from.getDate()) months += 1;
    if (unit === "months") return months;
    const monthsPer = unit === "years" ? 12 : 3;
    return Math.trunc(months / monthsPer);
  }
  const span = to.getTime() - from.getTime();
  const size = {
    weeks: 7 * 86_400_000, days: 86_400_000, hours: 3_600_000,
    minutes: 60_000, seconds: 1_000, milliseconds: 1,
  }[unit];
  return Math.trunc(span / size);
}

const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = MONTHS_LONG.map((name) => name.slice(0, 3));
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAYS_SHORT = WEEKDAYS_LONG.map((name) => name.slice(0, 3));

/**
 * `formatDate(date, "MMM D, YYYY")`.
 *
 * A token formatter, not `Intl.DateTimeFormat`: the interesting format strings are
 * *patterns* ("D MMMM YYYY" in one column, "YYYY-MM-DD" in another), Intl has no
 * pattern syntax, and the date column's own named formats already cover the common
 * cases. Longest token first, so `YYYY` is never read as `YY` followed by `YY`.
 */
export function formatWithTokens(value: FormulaDate, pattern: string): string {
  const at = instantOf(value);
  if (!at) return "";
  const hours12 = ((at.getHours() + 11) % 12) + 1;
  const tokens: Array<[string, string]> = [
    ["YYYY", pad(at.getFullYear(), 4)],
    ["YY", pad(at.getFullYear() % 100)],
    ["MMMM", MONTHS_LONG[at.getMonth()]],
    ["MMM", MONTHS_SHORT[at.getMonth()]],
    ["MM", pad(at.getMonth() + 1)],
    ["M", String(at.getMonth() + 1)],
    ["DD", pad(at.getDate())],
    ["D", String(at.getDate())],
    ["dddd", WEEKDAYS_LONG[at.getDay()]],
    ["ddd", WEEKDAYS_SHORT[at.getDay()]],
    ["HH", pad(at.getHours())],
    ["H", String(at.getHours())],
    ["hh", pad(hours12)],
    ["h", String(hours12)],
    ["mm", pad(at.getMinutes())],
    ["m", String(at.getMinutes())],
    ["ss", pad(at.getSeconds())],
    ["s", String(at.getSeconds())],
    ["A", at.getHours() < 12 ? "AM" : "PM"],
    ["a", at.getHours() < 12 ? "am" : "pm"],
  ];
  const patternKeys = tokens.map(([token]) => token).join("|");
  /* A literal in brackets survives the tokeniser — `formatDate(d, "D [days] from now")`
     is how a pattern says the word "days" rather than "d-am-ys". Every token formatter
     has this hole and this is the smallest plug for it. */
  const literals: string[] = [];
  const held = pattern.replace(/\[([^\]]*)\]/g, (_, literal: string) => {
    literals.push(literal);
    return `\u0000${literals.length - 1}\u0000`;
  });
  const written = held.replace(new RegExp(patternKeys, "g"), (match) => tokens.find(([token]) => token === match)?.[1] ?? match);
  return written.replace(/\u0000(\d+)\u0000/g, (_, index: string) => literals[Number(index)] ?? "");
}

export function startOfDay(value: FormulaDate): FormulaDate {
  const at = instantOf(value);
  if (!at) return value;
  return dateFrom(new Date(at.getFullYear(), at.getMonth(), at.getDate()));
}

export function endOfDay(value: FormulaDate): FormulaDate {
  const at = instantOf(value, "end");
  if (!at) return value;
  return dateFrom(new Date(at.getFullYear(), at.getMonth(), at.getDate(), 23, 59));
}
