// The Date picker: a range, two clocks, and a column that can say how it reads.
//
// Usage:
//   BASE=http://127.0.0.1:3103 PAGE=<page id> DB=<database id> DATE=<property id> \
//     node scripts/verify-db-dates.mjs [width] [height]
//   …or end to end on a disposable copy:  powershell -File scripts\run-dates-probe.ps1
//
// WHY IT WRITES: the feature *is* a cell write followed by a property write, and the claims
// that matter are about what the server stores afterwards — a picker that only repainted the
// local copy, or an `Include time` that changed a checkbox and nothing else, would pass every
// DOM-only assertion. So each claim below is checked twice: the pixels, and then
// `/api/databases` read back.
//
// WHAT IT DOES NOT DO: it never touches a database it did not seed. The runner starts a
// disposable copy on :3103 with its own sqlite file (docs/TESTING.md).
import { openBrowser } from "./browser-session.mjs";

const width = Number(process.argv[2] ?? 1400);
const height = Number(process.argv[3] ?? 900);
const BASE = process.env.BASE ?? "http://127.0.0.1:3103";
const pageId = process.env.PAGE;
const databaseId = process.env.DB;
const dateId = process.env.DATE;
if (!pageId || !databaseId || !dateId) {
  throw new Error("PAGE=<page id> DB=<database id> DATE=<date property id> are required — run scripts/seed-qa-dates.mjs first");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* The property and the cells as the *server* holds them. The only source any claim trusts. */
async function stored() {
  const response = await fetch(`${BASE}/api/databases/${databaseId}`, { headers: { origin: BASE } });
  if (!response.ok) throw new Error(`GET /api/databases/${databaseId} → ${response.status}`);
  const payload = await response.json();
  const database = payload.database ?? payload;
  const property = database.properties.find((candidate) => candidate.id === dateId);
  if (!property) throw new Error(`property ${dateId} is not in the payload`);
  const rows = Object.fromEntries(database.rows.map((row) => [row.title, row.cells?.[dateId] ?? null]));
  return { config: property.config ?? {}, rows };
}

const b = await openBrowser({ url: `${BASE}/#${pageId}`, width, height });

const surfaces = () => b.evaluate("document.querySelectorAll('[data-db-popover]').length");
const surfaceRole = () =>
  b.evaluate("(document.querySelector('[data-db-popover]')?.getAttribute('role')) ?? ''");
const boundCount = () => b.evaluate("document.querySelectorAll('.db-date-bound').length");
const clocks = () => b.evaluate("document.querySelectorAll('.db-date-time').length");

/** A row, found the way a person reads it — by the name in its title cell.
 *
 *  The title is an `<input value="…">`, not a text node, so `textContent` cannot find it:
 *  the first version of this probe matched nothing and reported three failures that were all
 *  the probe. `value` is where a name lives once the row is editable. */
const ROW = (title) => `[...document.querySelectorAll('tr[data-row-id]')].find((node) => {
  const name = node.querySelector('.db-name-cell input')?.value
    ?? node.querySelector('.db-name-cell .db-cell-text')?.textContent
    ?? '';
  return name.trim() === ${JSON.stringify(title)};
})`;

/** The text a row's date cell is drawing — what the column actually reads. */
const cellText = (title) => b.evaluate(`(() => {
  const row = ${ROW(title)};
  const cell = row?.querySelector('td[data-property-id="${dateId}"]');
  return cell ? cell.textContent.trim() : null;
})()`);

/** Centre of the first element matching `selector` that satisfies `predicate` in-page. */
const centre = (selector, text = "") => b.evaluate(`(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
    .find((node) => ${JSON.stringify(text)} === "" || node.textContent.trim() === ${JSON.stringify(text)});
  if (!el) return null;
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
  const hit = document.elementFromPoint(x, y);
  return { x, y, reachable: !!hit && (hit === el || el.contains(hit)) };
})()`);

async function clickAt(at, what) {
  if (!at) throw new Error(`nothing to click for ${what}`);
  if (!at.reachable) throw new Error(`${what} is at ${at.x},${at.y} but something else is on top of it`);
  await b.mouse(at.x, at.y);
  await sleep(140);
}

async function click(selector, text, what = selector + " " + text) {
  await clickAt(await centre(selector, text), what);
}

/** A row of the last open surface, by its label — `.db-menu-item` is the shared menu row. */
async function clickMenu(label) {
  await clickAt(await b.evaluate(`(() => {
    const all = [...document.querySelectorAll('[data-db-popover]')];
    const surface = all[all.length - 1];
    if (!surface) return null;
    const item = [...surface.querySelectorAll('.db-menu-item')]
      .find((node) => (node.querySelector('.db-menu-label') ?? node).textContent.trim() === ${JSON.stringify(label)});
    if (!item) return null;
    item.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = item.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    const hit = document.elementFromPoint(x, y);
    return { x, y, reachable: !!hit && (hit === item || item.contains(hit)) };
  })()`), `menu row "${label}"`);
}

/** Open the date cell of one row — a press, like a person's. */
async function openCell(title) {
  await clickAt(await b.evaluate(`(() => {
    const row = ${ROW(title)};
    const trigger = row?.querySelector('td[data-property-id="${dateId}"] .db-date-trigger');
    if (!trigger) return null;
    trigger.scrollIntoView({ block: "nearest" });
    const r = trigger.getBoundingClientRect();
    const x = Math.round(r.left + Math.min(r.width - 12, 40)), y = Math.round(r.top + r.height / 2);
    const hit = document.elementFromPoint(x, y);
    return { x, y, reachable: !!hit && (hit === trigger || trigger.contains(hit)) };
  })()`), `the date cell of ${title}`);
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 1", { label: `picker for ${title}` });
}

/** The browser's own idea of today, which is what `Today` writes. */
const today = () =>
  b.evaluate(`(() => {
    const at = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return at.getFullYear() + "-" + pad(at.getMonth() + 1) + "-" + pad(at.getDate());
  })()`);

const tomorrow = () =>
  b.evaluate(`(() => {
    const at = new Date();
    at.setDate(at.getDate() + 1);
    const pad = (n) => String(n).padStart(2, "0");
    return at.getFullYear() + "-" + pad(at.getMonth() + 1) + "-" + pad(at.getDate());
  })()`);

async function typeClock(handle, text) {
  await clickAt(handle, "a clock field");
  await b.evaluate("document.activeElement?.select?.()");
  await b.type(text);
  await b.key("Enter", { keyCode: 13 });
  await sleep(400);
}

/* The names the column uses, spelled out, so a cell's text can be predicted without asking
   the app to tell us what it thinks it drew. */
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const fullOf = (day) => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}, ${day.slice(0, 4)}`;

try {
  await b.waitFor("!!document.querySelector('.db-date-trigger')", { label: "the table" });

  const seed = await stored();

  /* ---------------------------------------------------------------------------
     1. At rest: nothing is open, and a stored date reads in the column's format.
     --------------------------------------------------------------------------- */
  b.check("no picker is open before anything is pressed", (await surfaces()) === 0, `surfaces=${await surfaces()}`);
  b.check(
    "a stored date reads in the column's configured format",
    (await cellText("Seeded")) === "October 30, 2026",
    await cellText("Seeded"),
  );
  b.check("an empty cell says so, and is a button", (await cellText("Single")) === "Empty", await cellText("Single"));

  /* ---------------------------------------------------------------------------
     2. One day, written by a press on `Today`.
     --------------------------------------------------------------------------- */
  const day = await today();
  await openCell("Single");
  b.check("the press opens exactly one surface", (await surfaces()) === 1, `surfaces=${await surfaces()}`);
  b.check("that surface is a dialog, not a menu — it contains a grid", (await surfaceRole()) === "dialog", await surfaceRole());
  b.check(
    "the calendar drew six weeks",
    (await b.evaluate("document.querySelectorAll('.db-cal-week').length")) === 7,
    `rows=${await b.evaluate("document.querySelectorAll('.db-cal-week').length")} (one is the weekday header)`,
  );
  await click(".db-date-link", "Today", "the Today button");
  for (let i = 0; i < 20; i += 1) {
    if ((await stored()).rows.Single) break;
    await sleep(150);
  }
  const afterToday = await stored();
  b.check(
    "Today wrote the local day to the server",
    afterToday.rows.Single?.start === day,
    JSON.stringify(afterToday.rows.Single),
  );
  b.check(
    "and the cell reads it back in the column's format",
    (await cellText("Single")) === fullOf(day),
    `${await cellText("Single")} (expected${fullOf(day)})`,
  );

  /* The picker stays open: every other cell in this table saves as you go, and a picker
     that closed on the first press would make adding an end a second visit to the cell. */
  b.check("the picker is still open after a day is written", (await surfaces()) === 1, `surfaces=${await surfaces()}`);

  /* ---------------------------------------------------------------------------
     3. Escape dismisses, and what was written stays written.
     --------------------------------------------------------------------------- */
  await b.key("Escape", { keyCode: 27 });
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 0", { timeoutMs: 3000, label: "Escape closes the picker" });
  b.check("Escape closes the picker", (await surfaces()) === 0, `surfaces=${await surfaces()}`);
  b.check("the day it wrote is still on the server", (await stored()).rows.Single?.start === day, JSON.stringify((await stored()).rows.Single));

  /* ---------------------------------------------------------------------------
     4. A range across two days: `End date`, then a second press on the calendar.
     --------------------------------------------------------------------------- */
  const next = await tomorrow();
  await openCell("Range");
  await click(".db-date-link", "Today", "the Today button");
  await sleep(300);
  b.check("an empty cell shows one bound", (await boundCount()) === 1, `bounds=${await boundCount()}`);
  await clickMenu("End date");
  b.check("`End date` adds a second bound without leaving the surface", (await boundCount()) === 2 && (await surfaces()) === 1, `bounds=${await boundCount()} surfaces=${await surfaces()}`);
  b.check(
    "the pen moved to the new bound",
    await b.evaluate("document.querySelectorAll('.db-date-bound.is-active').length === 1 && !!document.querySelector('.db-date-bound:nth-child(2).is-active')"),
    "second bound is active",
  );
  await click(`[data-day="${next}"]`, "", `the day ${next}`);
  for (let i = 0; i < 20; i += 1) {
    if ((await stored()).rows.Range?.end) break;
    await sleep(150);
  }
  const range = (await stored()).rows.Range;
  b.check(
    "the second day is stored as the end, read back from the server",
    range?.end === next,
    JSON.stringify(range),
  );
  b.check(
    "the two bounds are ordered, start first",
    Boolean(range?.start && range?.end && range.start < range.end),
    JSON.stringify(range),
  );
  b.check(
    "the cell draws a range",
    (await cellText("Range")).includes("→"),
    await cellText("Range"),
  );
  await b.shot(`dates-range-${width}`);

  /* ---------------------------------------------------------------------------
     5. One day, two clocks — the wishlist's "start and end time in one date".
     --------------------------------------------------------------------------- */
  await b.key("Escape", { keyCode: 27 });
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 0", { timeoutMs: 3000, label: "close before the clocks" });

  await openCell("Meeting");
  await click(".db-date-link", "Today", "the Today button");
  await sleep(250);
  await clickMenu("End date");
  await click(".db-date-link", "Today", "the Today button — the same day as the start");
  await sleep(300);
  b.check(
    "the same day twice is still one day on the server",
    (await stored()).rows.Meeting?.start === day && (await stored()).rows.Meeting?.end === day,
    JSON.stringify((await stored()).rows.Meeting),
  );

  await clickMenu("Include time");
  await b.waitFor("document.querySelectorAll('.db-date-time').length === 2", { timeoutMs: 6000, label: "two clock fields" });
  b.check("`Include time` drew a clock on each bound", (await clocks()) === 2, `clocks=${await clocks()}`);
  b.check(
    "`Include time` is stored on the property, not in the panel",
    (await stored()).config.includeTime === true,
    JSON.stringify((await stored()).config),
  );

  const clockHandles = () => b.evaluate(`(() => {
    const field = [...document.querySelectorAll('.db-date-time')];
    return field.map((input) => {
      input.scrollIntoView({ block: "nearest" });
      const r = input.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), reachable: true, text: "" };
    });
  })()`);
  const [startClock] = await clockHandles();
  await typeClock(startClock, "0900");
  const [, endClock] = await clockHandles();
  await typeClock(endClock, "1700");
  for (let i = 0; i < 20; i += 1) {
    if (String((await stored()).rows.Meeting?.end ?? "").includes("T17:00")) break;
    await sleep(150);
  }
  const meeting = (await stored()).rows.Meeting;
  b.check("the start carries its clock on the server", meeting?.start === `${day}T09:00`, JSON.stringify(meeting));
  b.check("the end carries the other", meeting?.end === `${day}T17:00`, JSON.stringify(meeting));

  /* The formatter's one-sentence range: the day is said once, both clocks are said. The
     year appearing twice would be the old `A → A` reading this replaced. */
  const meetingText = await cellText("Meeting");
  const yearCount = (meetingText.match(new RegExp(day.slice(0, 4), "g")) ?? []).length;
  b.check(
    "a range inside one day says the date once and both clocks",
    /→ 17:00$/.test(meetingText) && yearCount === 1,
    `${meetingText} (year appears ${yearCount}×)`,
  );
  await b.shot(`dates-same-day-${width}`);

  /* ---------------------------------------------------------------------------
     6. Clear empties the cell — on the server, not just in the DOM.
     --------------------------------------------------------------------------- */
  await click(".db-date-link", "Clear", "the Clear button");
  for (let i = 0; i < 20; i += 1) {
    if ((await stored()).rows.Meeting === null) break;
    await sleep(150);
  }
  b.check("Clear empties the cell on the server", (await stored()).rows.Meeting === null, JSON.stringify((await stored()).rows.Meeting));
  b.check("and the trigger says Empty again", (await cellText("Meeting")) === "Empty", await cellText("Meeting"));

  await b.key("Escape", { keyCode: 27 });
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 0", { timeoutMs: 3000, label: "close before the header" });

  /* ---------------------------------------------------------------------------
     7. The column's own settings: Date format, and the format is a *reading*.
     --------------------------------------------------------------------------- */
  /* Recomputed before every press. A header coordinate is only true for the scroll position
     it was taken in, and opening a date cell scrolls the table to reach it. */
  const pressHeader = async () => {
    await clickAt(await b.evaluate(`(() => {
      const column = [...document.querySelectorAll('.db-th')]
        .find((node) => node.querySelector('.db-th-label')?.textContent.trim().startsWith("When"));
      const label = column?.querySelector('.db-th-label');
      if (!label) return null;
      label.scrollIntoView({ block: "nearest", inline: "nearest" });
      const r = label.getBoundingClientRect();
      const x = Math.round(r.left + 20), y = Math.round(r.top + r.height / 2);
      const hit = document.elementFromPoint(x, y);
      return { x, y, reachable: !!hit && (hit === label || label.contains(hit)) };
    })()`), "the When column header");
    await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 1", { label: "the property menu" });
  };
  await pressHeader();

  const menuLabels = await b.evaluate(`[...document.querySelectorAll('[data-db-popover] .db-menu-label')].map((node) => node.textContent.trim())`);
  b.check("the header offers Date format", menuLabels.includes("Date format"), menuLabels.join(" | "));
  b.check("the header offers Include time", menuLabels.includes("Include time"), menuLabels.join(" | "));
  const formatRow = () => b.evaluate(`(() => {
    const row = [...document.querySelectorAll('[data-db-popover] .db-menu-item')]
      .find((node) => node.querySelector('.db-menu-label')?.textContent.trim() === 'Date format');
    return row?.querySelector('.db-menu-value')?.textContent.trim() ?? null;
  })()`);
  b.check(
    "the Date format row names the format this column is using",
    (await formatRow()) === "Full date",
    await formatRow(),
  );
  b.check(
    "Include time is ticked, because the picker just turned it on",
    await b.evaluate(`(() => {
      const row = [...document.querySelectorAll('[data-db-popover] .db-menu-item')]
        .find((node) => node.querySelector('.db-menu-label')?.textContent.trim() === 'Include time');
      return !!row?.querySelector('.db-menu-check');
    })()`),
    "a check mark on the row",
  );
  await b.shot(`dates-menu-${width}`);

  /* The menu was opened to read it; `pickFormat` opens it again, so it starts from closed. */
  await b.key("Escape", { keyCode: 27 });
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 0", { timeoutMs: 3000, label: "close before choosing" });

  /* Reach a row of the submenu the way a hand does: right into the surface, then down inside
     it. A straight line cuts the corner over the parent's own rows, where "the pointer went to
     a sibling" is exactly what the menu reads it as. */
  async function pickFormat(label) {
    await pressHeader();
    const trigger = await centre(".db-menu-label", "Date format");
    await b.move(trigger.x, trigger.y);
    await b.waitFor("document.querySelectorAll('[data-db-popover]').length >= 2", { label: "the Date format submenu" });
    const geometry = await b.evaluate(`(() => {
      const all = [...document.querySelectorAll('[data-db-popover]')];
      const sub = all[all.length - 1].getBoundingClientRect();
      const parent = all[all.length - 2].getBoundingClientRect();
      const toRight = sub.left >= parent.right;
      return { entryX: Math.round(toRight ? sub.left + 12 : sub.right - 12), top: Math.round(sub.top + 6) };
    })()`);
    const target = await centre(".db-menu-label", label);
    if (!target) throw new Error(`the Date format submenu has no "${label}" row`);
    for (let step = 1; step <= 3; step += 1) {
      await b.move(geometry.entryX, Math.round(geometry.top + (target.y - geometry.top) * (step / 3)));
      await sleep(40);
    }
    await b.move(target.x, target.y);
    await sleep(80);
    b.check(`the submenu survived the crossing to "${label}"`, (await surfaces()) >= 2, `surfaces=${await surfaces()}`);
    await b.mouse(target.x, target.y);
    await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 0", { timeoutMs: 4000, label: `the menu closes after choosing ${label}` });
  }

  await pickFormat("Day/Month/Year");
  for (let i = 0; i < 20; i += 1) {
    if ((await stored()).config.format === "dmy") break;
    await sleep(150);
  }
  b.check(
    "choosing a format is stored on the property",
    (await stored()).config.format === "dmy",
    JSON.stringify((await stored()).config),
  );
  b.check(
    "and the table re-reads the date in it",
    (await cellText("Seeded")) === "30/10/2026",
    await cellText("Seeded"),
  );

  /* ---------------------------------------------------------------------------
     8. Every format the menu offers is a reading.
     ---------------------------------------------------------------------------
     Six rows, six stored values, six rendered strings. `Relative` is asserted on the row
     the probe set to *today* in section 2, because it is the only one of the six whose
     answer depends on when you look: pinning it to a fixed 2026 date would make this probe
     start failing by itself on a date nobody chose. */
  const FORMATS = [
    ["Full date", "full", "Seeded", "October 30, 2026"],
    ["Short date", "short", "Seeded", "Oct 30"],
    ["Month/Day/Year", "mdy", "Seeded", "10/30/2026"],
    ["Day/Month/Year", "dmy", "Seeded", "30/10/2026"],
    ["Year/Month/Day", "ymd", "Seeded", "2026/10/30"],
    ["Relative", "relative", "Single", "Today"],
  ];
  for (const [label, name, row, expected] of FORMATS) {
    await pickFormat(label);
    for (let i = 0; i < 20; i += 1) {
      if ((await stored()).config.format === name) break;
      await sleep(120);
    }
    b.check(`"${label}" is stored as ${name}`, (await stored()).config.format === name, JSON.stringify((await stored()).config));
    b.check(`and the column reads "${expected}"`, (await cellText(row)) === expected, `${row}: ${await cellText(row)}`);
  }

  /* ---------------------------------------------------------------------------
     9. The picker's own `Date format` — a fly-out beside it, writing the *column*.
     ---------------------------------------------------------------------------
     Two asks, in the owner's order. First: *"Date format should also be accessible in the
     dropdown where you're selecting the date ... it would change the format for the whole
     column."* Then, when it shipped as a body swap: *"those options should open next to the
     dropdown."*

     So the claims are layered. The row is in the cell's picker; pressing it opens the app's one
     submenu *beside* the picker rather than over it, which is what leaves the calendar on
     screen while a format is chosen; and the press stores the property's config, which is the
     only reason a second row in the same column changes too. The last one is why this section
     reads `/api/databases` and a row it never opened.
     --------------------------------------------------------------------------- */
  const mdyOf = (day) => `${day.slice(5, 7)}/${day.slice(8, 10)}/${day.slice(0, 4)}`;
  const pickerRow = (label) => b.evaluate(`(() => {
    const surface = document.querySelector('[data-db-popover]');
    const row = [...(surface?.querySelectorAll('.db-menu-item') ?? [])]
      .find((node) => node.querySelector('.db-menu-label')?.textContent.trim() === ${JSON.stringify(label)});
    if (!row) return null;
    return {
      value: row.querySelector('.db-menu-value')?.textContent.trim() ?? null,
      caret: !!row.querySelector('.db-menu-caret'),
      checked: !!row.querySelector('.db-menu-check'),
    };
  })()`);
  /* Every surface on screen, first and last. The picker is the first; the format list is the
     last. Geometry is read in viewport pixels, because "beside" is a claim about pixels. */
  const rects = () => b.evaluate(`(() => {
    const all = [...document.querySelectorAll('[data-db-popover]')];
    const box = (node) => {
      const r = node.getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) };
    };
    return {
      count: all.length,
      picker: all.length ? box(all[0]) : null,
      flyOut: all.length > 1 ? box(all[all.length - 1]) : null,
      /* The row the fly-out came from — its right edge is where "beside" starts. Measured
         against the row and not the panel, because the panel's own 6px padding is not
         something a fly-out has to clear. */
      row: (() => {
        const row = all[0]?.querySelector('.db-menu-sub [data-menuitem]');
        return row ? box(row) : null;
      })(),
      view: [innerWidth, innerHeight],
    };
  })()`);
  /* The rows of the last surface open — the fly-out when there is one. */
  const lastSurface = (selector) => b.evaluate(`(() => {
    const all = [...document.querySelectorAll('[data-db-popover]')];
    const surface = all[all.length - 1];
    return surface ? [...surface.querySelectorAll(${JSON.stringify(selector)})].map((node) => node.textContent.trim()) : [];
  })()`);
  const openFlyOut = async () => {
    await clickMenu("Date format");
    await b.waitFor("document.querySelectorAll('[data-db-popover]').length > 1", { timeoutMs: 3000, label: "the format fly-out" });
  };

  /* Section 8 left the column on `Relative`, so the row has something specific to name. */
  await openCell("Seeded");
  const alone = await rects();
  b.check("the picker opens on its own", alone.count === 1, JSON.stringify(alone));
  b.check("the cell's own picker offers Date format", (await pickerRow("Date format")) !== null, "no such row");
  b.check(
    "and the row names the format the column is on",
    (await pickerRow("Date format"))?.value === "Relative",
    JSON.stringify(await pickerRow("Date format")),
  );
  b.check(
    "the row says it opens something by wearing the submenu's caret",
    (await pickerRow("Date format"))?.caret === true,
    JSON.stringify(await pickerRow("Date format")),
  );

  await openFlyOut();
  const beside = await rects();
  b.check("pressing Date format opens a second surface rather than replacing this one", beside.count === 2, JSON.stringify(beside));
  b.check(
    "the calendar is still drawn behind it — a format is chosen while the day stays visible",
    (await b.evaluate("document.querySelectorAll('.db-cal-grid').length")) === 1,
    "the body was swapped again",
  );
  /* A list that has to be scrolled to reach its last two rows is a list that hid them. The
     picker's `Date format` row is the last one in a 370px panel, so at 1400x900 it had 160px of
     window left and drew five of its nine rows — the surface now hangs from the row's bottom
     edge and grows upward instead. Measured, at both widths, because "it fit" is a pixel claim. */
  const listScrolls = () => b.evaluate(`(() => {
    const all = [...document.querySelectorAll('[data-db-popover]')];
    const surface = all[all.length - 1];
    return surface ? surface.scrollHeight - surface.clientHeight : -1;
  })()`);
  b.check("the whole list is visible, nothing hidden under a fold inside it", (await listScrolls()) === 0, `${await listScrolls()}px of scroll`);
  if (width >= 700) {
    b.check(
      "and at this width it sits beside the row it opened, covering none of it",
      !!beside.row && beside.flyOut.left >= beside.row.right,
      JSON.stringify(beside),
    );
  } else {
    /* No room on a phone: 252 + 200 does not fit in 390. The submenu flips to the other edge and
       lies over the picker — the same thing the tag colour submenu has always done, and better
       than replacing the body, which is what the owner sent back. Asserted as a measurement, so
       it is a known trade rather than an accident. */
    b.check(
      "at this width there is no room beside it, so it flips and stays wholly inside the viewport",
      !!beside.row && beside.flyOut.left < beside.row.right
        && beside.flyOut.left >= 0
        && beside.flyOut.right <= beside.view[0]
        && beside.flyOut.top >= 0
        && beside.flyOut.bottom <= beside.view[1],
      JSON.stringify(beside),
    );
  }
  const flyLabels = await lastSurface(".db-menu-label");
  b.check(
    "the fly-out lists the same six formats the header does",
    ["Full date", "Short date", "Month/Day/Year", "Day/Month/Year", "Year/Month/Day", "Relative"].every((label) => flyLabels.includes(label)),
    flyLabels.join(" | "),
  );
  b.check(
    "with exactly the running format ticked",
    JSON.stringify(
      await b.evaluate(
        `(() => {
          const all = [...document.querySelectorAll('[data-db-popover]')];
          const surface = all[all.length - 1];
          return surface
            ? [...surface.querySelectorAll('.db-menu-item')].filter((node) => node.querySelector('.db-menu-check'))
              .map((node) => node.querySelector('.db-menu-label')?.textContent.trim())
            : [];
        })()`,
      ),
    ) === JSON.stringify(["Relative", "24-hour"]),
    "the format and the clock in use, and nothing else — the clock is a setting with a current value too",
  );
  /* `Include time` is on — section 5 turned it on for the whole column — so the clocks belong in
     this list. A format nobody can see would be a preference that does nothing. The heading is a
     `.db-menu-title`, not a row: it names a place, which is the one question a heading is for. */
  const flyHeadings = await lastSurface(".db-menu-title");
  b.check(
    "the clocks are listed under the formats when the column shows times",
    flyHeadings.includes("Time format") && flyLabels.includes("12-hour") && flyLabels.includes("24-hour"),
    `headings=${flyHeadings.join(" | ")} rows=${flyLabels.join(" | ")}`,
  );
  await b.shot(`dates-format-flyout-${width}`);

  await clickMenu("12-hour");
  for (let i = 0; i < 20; i += 1) {
    if ((await stored()).config.timeFormat === "12") break;
    await sleep(120);
  }
  b.check(
    "choosing a clock in the picker is stored on the property too",
    (await stored()).config.timeFormat === "12",
    JSON.stringify((await stored()).config),
  );
  b.check(
    "and the list stays where it was — a format and a clock in one visit, no reopening",
    (await rects()).count === 2 && (await b.evaluate("!!document.querySelector('.db-cal-grid')")),
    JSON.stringify(await rects()),
  );

  /* The pick itself, from the list that is already open. */
  await clickMenu("Month/Day/Year");
  for (let i = 0; i < 20; i += 1) {
    if ((await stored()).config.format === "mdy") break;
    await sleep(120);
  }
  b.check("picking a format in the picker stores it on the property", (await stored()).config.format === "mdy", JSON.stringify((await stored()).config));
  b.check(
    "the bound row above the grid re-reads in it immediately",
    (await b.evaluate("document.querySelector('.db-date-day')?.textContent.trim()")) === "10/30/2026",
    await b.evaluate("document.querySelector('.db-date-day')?.textContent.trim()"),
  );
  b.check(
    "the tick moves to the row just pressed, in the same surface",
    JSON.stringify(
      await b.evaluate(
        `(() => {
          const all = [...document.querySelectorAll('[data-db-popover]')];
          const surface = all[all.length - 1];
          return surface
            ? [...surface.querySelectorAll('.db-menu-item')].filter((node) => node.querySelector('.db-menu-check'))
              .map((node) => node.querySelector('.db-menu-label')?.textContent.trim())
            : [];
        })()`,
      ),
    ) === JSON.stringify(["Month/Day/Year", "12-hour"]),
    "the acknowledgement is the tick, not a closing surface",
  );
  b.check(
    "the picker behind it is still open — the person was mid-value",
    (await b.evaluate("document.querySelectorAll('.db-cal-grid').length")) === 1 && (await rects()).count === 2,
    JSON.stringify(await rects()),
  );

  /* The property a body swap cannot have: the row that opens the list is still there while the
     list is open, so the keyboard is never handed to `<body>`. The pane needed `focusMenuRow` on
     both sides of the swap; here there is nothing to hand back. */
  const focused = () => b.evaluate(`(() => {
    const node = document.activeElement;
    if (!node) return "";
    return (node.getAttribute('data-menu-key')
      ?? node.querySelector?.('.db-menu-label')?.textContent.trim()
      ?? node.getAttribute('aria-label')
      ?? node.className ?? "").toString();
  })()`);
  await b.evaluate(`[...document.querySelectorAll('[data-db-popover] [data-menuitem]')]
    .find((node) => node.querySelector('.db-menu-label')?.textContent.trim() === "Date format")?.focus()`);
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length > 1", { timeoutMs: 3000, label: "focus opens the fly-out" });
  b.check(
    "focusing the row opens the list, and the keyboard stays on the row that did it",
    (await focused()) === "Date format",
    await focused(),
  );
  await b.key("ArrowDown", { keyCode: 40 });
  b.check(
    "and the picker's own traversal still hears the arrows — it never lost the focused row",
    (await focused()) === "End date",
    await focused(),
  );

  await b.key("Escape", { keyCode: 27 });
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 0", { timeoutMs: 3000, label: "close after the format pick" });

  /* The column, not the cell: a row this section never opened has to have changed too. */
  b.check("the cell it was opened from reads the new format", (await cellText("Seeded")) === "10/30/2026", await cellText("Seeded"));
  b.check(
    "and so does a row in the same column it never touched",
    (await cellText("Range")) === `${mdyOf(day)} → ${mdyOf(next)}`,
    `${await cellText("Range")} (expected ${mdyOf(day)} → ${mdyOf(next)})`,
  );

  /* And the header agrees, because both surfaces read one stored config through one helper. */
  await pressHeader();
  b.check("the header's own row names the same format", (await formatRow()) === "Month/Day/Year", await formatRow());
  await b.key("Escape", { keyCode: 27 });
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 0", { timeoutMs: 3000, label: "close the header" });

  /* ---------------------------------------------------------------------------
     10. One box for every dropdown.
     ---------------------------------------------------------------------------
     These used to be four numbers spread over three files — 240 in the stylesheet, 268 at
     the property header, 272 in the tag dropdown, 296 for the calendar — so "how wide is a
     dropdown" had no answer and the widest one was a cell menu. A measurement is the only
     thing that keeps them one number; a note would be followed by whoever read it. */
  await openCell("Seeded");
  const panelWidth = await b.evaluate("Math.round(document.querySelector('[data-db-popover]').getBoundingClientRect().width)");
  b.check("the date picker is the same width as a menu", panelWidth === 252, `${panelWidth}px`);
  await b.key("Escape", { keyCode: 27 });
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 0", { timeoutMs: 3000, label: "close the picker" });

  await pressHeader();
  const menuWidth = await b.evaluate("Math.round(document.querySelector('[data-db-popover]').getBoundingClientRect().width)");
  b.check("the property menu is that same width", menuWidth === 252, `${menuWidth}px`);
  /* A narrow menu that cut its own rows short would be a smaller box lying about what is in
     it: a row would no longer say which row it is. */
  const clipped = await b.evaluate(`[...document.querySelectorAll('[data-db-popover] .db-menu-label')]
    .filter((node) => node.scrollWidth > node.clientWidth + 1).map((node) => node.textContent.trim())`);
  b.check("no row truncates the name of what it does", clipped.length === 0, clipped.join(" | "));
  await b.key("Escape", { keyCode: 27 });
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 0", { timeoutMs: 3000, label: "close the menu" });

  /* ---------------------------------------------------------------------------
     11. It fits, and nothing the probe did was refused.
     --------------------------------------------------------------------------- */
  await openCell("Seeded");
  const fits = await b.evaluate(`(() => {
    const surface = document.querySelector('[data-db-popover]');
    const r = surface.getBoundingClientRect();
    return { within: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, r: [r.left, r.top, r.right, r.bottom], view: [innerWidth, innerHeight] };
  })()`);
  b.check("the whole picker is inside the viewport", fits.within, JSON.stringify(fits));
  await b.shot(`dates-picker-${width}`);

  b.check(
    "nothing the probe did was blocked by the write guard",
    (await b.blockedWrites()).length === 0,
    JSON.stringify(await b.blockedWrites()),
  );
} catch (error) {
  /* `report()` ends the process, so a throw inside the body used to be swallowed and the run
     still printed OK — see docs/TESTING.md. An exception is a failure of the probe itself. */
  b.check("the probe itself ran to the end without throwing", false, String(error?.stack ?? error));
} finally {
  await b.report();
}
