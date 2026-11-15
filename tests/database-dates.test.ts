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
  todayKey,
} from "../src/lib/database/calendar";
import { dateConfigOf, relativeLabel } from "../src/lib/database/property-types/date";
import { configSchemas, dateFormats } from "../src/lib/database/types";
import { dateFormatChoices, dateFormatLabel, formatCell, resolveProperty } from "../src/lib/database/properties";

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

const full = { format: "full", includeTime: true };

test("a range inside one day says the date once", () => {
  /* The wishlist's "same day lasting 8 hours", and the reason the formatter compares the
     two *rendered* days rather than printing `A → A`. */
  assert.equal(shown({ start: "2026-10-30T14:30", end: "2026-10-30T16:30" }, full), "October 30, 2026 14:30 → 16:30");
});

test("a range across days names both", () => {
  assert.equal(
    shown({ start: "2026-10-30T14:30", end: "2026-11-02T09:00" }, full),
    "October 30, 2026 14:30 → November 2, 2026 09:00",
  );
  assert.equal(shown({ start: "2026-10-30", end: "2026-11-02" }, full), "October 30, 2026 → November 2, 2026");
});

test("an untimed end on the start's own day is not a range at all", () => {
  assert.equal(shown({ start: "2026-10-30", end: "2026-10-30" }, full), "October 30, 2026");
});

test("Include time off hides the clocks and keeps the values", () => {
  /* Hiding, not deleting: turning the setting back on finds the times again, and the
     stored string never lost them. */
  const value = { start: "2026-10-30T14:30", end: "2026-10-30T16:30" };
  assert.equal(shown(value, { format: "full", includeTime: false }), "October 30, 2026");
  assert.equal(shown(value, full), "October 30, 2026 14:30 → 16:30");
  assert.equal(shown(value), "October 30, 2026", "includeTime defaults to off, so the clocks stay hidden");
  assert.equal(shown(value, { includeTime: true }), "October 30, 2026 14:30 → 16:30", "the default clock is 24-hour");
});

test("the six date formats are the six the schema accepts", () => {
  const value = { start: "2026-10-30" };
  assert.equal(shown(value, { format: "full" }), "October 30, 2026");
  assert.equal(shown(value, { format: "short" }), "Oct 30");
  assert.equal(shown(value, { format: "mdy" }), "10/30/2026");
  assert.equal(shown(value, { format: "dmy" }), "30/10/2026");
  assert.equal(shown(value, { format: "ymd" }), "2026/10/30");
  assert.equal(shown(value, { format: "nonsense" }), "October 30, 2026", "an unknown format falls back, never blank");
});

/* `Relative` is the one format whose answer depends on the day it is read on, so it takes
   the day as an argument. Every cutoff is pinned here, because "Last Saturday" that is
   really "Saturday" is the kind of bug nobody reports — it is only wrong by one word. */
test("Relative names the day the way a person would", () => {
  const today = "2026-10-31"; /* a Saturday */
  assert.equal(relativeLabel("2026-10-31", today), "Today");
  assert.equal(relativeLabel("2026-10-30", today), "Yesterday");
  assert.equal(relativeLabel("2026-11-01", today), "Tomorrow");
  /* Inside the week ahead: the weekday, because "Thursday" is sooner to read than a date. */
  assert.equal(relativeLabel("2026-11-05", today), "Thursday");
  assert.equal(relativeLabel("2026-11-06", today), "Friday");
  /* Inside the week behind: the same word with "Last", which is the difference between a
     day that has gone and a day that is coming. */
  assert.equal(relativeLabel("2026-10-29", today), "Last Thursday");
  assert.equal(relativeLabel("2026-10-25", today), "Last Sunday");
  /* Beyond both, the full date — a weekday name seven days out is ambiguous with today. */
  assert.equal(relativeLabel("2026-11-07", today), "November 7, 2026");
  assert.equal(relativeLabel("2026-10-24", today), "October 24, 2026");
  /* And the whole formatter reads it, clocks included. The value is built from the *real*
     today on purpose — this line is the one that exercises `formatCell` with no injected
     day, and a hard-coded `2026-10-31` made it pass only on the day it was written; it
     reported "Yesterday 09:00" the next morning. */
  assert.equal(
    shown({ start: `${todayKey()}T09:00` }, { format: "relative", includeTime: true }),
    "Today 09:00",
  );
});

