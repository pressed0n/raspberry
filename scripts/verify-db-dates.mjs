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

try {
  await b.waitFor("!!document.querySelector('.db-date-trigger')", { label: "the table" });

  const seed = await stored();

  /* ---------------------------------------------------------------------------
     1. At rest: nothing is open, and a stored date reads in the column's format.
     --------------------------------------------------------------------------- */
  b.check("no picker is open before anything is pressed", (await surfaces()) === 0, `surfaces=${await surfaces()}`);
  b.check(
    "a stored date reads in the column's configured format",
    (await cellText("Seeded")) === "30 Oct 2026",
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
    (await cellText("Single")) === new Date(`${day}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }).replace(",", ""),
    await cellText("Single"),
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
  const header = await b.evaluate(`(() => {
    const labels = [...document.querySelectorAll('.db-th')]
      .filter((node) => node.querySelector('.db-th-label'));
    const column = labels.find((node) => node.textContent.trim().startsWith("When"));
    const label = column?.querySelector('.db-th-label');
    if (!label) return null;
    const r = label.getBoundingClientRect();
    return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2), reachable: true };
  })()`);
  await clickAt(header, "the When column header");
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 1", { label: "the property menu" });

  const menuLabels = await b.evaluate(`[...document.querySelectorAll('[data-db-popover] .db-menu-label')].map((node) => node.textContent.trim())`);
  b.check("the header offers Date format", menuLabels.includes("Date format"), menuLabels.join(" | "));
  b.check("the header offers Include time", menuLabels.includes("Include time"), menuLabels.join(" | "));
  b.check(
    "the Date format row carries the sample this column currently renders",
    (await b.evaluate(`(() => {
      const row = [...document.querySelectorAll('[data-db-popover] .db-menu-item')]
        .find((node) => node.querySelector('.db-menu-label')?.textContent.trim() === 'Date format');
      return row?.querySelector('.db-menu-value')?.textContent.trim() ?? null;
    })()`)) === "30 Oct 2026",
    await b.evaluate(`(() => {
      const row = [...document.querySelectorAll('[data-db-popover] .db-menu-item')]
        .find((node) => node.querySelector('.db-menu-label')?.textContent.trim() === 'Date format');
      return row?.querySelector('.db-menu-value')?.textContent.trim() ?? null;
    })()`),
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

  /* Reach the third row of the submenu the way a hand does: right into the surface, then
     down inside it. A straight line cuts the corner over the parent's own rows, where "the
     pointer went to a sibling" is exactly what the menu reads it as. */
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
  const target = await centre(".db-menu-label", "Day/month/year");
  if (!target) throw new Error("the Date format submenu has no Day/month/year row");
  for (let step = 1; step <= 3; step += 1) {
    await b.move(geometry.entryX, Math.round(geometry.top + (target.y - geometry.top) * (step / 3)));
    await sleep(40);
  }
  await b.move(target.x, target.y);
  await sleep(80);
  b.check("the submenu survived the crossing", (await surfaces()) >= 2, `surfaces=${await surfaces()}`);
  await b.mouse(target.x, target.y);
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 0", { timeoutMs: 4000, label: "the menu closes after choosing" });
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
     8. It fits, and nothing the probe did was refused.
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
