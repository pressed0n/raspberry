import { dateOrNull, numberArg, requireInstant, textArg, unitArg, type Arg, type FormulaFunction } from "../calls";
import {
  addUnits, dateFrom, endOfDay, floatingOf, formatWithTokens, parseDateText,
  startOfDay, unitsBetween, type FormulaUnit,
} from "../dates";
import type { FormulaDate, FormulaValue } from "../values";

/**
 * Date.
 * ---------------------------------------------------------------------------
 * Dates here are the record a Date column stores (`{ start, end? }`), so a formula can
 * hand one straight to `prop("Due")` and back without a conversion step, and a formula
 * result can be read by the date cell's own formatter.
 *
 * Every function answers **empty** when the date is missing rather than failing: a
 * table where one row has no due date should show a blank in "days left", not a red
 * cell that hides the five rows that are fine.
 *
 * The `Date.` spellings are aliases, not a second set: `Date.dateAdd(x, 1, "weeks")` and
 * `dateAdd(x, 1, "weeks")` are the same function, which is what makes a formula copied
 * out of Notion's newer editor run unchanged.
 */

const DATE_ALIASES = (name: string) => [`Date.${name}`];

function withDate(args: Arg[], index: number, name: string, run: (date: FormulaDate, at: Date) => FormulaValue): FormulaValue {
  const value = dateOrNull(args, index, name);
  if (!value) return null;
  return run(value, requireInstant(value, name));
}

