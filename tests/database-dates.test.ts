// Dates — a range, two clocks, and a calendar that has to agree with the server.
//
// THE STATE THIS REPLACED
// A date cell was `<input type="date">`: one day, no end, no time, and no control for how
// the column read. The owner's list was four items long — "Option to choose end date",
// "Include time", "Option to just select start and end time in one date", "Make a better
// design and UX for it" — and none of them was reachable from a native date input.
//
// WHAT IS PINNED HERE
// 1. The arithmetic, because it is the part that can be wrong while the UI still looks
//    right: a six-week grid that always has six rows, a time typed loosely, a time stepped
//    by the arrow keys, and two bounds put back in order.
// 2. The formatter, because a range is *stored* as two ISO strings and *read* as one
//    sentence — and `Oct 30, 2026 14:30 → 16:30` is the wishlist's "same day lasting 8
//    hours" or it is a bug.
// 3. The guards, as source assertions: the native input is gone from the cell editor, and
//    the property menu offers exactly the formats the registry knows.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addDays,
  dayInMonth,
  dayKey,
  joinFloating,
  monthGrid,
  monthTitle,
  orderBounds,
  parseTimeInput,
  shiftMonth,
  splitFloating,
  stepTime,
} from "../src/lib/database/calendar";
import { dateConfigOf } from "../src/lib/database/property-types/date";
import { dateFormatChoices, formatCell, resolveProperty } from "../src/lib/database/properties";

const read = (path: string) => readFileSync(path, "utf8");
/* A guard must scan the *code*, not the prose around it. The first version of the
   `type="time"` test below failed against this very file, because the comment explains
   that `<input type="time">` was rejected — and the comment is in the file too. */
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "");
const date = resolveProperty({ type: "date" });

/** The one call site every surface uses, so a test cannot pass against a second copy. */
const shown = (value: unknown, config: Record<string, unknown> = {}) =>
  formatCell({ type: "date", config }, value as never);

/* ---------------------------------------------------------------------------
   The grid
   ------------------------------------------------------------------------- */

test("the month grid is six weeks of seven, and October 2026 starts on the right column", () => {
  const weeks = monthGrid({ year: 2026, month: 10 });
  assert.equal(weeks.length, 6, "a fixed row count is what stops the panel resizing by month");
  assert.ok(weeks.every((week) => week.length === 7));

  /* 31 October 2026 is a Saturday, so the month opens on a Thursday — three days into a
     Monday-first row. The lead is those three: 28, 29 and 30 September. */
  assert.deepEqual(
    weeks[0].map((cell) => cell.day),
    ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"],
  );
  assert.deepEqual(
    weeks[0].map((cell) => cell.outside),
    [true, true, true, false, false, false, false],
    "a leading day is real and outside: clickable, dimmed",
  );
  assert.equal(weeks[5][6].day, "2026-11-08", "the last row runs on into November");
});

test("a month that opens on a Sunday still fills from Monday", () => {
  /* 1 November 2026 is a Sunday — the last column of a Monday-first week. A grid built on
     the JS default (Sunday-first) would put it first and shift every day of the month one
     place left, which is the kind of wrong that looks fine. */
  const weeks = monthGrid({ year: 2026, month: 11 });
  assert.deepEqual(
    weeks[0].map((cell) => cell.day).slice(0, 6),
    ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"],
  );
  assert.equal(weeks[0][6].day, "2026-11-01");
});