test("the 12-hour clock reads as a clock", () => {
  assert.equal(shown({ start: "2026-10-30T14:30" }, { format: "full", includeTime: true, timeFormat: "12" }), "October 30, 2026 2:30 PM");
  assert.equal(shown({ start: "2026-10-30T00:05" }, { format: "full", includeTime: true, timeFormat: "12" }), "October 30, 2026 12:05 AM");
  assert.equal(shown({ start: "2026-10-30T12:00" }, { format: "full", includeTime: true, timeFormat: "12" }), "October 30, 2026 12:00 PM");
  assert.equal(shown({ start: "2026-10-30T14:30" }, { format: "full", includeTime: true, timeFormat: "24" }), "October 30, 2026 14:30");
});

test("a config read from disk is filled the way the schema fills it", () => {
  assert.deepEqual(dateConfigOf(undefined), { format: "full", includeTime: false, timeFormat: "24" });
  assert.deepEqual(dateConfigOf({ format: "sideways" }), { format: "full", includeTime: false, timeFormat: "24" });
  assert.deepEqual(dateConfigOf({ format: "full", includeTime: true, timeFormat: "12" }), {
    format: "full",
    includeTime: true,
    timeFormat: "12",
  });
});

test("the two retired format names still name a format", () => {
  /* `iso` and `long` are what this vocabulary was called before it used the words a person
     uses. A column that chose one of them must keep rendering — falling back to the default
     would silently re-format somebody's column, which is the worse failure of the two.
     `configSchemas.date` performs the same rewrite on the way in, so a save lands canonical. */
  assert.deepEqual(dateConfigOf({ format: "iso" }), { format: "ymd", includeTime: false, timeFormat: "24" });
  assert.deepEqual(dateConfigOf({ format: "long" }), { format: "full", includeTime: false, timeFormat: "24" });
  assert.deepEqual(configSchemas.date.parse({ format: "iso" }), { format: "ymd", includeTime: false, timeFormat: "24" });
  assert.deepEqual(configSchemas.date.parse({ format: "long" }), { format: "full", includeTime: false, timeFormat: "24" });
  assert.deepEqual(configSchemas.date.parse({}), { format: "full", includeTime: false, timeFormat: "24" });
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

  /* The six rows live in `date-format-rows.tsx` and are imported, not retyped. This assertion
     used to read `dateFormatChoices` in the header — which passed while the *picker* grew its
     own copy of the same idea. The list is the thing that must not be duplicated; where it is
     drawn is a detail. */
  const rows = code("src/components/database/date-format-rows.tsx");
  assert.match(rows, /dateFormatChoices/, "the rows come from the registry, not from a list in a menu");
  assert.match(header, /import \{[^}]*DateFormatRows[^}]*\} from "\.\/date-format-rows"/,
    "the header draws the shared rows");

  /* And the registry's list is the schema's: six, and no seventh invented here. */
  assert.deepEqual(dateFormatChoices.map((choice) => choice.format).sort(), ["dmy", "full", "mdy", "relative", "short", "ymd"]);
  assert.deepEqual(
    [...dateFormatChoices.map((choice) => choice.format)].sort(),
    [...dateFormats].sort(),
    "the menu and the schema accept the same words, spelled the same way",
  );
  for (const choice of dateFormatChoices) {
    assert.notEqual(shown({ start: "2026-10-30" }, { format: choice.format }), "", `${choice.format} must render`);
  }
});

/* The owner's ask: *"Date format should also be accessible in the dropdown where you're
   selecting the date ... it would change the format for the whole column."*

   Three things have to be true at once, and only the first one is visible: the row exists in
   the picker, it opens the *shared* six rows rather than a copy, and it writes the property's
   config — the column's — instead of the cell's value. */