export const dateFunctions: FormulaFunction[] = [
  {
    name: "now",
    aka: DATE_ALIASES("now"),
    category: "Date",
    signature: "now()",
    summary: "The moment this formula is evaluated, to the minute.",
    examples: [{ code: "formatDate(now(), \"YYYY-MM-DD\")" }],
    min: 0,
    max: 0,
    run: (_args, context) => ({ start: floatingOf(context.now) }),
  },
  {
    name: "today",
    aka: DATE_ALIASES("today"),
    category: "Date",
    signature: "today()",
    summary: "Today, with no time on it — the date a day comparison should use.",
    examples: [{ code: "formatDate(today(), \"dddd\")" }],
    min: 0,
    max: 0,
    run: (_args, context) => startOfDay({ start: floatingOf(context.now) }),
  },
  {
    name: "dateAdd",
    aka: DATE_ALIASES("dateAdd"),
    category: "Date",
    signature: 'dateAdd(date, amount, unit)',
    summary: 'Moves a date forward: "days", "weeks", "months", "years", and down to milliseconds. A month clamps — 31 Jan plus a month is 28 Feb.',
    examples: [
      { code: 'dateAdd(parseDate("2026-10-30"), 1, "weeks")', result: "November 6, 2026" },
      { code: 'dateAdd(parseDate("2026-01-31"), 1, "months")', result: "February 28, 2026" },
    ],
    min: 3,
    max: 3,
    run: (args) => dateAddBy(args, 1, "dateAdd"),
  },
  {
    name: "dateSubtract",
    aka: DATE_ALIASES("dateSubtract"),
    category: "Date",
    signature: "dateSubtract(date, amount, unit)",
    summary: "Moves a date backward: the same units as dateAdd, in the other direction.",
    examples: [{ code: 'dateSubtract(parseDate("2026-10-30"), 2, "days")', result: "October 28, 2026" }],
    min: 3,
    max: 3,
    run: (args) => dateAddBy(args, -1, "dateSubtract"),
  },
  {
    name: "dateBetween",
    aka: DATE_ALIASES("dateBetween"),
    category: "Date",
    signature: "dateBetween(start, end, unit)",
    summary: "How far it is from start to end, in whole units of your choosing. Positive when the end is later — so \"days since\" is dateBetween(prop(\"Created\"), now(), \"days\").",
    examples: [
      { code: 'dateBetween(parseDate("2026-10-01"), parseDate("2026-10-31"), "days")', result: "30" },
      { code: 'dateBetween(parseDate("2026-01-31"), parseDate("2026-03-01"), "months")', result: "1" },
    ],
    min: 3,
    max: 3,
    run: (args) => {
      const start = dateOrNull(args, 0, "dateBetween");
      const end = dateOrNull(args, 1, "dateBetween");
      if (!start || !end) return null;
      return unitsBetween(start, end, unitArg(args, 2, "dateBetween"));
    },
  },
  {
    name: "formatDate",
    aka: DATE_ALIASES("formatDate"),
    category: "Date",
    signature: 'formatDate(date, pattern)',
    summary: 'A date as text, in a pattern you write: YYYY, MMMM, D, dddd, HH, mm. Put literal words in [square brackets].',
    examples: [
      { code: 'formatDate(parseDate("2026-10-30"), "YYYY-MM-DD")', result: "2026-10-30" },
      { code: 'formatDate(parseDate("2026-10-30"), "D MMMM YYYY")', result: "30 October 2026" },
    ],
    min: 2,
    max: 2,
    run: (args) => {
      const date = dateOrNull(args, 0, "formatDate");
      return date ? formatWithTokens(date, textArg(args, 1, "formatDate")) : null;
    },
  },
  {
    name: "parseDate",
    category: "Date",
    signature: "parseDate(text)",
    summary: "Text as a date. Anything that is not a date gives an empty cell.",
    examples: [
      { code: 'formatDate(parseDate("2026-10-30"), "D MMM YYYY")', result: "30 Oct 2026" },
      { code: 'parseDate("next tuesday")' },
    ],
    min: 1,
    max: 1,
    run: (args) => {
      const written = parseDateText(textArg(args, 0, "parseDate"));
      return written ? { start: written } : null;
    },
  },
  {
    name: "dateStart",
    aka: DATE_ALIASES("dateStart"),
    category: "Date",
    signature: "dateStart(date)",
    summary: "The start of the day the date is on — midnight, with the time removed.",
    examples: [{ code: 'formatDate(dateStart(parseDate("2026-10-30T14:30")), "YYYY-MM-DD HH:mm")', result: "2026-10-30 00:00" }],
    min: 1,
    max: 1,
    run: (args) => {
      const date = dateOrNull(args, 0, "dateStart");
      return date ? startOfDay(date) : null;
    },
  },
  {
    name: "dateEnd",
    category: "Date",
    signature: "dateEnd(date)",
    summary: "The end of the day the date is on — 23:59.",
    examples: [{ code: 'formatDate(dateEnd(parseDate("2026-10-30T14:30")), "YYYY-MM-DD HH:mm")', result: "2026-10-30 23:59" }],
    min: 1,
    max: 1,
    run: (args) => {
      const date = dateOrNull(args, 0, "dateEnd");
      return date ? endOfDay(date) : null;
    },
  },
  {
    name: "year",
    aka: DATE_ALIASES("year"),
    category: "Date",
    signature: "year(date)",
    summary: "The year of a date.",
    examples: [{ code: 'year(parseDate("2026-10-30"))', result: "2026" }],
    min: 1,
    max: 1,
    run: (args) => withDate(args, 0, "year", (_value, at) => at.getFullYear()),
  },
  {
    name: "month",
    aka: DATE_ALIASES("month"),
    category: "Date",
    signature: "month(date)",
    summary: "The month as a number, 1 for January.",
    examples: [{ code: 'month(parseDate("2026-10-30"))', result: "10" }],
    min: 1,
    max: 1,
    run: (args) => withDate(args, 0, "month", (_value, at) => at.getMonth() + 1),
  },
  {
    name: "day",
    aka: DATE_ALIASES("day"),
    category: "Date",
    signature: "day(date)",
    summary: "The day of the month.",
    examples: [{ code: 'day(parseDate("2026-10-30"))', result: "30" }],
    min: 1,
    max: 1,
    run: (args) => withDate(args, 0, "day", (_value, at) => at.getDate()),
  },
  {
    name: "hour",
    aka: DATE_ALIASES("hour"),
    category: "Date",
    signature: "hour(date)",
    summary: "The hour, on a 24-hour clock.",
    examples: [{ code: 'hour(parseDate("2026-10-30T14:30"))', result: "14" }],
    min: 1,
    max: 1,
    run: (args) => withDate(args, 0, "hour", (_value, at) => at.getHours()),
  },
  {
    name: "minute",
    aka: DATE_ALIASES("minute"),
    category: "Date",
    signature: "minute(date)",
    summary: "The minute.",
    examples: [{ code: 'minute(parseDate("2026-10-30T14:30"))', result: "30" }],
    min: 1,
    max: 1,
    run: (args) => withDate(args, 0, "minute", (_value, at) => at.getMinutes()),
  },
  {
    name: "second",
    aka: DATE_ALIASES("second"),
    category: "Date",
    signature: "second(date)",
    summary: "The second.",
    examples: [{ code: 'second(parseDate("2026-10-30T14:30:15"))', result: "15" }],
    min: 1,
    max: 1,
    run: (args) => withDate(args, 0, "second", (_value, at) => at.getSeconds()),
  },
  {
    name: "weekday",
    aka: DATE_ALIASES("weekday"),
    category: "Date",
    signature: "weekday(date)",
    summary: "The day of the week as a number: 0 is Sunday, 6 is Saturday.",
    examples: [{ code: 'weekday(parseDate("2026-10-30"))', result: "5" }],
    min: 1,
    max: 1,
    run: (args) => withDate(args, 0, "weekday", (_value, at) => at.getDay()),
  },
  {
    name: "timestamp",
    aka: DATE_ALIASES("timestamp"),
    category: "Date",
    signature: "timestamp(date)",
    summary: "The date as milliseconds since 1 January 1970, on this machine's clock.",
    examples: [{ code: 'timestamp(parseDate("1970-01-01T00:00"))' }],
    min: 1,
    max: 1,
    run: (args) => withDate(args, 0, "timestamp", (_value, at) => at.getTime()),
  },
  {
    name: "fromTimestamp",
    aka: DATE_ALIASES("fromTimestamp"),
    category: "Date",
    signature: "fromTimestamp(milliseconds)",
    summary: "Milliseconds since 1 January 1970 as a date.",
    examples: [{ code: 'formatDate(fromTimestamp(0), "YYYY-MM-DD HH:mm")' }],
    min: 1,
    max: 1,
    run: (args) => dateFrom(new Date(numberArg(args, 0, "fromTimestamp"))),
  },
  {
    name: "dateFloor",
    category: "Date",
    signature: "dateFloor(date, unit)",
    summary: "The start of the week, month or year a date falls in.",
    examples: [{ code: 'formatDate(dateFloor(parseDate("2026-10-30"), "year"), "YYYY-MM-DD")', result: "2026-01-01" }],
    min: 2,
    max: 2,
    run: (args) => {
      const date = dateOrNull(args, 0, "dateFloor");
      if (!date) return null;
      const at = requireInstant(date, "dateFloor");
      const unit = unitArg(args, 1, "dateFloor");
      const floor: FormulaUnit[] = ["weeks", "months", "years"];
      if (!floor.includes(unit)) return date;
      if (unit === "years") return dateFrom(new Date(at.getFullYear(), 0, 1));
      if (unit === "months") return dateFrom(new Date(at.getFullYear(), at.getMonth(), 1));
      const weekday = at.getDay();
      return dateFrom(new Date(at.getFullYear(), at.getMonth(), at.getDate() - weekday));
    },
  },
];

function dateAddBy(args: Arg[], sign: 1 | -1, name: string): FormulaValue {
  const date = dateOrNull(args, 0, name);
  if (!date) return null;
  const amount = Math.trunc(numberArg(args, 1, name));
  const unit = unitArg(args, 2, name);
  return addUnits(date, amount * sign, unit);
}