test("months are 1-12, and shifting one walks the year in both directions", () => {
  assert.equal(monthTitle({ year: 2026, month: 10 }), "October 2026");
  assert.deepEqual(shiftMonth({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 });
  assert.deepEqual(shiftMonth({ year: 2026, month: 6 }, -7), { year: 2025, month: 11 });
});

test("stepping a day is a day, across a DST boundary too", () => {
  /* Built on UTC arithmetic: a local `Date` would make 29 March 2026 twenty-three hours
     long here, and a naive millisecond step skips or repeats a day. */
  assert.equal(addDays("2026-10-30", 1), "2026-10-31");
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-03-28", 1), "2026-03-29");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(addDays("2026-10-30", 7), "2026-11-06");
});

test("PageUp from the 31st lands on the last day of the shorter month", () => {
  assert.equal(dayInMonth({ year: 2026, month: 2 }, 31), "2026-02-28");
  assert.equal(dayInMonth({ year: 2028, month: 2 }, 31), "2028-02-29", "a leap year keeps the 29th");
  assert.equal(dayInMonth({ year: 2026, month: 4 }, 31), "2026-04-30");
  assert.equal(dayKey(2026, 1, 5), "2026-01-05");
});

/* ---------------------------------------------------------------------------
   The clock
   ------------------------------------------------------------------------- */

test("a typed time is read the way a person types it", () => {
  assert.equal(parseTimeInput("14:30"), "14:30");
  assert.equal(parseTimeInput("1430"), "14:30");
  assert.equal(parseTimeInput("930"), "09:30", "three digits are H mm");
  assert.equal(parseTimeInput("9"), "09:00", "one digit is an hour, on the hour");
  assert.equal(parseTimeInput("9:5"), "09:05");
  assert.equal(parseTimeInput(" 7.15 "), "07:15");
  assert.equal(parseTimeInput("23:59"), "23:59");
});

test("a time that means nothing is refused, not rounded", () => {
  /* Null is what lets the field restore itself. The alternative — writing 00:00 for
     "25:00" — is a silent lie about a value the server would have kept. */
  assert.equal(parseTimeInput("25:00"), null);
  assert.equal(parseTimeInput("12:75"), null);
  assert.equal(parseTimeInput(""), null);
  assert.equal(parseTimeInput("  "), null);
});

test("the arrow keys step the clock and wrap at midnight", () => {
  assert.equal(stepTime(null, 5), "00:05", "an unset time steps from midnight, so the first press works");
  assert.equal(stepTime("14:30", 5), "14:35");
  assert.equal(stepTime("14:30", -30), "14:00");
  assert.equal(stepTime("14:30", 60), "15:30");
  assert.equal(stepTime("23:58", 5), "00:03");
  assert.equal(stepTime("00:02", -5), "23:57");
});

test("a value is two halves, and joining them gives the value back", () => {
  assert.deepEqual(splitFloating("2026-10-30T14:30"), { day: "2026-10-30", time: "14:30" });
  assert.deepEqual(splitFloating("2026-10-30"), { day: "2026-10-30", time: null });
  assert.deepEqual(splitFloating(null), { day: null, time: null });
  assert.equal(joinFloating("2026-10-30", "14:30"), "2026-10-30T14:30");
  assert.equal(joinFloating("2026-10-30", null), "2026-10-30");
  assert.equal(joinFloating(null, "14:30"), null);
});

test("two bounds out of order are swapped, because the server would drop the end instead", () => {
  /* `coerce` keeps an end only when `end >= start` and *silently* nulls the rest. Swapping
     is the only outcome that keeps what the person typed. */
  assert.deepEqual(orderBounds("2026-10-30", "2026-11-02"), { start: "2026-10-30", end: "2026-11-02" });
  assert.deepEqual(orderBounds("2026-11-02", "2026-10-30"), { start: "2026-10-30", end: "2026-11-02" });
  assert.deepEqual(orderBounds("2026-10-30T14:30", "2026-10-30T16:30"), {
    start: "2026-10-30T14:30",
    end: "2026-10-30T16:30",
  });
  /* The date-only half of a day sorts before the timed half: "2026-10-30" is a prefix of
     "2026-10-30T09:00", which is exactly the reading where a day with no time is its own
     midnight. This is why the picker hands a same-day end the start's clock. */
  assert.deepEqual(orderBounds("2026-10-30T14:30", "2026-10-30"), {
    start: "2026-10-30",
    end: "2026-10-30T14:30",
  });
  assert.deepEqual(orderBounds("2026-10-30", "2026-10-30"), { start: "2026-10-30", end: "2026-10-30" });
  assert.deepEqual(orderBounds(null, "2026-10-30"), { start: "2026-10-30", end: null }, "a lone end is the start");
  assert.deepEqual(orderBounds(null, null), { start: null, end: null });
});

/* ---------------------------------------------------------------------------
   The sentence a cell shows
   ------------------------------------------------------------------------- */

const long = { format: "long", includeTime: true };

test("a range inside one day says the date once", () => {
  /* The wishlist's "same day lasting 8 hours", and the reason the formatter compares the
     two *rendered* days rather than printing `A → A`. */
  assert.equal(shown({ start: "2026-10-30T14:30", end: "2026-10-30T16:30" }, long), "30 Oct 2026 14:30 → 16:30");
});

test("a range across days names both", () => {
  assert.equal(shown({ start: "2026-10-30T14:30", end: "2026-11-02T09:00" }, long), "30 Oct 2026 14:30 → 2 Nov 2026 09:00");
  assert.equal(shown({ start: "2026-10-30", end: "2026-11-02" }, long), "30 Oct 2026 → 2 Nov 2026");
});

test("an untimed end on the start's own day is not a range at all", () => {
  assert.equal(shown({ start: "2026-10-30", end: "2026-10-30" }, long), "30 Oct 2026");
});

test("Include time off hides the clocks and keeps the values", () => {
  /* Hiding, not deleting: turning the setting back on finds the times again, and the
     stored string never lost them. */
  const value = { start: "2026-10-30T14:30", end: "2026-10-30T16:30" };
  assert.equal(shown(value, { format: "long", includeTime: false }), "30 Oct 2026");
  assert.equal(shown(value, long), "30 Oct 2026 14:30 → 16:30");
  assert.equal(shown(value), "2026-10-30", "includeTime defaults to off, so the clocks stay hidden");
  assert.equal(shown(value, { includeTime: true }), "2026-10-30 14:30 → 16:30", "the default clock is 24-hour");
});

test("the four date formats are the four the schema accepts", () => {
  const value = { start: "2026-10-30" };
  assert.equal(shown(value, { format: "iso" }), "2026-10-30");
  assert.equal(shown(value, { format: "dmy" }), "30/10/2026");
  assert.equal(shown(value, { format: "mdy" }), "10/30/2026");
  assert.equal(shown(value, { format: "long" }), "30 Oct 2026");
  assert.equal(shown(value, { format: "nonsense" }), "2026-10-30", "an unknown format falls back, never blank");
});

test("the 12-hour clock reads as a clock", () => {
  assert.equal(shown({ start: "2026-10-30T14:30" }, { format: "long", includeTime: true, timeFormat: "12" }), "30 Oct 2026 2:30 PM");
  assert.equal(shown({ start: "2026-10-30T00:05" }, { format: "long", includeTime: true, timeFormat: "12" }), "30 Oct 2026 12:05 AM");
  assert.equal(shown({ start: "2026-10-30T12:00" }, { format: "long", includeTime: true, timeFormat: "12" }), "30 Oct 2026 12:00 PM");
  assert.equal(shown({ start: "2026-10-30T14:30" }, { format: "long", includeTime: true, timeFormat: "24" }), "30 Oct 2026 14:30");
});

test("a config read from disk is filled the way the schema fills it", () => {
  assert.deepEqual(dateConfigOf(undefined), { format: "iso", includeTime: false, timeFormat: "24" });
  assert.deepEqual(dateConfigOf({ format: "sideways" }), { format: "iso", includeTime: false, timeFormat: "24" });
  assert.deepEqual(dateConfigOf({ format: "long", includeTime: true, timeFormat: "12" }), {
    format: "long",
    includeTime: true,
    timeFormat: "12",
  });
});

/* ---------------------------------------------------------------------------
   What the picker writes has to survive the server's own coercion
   ------------------------------------------------------------------------- */

test("a same-day range survives coerce, which is why the picker may write one", () => {
  assert.deepEqual(date.coerce({ start: "2026-10-30T14:30", end: "2026-10-30T16:30" }, {}), {
    start: "2026-10-30T14:30",
    end: "2026-10-30T16:30",
  });
});

test("an end before the start is dropped by coerce, silently", () => {
  /* The reason `orderBounds` exists and runs *before* the write. If this assertion ever
     flips, the swap became unnecessary — not the other way round. */
  assert.deepEqual(date.coerce({ start: "2026-11-02", end: "2026-10-30" }, {}), { start: "2026-11-02", end: null });
});

/* ---------------------------------------------------------------------------
   The guards
   ------------------------------------------------------------------------- */

test("the date cell is the picker, not a native date input", () => {
  /* The bug, as a file scan: `type="date"` was the whole feature. It cannot carry an end,
     a clock, or a range, so its return would be the owner's complaint returning. */
  const editor = code("src/components/database/cell-editor.tsx");
  assert.match(editor, /DateCell/, "the cell editor must route dates to the picker");
  assert.doesNotMatch(editor, /type="date"/, "a native date input cannot hold a range");

  const panel = code("src/components/database/date-panel.tsx");
  assert.match(panel, /End date/, "the picker must offer an end date");
  assert.match(panel, /Include time/, "the picker must offer clocks");
  assert.match(panel, /orderBounds/, "every write goes through the bound ordering");
  assert.doesNotMatch(panel, /type="date"/, "no native date input anywhere in the picker");
});

test("the property menu offers exactly the formats the registry knows", () => {
  const header = code("src/components/database/property-header.tsx");
  assert.match(header, /Date format/, "a column has to be able to say how it reads");
  assert.match(header, /Include time/, "showing clocks is a column setting, not a per-row one");
  assert.match(header, /dateFormatChoices/, "the rows come from the registry, not from a list in the menu");

  /* And the registry's list is the schema's: four, and no fifth invented here. */
  assert.deepEqual(dateFormatChoices.map((choice) => choice.format).sort(), ["dmy", "iso", "long", "mdy"]);
  for (const choice of dateFormatChoices) {
    assert.notEqual(shown({ start: "2026-10-30" }, { format: choice.format }), "", `${choice.format} must render`);
  }
});

test("the picker's clock is not a native time input either", () => {
  /* `<input type="time">` would be a second browser widget inside a surface this component
     draws itself — and on Windows it looks like the date input the owner rejected. */
  const panel = code("src/components/database/date-panel.tsx");
  assert.doesNotMatch(panel, /type="time"/);
  assert.match(panel, /parseTimeInput/);
});