test("the picker carries the same format list as the header, and it writes the column", () => {
  const panel = code("src/components/database/date-panel.tsx");
  const header = code("src/components/database/property-header.tsx");
  const rows = code("src/components/database/date-format-rows.tsx");

  assert.match(panel, /import \{[^}]*DateFormatRows[^}]*\} from "\.\/date-format-rows"/,
    "the picker draws the shared rows, not a second copy of the six");
  assert.match(panel, /import \{[^}]*TimeFormatRows[^}]*\} from "\.\/date-format-rows"/,
    "and the clocks too");
  /* Importing is not enough — a file can import the rows and then draw its own beside them.
     These three assertions make the *list* single-sourced: exactly one file maps it. */
  assert.match(rows, /dateFormatChoices\.map/, "one place draws the six");
  assert.doesNotMatch(panel, /dateFormatChoices\.map/, "the picker must not draw a copy of them");
  assert.doesNotMatch(header, /dateFormatChoices\.map/, "nor may the header");
  assert.doesNotMatch(header, /timeFormatChoices\.map/, "and the clocks are drawn once, here too");

  /* The picker's list is a *fly-out*, not a body swap. It shipped as a pane first and the owner
     sent it back: "those options should open next to the dropdown". So the surface is asserted,
     not just the row — the app's one submenu, imported rather than rebuilt, and no pane head,
     because a fly-out has nothing to go back from. */
  assert.match(panel, /import \{[^}]*MenuSub[^}]*\} from "\.\/menu"/,
    "the fly-out is the shared submenu, not a second placement implementation");
  assert.doesNotMatch(panel, /pane === "format"|MenuPaneHead/,
    "the body swap is gone: the calendar stays behind the list while a format is chosen");

  /* Sliced from the row that opens it to its closing tag, so these are about that submenu and
     not about the panel, which legitimately commits cell values everywhere else. */
  const flyOut = panel.slice(panel.indexOf('label="Date format"'), panel.indexOf("</MenuSub>"));
  assert.match(flyOut, /label="Date format"/, "the row the owner asked for");
  assert.match(flyOut, /onConfig\(\{ format \}\)/, "picking a format writes the property config");
  assert.doesNotMatch(flyOut, /onCommit/, "a format is not a value — it must never be committed as one");
  assert.match(rows, /onPick\(choice\.format\)/, "both surfaces pick through the shared list");
  assert.match(header, /onConfig\?\.\(\{ format \}\)/, "and both write the same key");
});

test("a format row names the format, including the two retired spellings", () => {
  /* `iso` and `long` are what this vocabulary was called before it used words, and the
     owner's own column still stores `{"format":"iso"}`. A row that read `undefined` there —
     or `Full date`, which is the wrong answer rather than no answer — would be a column
     labelled with something it is not. */
  assert.equal(dateFormatLabel("full"), "Full date");
  assert.equal(dateFormatLabel("short"), "Short date");
  assert.equal(dateFormatLabel("mdy"), "Month/Day/Year");
  assert.equal(dateFormatLabel("dmy"), "Day/Month/Year");
  assert.equal(dateFormatLabel("ymd"), "Year/Month/Day");
  assert.equal(dateFormatLabel("relative"), "Relative");
  assert.equal(dateFormatLabel("iso"), "Year/Month/Day", "iso is read as ymd, so it is named as ymd");
  assert.equal(dateFormatLabel("long"), "Full date");
  assert.equal(dateFormatLabel(undefined), "Full date", "a column that never saved one reads as Full date");
  assert.equal(dateFormatLabel("nonsense"), "Full date", "and so does a word the schema would have refused");
  /* The name a row shows and the config the formatter fills agree, value for value. */
  for (const choice of dateFormatChoices) {
    assert.equal(choice.label, dateFormatLabel(choice.format));
    assert.equal(dateConfigOf({ format: choice.format }).format, choice.format);
  }
});

