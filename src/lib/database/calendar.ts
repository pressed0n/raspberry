/**
 * Calendar arithmetic — the part of the date picker that can be wrong without the UI
 * looking wrong.
 * ---------------------------------------------------------------------------
 * All of it is pure, and all of it speaks the **floating** date vocabulary the date
 * type already stores: `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm` when a time is set. No
 * `Date` object ever leaves this file, and nothing here converts to or from UTC,
 * because a floating date is a day on a wall calendar, not an instant. (That is the
 * same reason `date.ts` refuses to store `Z`: an instant rendered in local time is
 * how a column shows the 29th to someone west of Greenwich.)
 *
 * `Date.UTC` *is* used, but only as arithmetic — a counter of days, built at midnight
 * and read back with the `getUTC*` accessors, so no timezone can shift it by an hour
 * and no DST boundary can make a day 23 or 25 hours long.
 *
 * The picker itself is `components/database/date-panel.tsx`; this file is the part a
 * test can pin without a browser.
 */

/** Mondays. The owner writes "colour" and "reorder"; a week that starts on Sunday
 *  would be a second, quieter opinion about locale in a file that has none. */
export const WEEKDAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_MS = 86_400_000;
const pad = (value: number) => String(value).padStart(2, "0");

/** Months are **1–12** everywhere in this module, on purpose: the picker talks to a
 *  person ("October 2026"), the value talks ISO (`2026-10`), and JS's 0-based month is
 *  the one number in the chain nobody ever means. */
export type Month = number;

export interface CalendarCell {
  /** `YYYY-MM-DD`. */
  day: string;
  /** 1–31, for the label. */
  dom: number;
  /** Belongs to the month before or after — drawn, and clickable, but dimmed. */
  outside: boolean;
}

export interface MonthView {
  year: number;
  /** 1–12. */
  month: Month;
}

export function dayKey(year: number, month: Month, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function daysInMonth(year: number, month: Month): number {
  /* Day 0 of the next month is the last day of this one — the one calendar fact that
     is easier to ask the platform than to write out as a table of thirt(y|one)s. */
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthOf(day: string): MonthView {
  return { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) };
}

export function shiftMonth({ year, month }: MonthView, delta: number): MonthView {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function monthTitle({ year, month }: MonthView): string {
  return `${MONTH_NAMES[month - 1] ?? ""} ${year}`;
}

/** Today, as a floating day. Local, because the picker's "today" is the wall calendar
 *  in front of the person using it. */
export function todayKey(now: Date = new Date()): string {
  return dayKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function addDays(day: string, delta: number): string {
  const at = new Date(`${day}T00:00:00Z`);
  return new Date(at.getTime() + delta * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Whole days from `from` to `to` — negative in the past, 0 for the same day.
 *
 * The subtraction happens in UTC midnight space, for the same reason `addDays` does: two
 * local midnights can be 23 or 25 hours apart, and a difference that rounds to 0.96 days
 * would make "Yesterday" mean nothing on the day the clocks change.
 */
export function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** The same day-of-month inside another month, clamped — 31 January → February is the
 *  28th, not the 3rd of March. */
export function dayInMonth({ year, month }: MonthView, day: number): string {
  return dayKey(year, month, Math.min(day, daysInMonth(year, month)));
}

/**
 * Six weeks of seven, always. A fixed row count is what stops the panel resizing as the
 * month changes — a grid that grows from five rows to six moves every control below it,
 * including the button the pointer is resting on.
 *
 * The leading and trailing days are real days (last of the previous month, first of the
 * next), so pressing one is a click on a date, not a dead cell.
 */
export function monthGrid({ year, month }: MonthView, weekStart = 1): CalendarCell[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  /* How many trailing days of the previous month sit in the first row. */
  const lead = (first.getUTCDay() - weekStart + 7) % 7;
  const origin = first.getTime() - lead * DAY_MS;
  const weeks: CalendarCell[][] = [];
  for (let week = 0; week < 6; week += 1) {
    const row: CalendarCell[] = [];
    for (let index = 0; index < 7; index += 1) {
      const at = new Date(origin + (week * 7 + index) * DAY_MS);
      const y = at.getUTCFullYear();
      const m = at.getUTCMonth() + 1;
      const d = at.getUTCDate();
      row.push({ day: dayKey(y, m, d), dom: d, outside: y !== year || m !== month });
    }
    weeks.push(row);
  }
  return weeks;
}

/* ---------------------------------------------------------------------------
   A stored value, in two halves
   ------------------------------------------------------------------------- */

export interface FloatingParts {
  day: string | null;
  /** `HH:mm`, or null when the value has no time. */
  time: string | null;
}

export function splitFloating(value: string | null): FloatingParts {
  if (!value) return { day: null, time: null };
  const [day, time] = value.split("T");
  return { day, time: time ? time.slice(0, 5) : null };
}

export function joinFloating(day: string | null, time: string | null): string | null {
  if (!day) return null;
  return time ? `${day}T${time}` : day;
}

/**
 * `14:30`, `1430`, `930`, `14.30` and `9` all mean a time; `25:00` and `12:75` mean
 * nothing and answer null so the caller can restore the field instead of writing a
 * value the server would then throw away.
 *
 * One or two digits are an **hour** (`9` → `09:00`), because that is what a person
 * types when the minute is on the hour; three or four are `Hmm`/`HHmm`.
 */
export function parseTimeInput(text: string): string | null {
  const trimmed = text.trim();
  /* A separator means two fields, and either may be a single digit: `9:5` is 09:05, and
     reading it as the number 95 (the bare-digits rule below) would refuse a time a person
     can type in half a second. */
  const split = trimmed.split(/[:.]/);
  if (split.length === 2) {
    if (!/^\d*$/.test(split[0]) || !/^\d*$/.test(split[1])) return null;
    if (split[0] === "" && split[1] === "") return null;
    const hours = Number(split[0] || 0);
    const minutes = Number(split[1] || 0);
    if (hours > 23 || minutes > 59) return null;
    return `${pad(hours)}:${pad(minutes)}`;
  }
  if (split.length > 2) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits === "") return null;
  const hours = digits.length <= 2 ? Number(digits) : Number(digits.slice(0, -2));
  const minutes = digits.length <= 2 ? 0 : Number(digits.slice(-2));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours > 23 || minutes > 59) return null;
  return `${pad(hours)}:${pad(minutes)}`;
}

/**
 * Move a time by whole minutes, wrapping at midnight — the arrow keys in the field.
 * A value with no time steps from 00:00 rather than refusing, so the first press of
 * an arrow is the way *into* a time instead of a dead key.
 */
export function stepTime(time: string | null, minutes: number): string {
  const [h, m] = (time ?? "00:00").split(":").map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/**
 * Two bounds, put back in order.
 *
 * A comparison on the floating strings *is* a comparison of the moments they name,
 * including the date-only case: `"2026-10-30"` is a prefix of `"2026-10-30T09:00"`,
 * so the untimed day sorts first — exactly the reading where a day with no time is
 * its own midnight. Which is why an untimed end on the start's own day lands *before*
 * a timed start and swaps, and why the picker hands the end the start's time in that
 * one case (see `date-panel.tsx`, `pick`).
 *
 * An end with no start is the start: a range needs two ends, and keeping a lone end
 * would be a value the cell cannot draw.
 */
export function orderBounds(start: string | null, end: string | null): { start: string | null; end: string | null } {
  if (!start) return { start: end ?? null, end: null };
  if (!end || end >= start) return { start, end };
  return { start: end, end: start };
}