test("a pane gives the keyboard back on both sides of the swap", () => {
  /* Opening a pane removes the row that had focus, and going back removes the back button. In
     both directions `document.activeElement` lands on `<body>`, which is *outside* the surface,
     so `onMenuKeys` never hears another press: the pane becomes a pointer-only room. One shared
     head, one shared way back.

     One pane is left — the property menu's Status groups. The date picker's format list was the
     other; it is a fly-out now, and a fly-out never removes the focused row, so it needs
     neither half. Asserted, so a body swap introduced there again would have to bring the fix
     with it. */
  const menuSrc = code("src/components/database/menu.tsx");
  assert.match(menuSrc, /className="db-prop-icon-btn db-menu-back"[^>]*autoFocus/,
    "entering a pane focuses the way out");
  assert.match(menuSrc, /export function focusMenuRow/, "and the way back is a shared call, not a query in each pane");

  const panel = code("src/components/database/date-panel.tsx");
  assert.doesNotMatch(panel, /focusMenuRow|MenuPaneHead/,
    "the picker swaps no body, so it returns from none — and must not pretend to");

  const header = code("src/components/database/property-header.tsx");
  assert.match(header, /focusKey="status-groups"/,
    "src/components/database/property-header.tsx must name the row its pane came from");
  assert.match(header, /focusMenuRow\("status-groups"\)/,
    "src/components/database/property-header.tsx must put the keyboard back on it");
});

test("the picker's clock is not a native time input either", () => {
  /* `<input type="time">` would be a second browser widget inside a surface this component
     draws itself — and on Windows it looks like the date input the owner rejected. */
  const panel = code("src/components/database/date-panel.tsx");
  assert.doesNotMatch(panel, /type="time"/);
  assert.match(panel, /parseTimeInput/);
});

test("a fly-out with no room below hangs from its row instead of scrolling", async () => {
  /* The picker's `Date format` row is the last row of a ~370px surface, so a submenu placed at
     that row's top edge had 164px of window left and drew five of its nine rows: the two clocks
     were under a fold inside a list that had no business scrolling. A caller that states
     `preferHeight` gets the other exit — the surface hangs from the row's bottom edge and grows
     upward. Every submenu that does not state one keeps the old behaviour, measured here too,
     because changing both would be a redesign disguised as a fix. */
  (globalThis as { window?: unknown }).window = { innerWidth: 1400, innerHeight: 900 };
  try {
    const { menuStyle } = await import("../src/components/database/menu");
    /* The `Date format` row of the picker at 1400x900, as the probe measured it. */
    const anchor = { top: 732, bottom: 760, left: 790, right: 1028, width: 238, height: 28 } as DOMRect;

    const squeezed = menuStyle(anchor, 200, 460, "right");
    assert.equal(Number(squeezed.top), 728, "the old rule still tracks the row's top edge");
    assert.ok(Number(squeezed.maxHeight) < 200,
      `and still squeezes to the ${squeezed.maxHeight}px left below it — which is the bug`);
    assert.ok(Number(squeezed.top) + Number(squeezed.maxHeight) <= 900, "inside the window, at least");

    const hanging = menuStyle(anchor, 200, 460, "right", 260);
    assert.equal(hanging.top, undefined, "placed by its bottom edge, not its top");
    assert.equal(Number(hanging.bottom), 140, "hanging off the row's bottom edge (900 − 760)");
    assert.ok(Number(hanging.maxHeight) >= 260,
      `all nine rows fit: maxHeight ${hanging.maxHeight} vs the 260 it asked for`);
    assert.equal(Number(hanging.left), 1034, "still beside the row, 6px clear of it");

    /* A row against the very bottom of the window is where both paths have to be clamped, or
       the "other way out" is a different way off-screen. */
    const atTheFloor = { top: 850, bottom: 878, left: 790, right: 1028, width: 238, height: 28 } as DOMRect;
    const lifted = menuStyle(atTheFloor, 200, 460, "right");
    assert.ok(Number(lifted.top) + Number(lifted.maxHeight) <= 900,
      `the squeezed list still ends inside the window: ${Number(lifted.top) + Number(lifted.maxHeight)}`);
    const hung = menuStyle(atTheFloor, 200, 460, "right", 260);
    assert.ok(900 - Number(hung.bottom) - Number(hung.maxHeight) >= 0,
      "and the hanging one starts inside it too");
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});
