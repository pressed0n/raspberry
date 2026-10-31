// The Number property's menu: how a sort is worded for a number column, the number
// formats, and decimal places — driven with a real pointer.
//
// Usage:
//   BASE=http://127.0.0.1:3100 PAGE=<seeded page id> node scripts/verify-db-number.mjs [width] [height]
//   …or, end to end on a disposable copy:  powershell -File scripts\run-number-probe.ps1
//
// WHY IT WRITES: nothing here can be proved by a screenshot. The claim is "choosing
// `Number with separators` changes how a cell reads *and* keeps the decimal places you
// already set" — so the probe clicks, and then reads the rendered cell. It must point at
// a **disposable instance** (docs/TESTING.md); the session refuses writes to the live
// port, and every write it does make lands in the throwaway file deleted with it.
//
// The expected strings are computed *in the page* with `Intl`, never written here: a probe
// that hard-codes "1,234.50" passes only on a machine that formats numbers the same way.
import { openBrowser } from "./browser-session.mjs";

const width = Number(process.argv[2] ?? 1400);
const height = Number(process.argv[3] ?? 900);
const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const pageId = process.env.PAGE;
if (!pageId) throw new Error("PAGE=<seeded page id> is required — run scripts/seed-qa-number.mjs first");

const b = await openBrowser({ url: `${BASE}/#${pageId}`, width, height });

const centre = (selector, text) => b.evaluate(`(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
    .find((node) => ${JSON.stringify(text)} === "" || node.textContent.trim() === ${JSON.stringify(text)});
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);

const surfaceCount = () => b.evaluate("document.querySelectorAll('[data-db-popover]').length");

/** Rows of one surface, with the sample each reports on its own line. */
const rows = (which = "last") => b.evaluate(`(() => {
  const all = [...document.querySelectorAll('[data-db-popover]')];
  const surface = ${JSON.stringify(which)} === "last" ? all[all.length - 1] : all[0];
  if (!surface) return [];
  return [...surface.querySelectorAll('.db-menu-item')].map((item) => ({
    label: (item.querySelector('.db-menu-label') ?? item).textContent.trim(),
    value: item.querySelector('.db-menu-value')?.textContent.trim() ?? null,
    checked: !!item.querySelector('.db-menu-check'),
  }));
})()`);

/* Rows only: the "new page" placeholder at the bottom of the table is a `.db-row` too,
   and counting it turned a three-row table into four rows with one blank name. */
const ROW_VALUES = `[...document.querySelectorAll('.db-row[data-row-id]')].map((tr) =>
  [...tr.querySelectorAll('.db-cell-input')].map((input) => input.value.trim()))`;

const rowValues = () => b.evaluate(ROW_VALUES);

const cellText = async (rowTitle) => (await rowValues()).find((cells) => cells[0] === rowTitle) ?? null;

const waitCell = (rowTitle, expected) => b.waitFor(`(() => {
  const cells = ${ROW_VALUES}.find((row) => row[0] === ${JSON.stringify(rowTitle)});
  return !!cells && cells[1] === ${JSON.stringify(expected)};
})()`, { timeoutMs: 8000, label: `the ${rowTitle} cell reads "${expected}"` });

const waitOrder = (expected) => b.waitFor(`(() => {
  const order = ${ROW_VALUES}.map((cells) => cells[0]);
  return JSON.stringify(order) === JSON.stringify(${JSON.stringify(expected)});
})()`, { timeoutMs: 8000, label: `rows in the order ${expected.join(", ")}` });

const intl = (options, value) =>
  b.evaluate(`new Intl.NumberFormat(undefined, ${JSON.stringify(options)}).format(${value})`);

/** Labels the browser is ellipsising: `scrollWidth` past `clientWidth` is a clipped word,
 *  which no DOM-text assertion can see — the text is all still there, just unseen. */
const clippedLabels = (which = "last") => b.evaluate(`(() => {
  const all = [...document.querySelectorAll('[data-db-popover]')];
  const surface = ${JSON.stringify(which)} === "last" ? all[all.length - 1] : all[0];
  if (!surface) return [];
  return [...surface.querySelectorAll('.db-menu-label')]
    .filter((node) => node.scrollWidth > node.clientWidth + 1)
    .map((node) => node.textContent.trim());
})()`);

/** Hover a row of the open menu and wait for its submenu surface to appear. */
async function openSub(label) {
  const at = await centre(".db-menu-label", label);
  if (!at) throw new Error(`no menu row labelled ${label}`);
  await b.move(at.x, at.y);
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length >= 2", { label: `submenu for ${label}` });
  return at;
}

/** Leave a submenu and wait for it to go: these are siblings, one open at a time. */
async function closeSub() {
  /* A real pointer move, not a synthetic `mouseleave` — React's leave events come from
     the browser's own hit-testing, so a dispatched event on the wrapper never reaches
     the handler and the wait would time out on healthy code. */
  await b.move(5, 5);
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length < 2", { timeoutMs: 3000, label: "submenu closes" });
}

/** Click a row inside the open submenu, travelling across the gap the way a hand does. */
async function clickInSub(label) {
  const at = await centre(".db-menu-label", label);
  if (!at) throw new Error(`no submenu row labelled ${label}`);
  const from = await b.evaluate("(() => { const s = document.querySelectorAll('[data-db-popover]'); const sub = s[s.length-1]; const r = sub.getBoundingClientRect(); return { x: Math.round(r.left) - 6, y: Math.round(r.top + r.height / 2) }; })()");
  for (let step = 1; step <= 4; step++) {
    await b.move(Math.round(from.x + (at.x - from.x) * (step / 4)), Math.round(from.y + (at.y - from.y) * (step / 4)));
    await new Promise((r) => setTimeout(r, 40));
  }
  const stillOpen = await surfaceCount();
  if (stillOpen < 2) throw new Error(`the submenu closed while the pointer crossed into it (${stillOpen} surfaces)`);
  await b.mouse(at.x, at.y);
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 0", { timeoutMs: 4000, label: "menu closes after choosing" });
}

async function openPropertyMenu(column) {
  const at = await b.evaluate(`(() => {
    const th = [...document.querySelectorAll('.db-th')].find((node) => node.textContent.trim().startsWith(${JSON.stringify(column)}));
    const button = th?.querySelector('.db-th-label');
    if (!button) return null;
    /* The table scrolls sideways: at a true 390 viewport (browser-session.mjs) this column
       sits past the right edge, and a press at an off-page coordinate goes nowhere. Scroll it
       in, then require the centre to be reachable. */
    button.scrollIntoView({ block: "nearest", inline: "center" });
    const r = button.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    const hit = document.elementFromPoint(x, y);
    return { x, y, reachable: !!hit && (hit === button || button.contains(hit)), view: [innerWidth, innerHeight] };
  })()`);
  if (!at) throw new Error(`no header for column ${column}`);
  if (!at.reachable) throw new Error(`the header for ${column} at ${at.x},${at.y} is not reachable at ${at.view.join("x")}`);
  await b.mouse(at.x, at.y);
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 1", { label: "property menu" });
  return at;
}

async function closeMenu() {
  await b.key("Escape", { keyCode: 27 });
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 0", { timeoutMs: 2000, label: "menu closes" });
}

try {
  await b.waitFor("!!document.querySelector('.db-row[data-row-id]')", { timeoutMs: 45000, label: "the table renders" });

  /* ---------------------------------------------------------------------------
     1. The sort is described in the terms a number compares by.
     --------------------------------------------------------------------------- */
  await openPropertyMenu("Amount");
  const menuRows = await rows("first");
  b.check(
    "the property menu offers a number format row for a number column",
    menuRows.some((row) => row.label === "Number format"),
    menuRows.map((row) => row.label).join(" | "),
  );
  b.check(
    "…and that row reports the format the column is actually set to",
    (menuRows.find((row) => row.label === "Number format")?.value ?? "").length > 0,
    `value="${menuRows.find((row) => row.label === "Number format")?.value}"`,
  );
  b.check(
    "no label in the property menu is clipped",
    (await clippedLabels("first")).length === 0,
    (await clippedLabels("first")).join(", "),
  );

  /* The probe runs twice against one seeded database (and may be re-run), so nothing
     below may assume the column is still at its defaults. The decimal count it finds is
     the one every expectation after this point is computed with. */
  const decimalsLabel = menuRows.find((row) => row.label === "Decimal places")?.value ?? "Integer";
  const places = decimalsLabel === "Integer" ? 0 : parseInt(decimalsLabel, 10) || 0;
  const atPlaces = (value) => intl({ minimumFractionDigits: places, maximumFractionDigits: places }, value);

  await openSub("Sort");
  const sortRows = await rows();
  b.check(
    "a number column sorts Low → High, not A → Z",
    sortRows[0]?.label === "Low → High" && sortRows[1]?.label === "High → Low",
    sortRows.slice(0, 3).map((row) => row.label).join(" | "),
  );
  b.check(
    "neither sort direction claims A → Z on this column",
    !sortRows.some((row) => row.label.includes("A → Z") || row.label.includes("Z → A")),
    sortRows.map((row) => row.label).join(" | "),
  );
  await b.shot(`number-sort-${width}`);
  await closeSub();

  /* ---------------------------------------------------------------------------
     2. The format submenu: every format, plus currencies, each with a sample.
     --------------------------------------------------------------------------- */
  await openSub("Number format");
  const formatRows = await rows();
  const labels = formatRows.map((row) => row.label);
  b.check(
    "the format submenu lists Number, separators, Percentage and Duration",
    ["Number", "Number with separators", "Percentage", "Duration"].every((label) => labels.includes(label)),
    labels.slice(0, 4).join(" | "),
  );
  b.check(
    "no label in the format submenu is clipped",
    (await clippedLabels()).length === 0,
    (await clippedLabels()).join(", "),
  );
  b.check(
    "currencies are listed in the same submenu, each with its own symbol",
    labels.includes("Euro") && labels.includes("US dollar") && formatRows.slice(4).every((row) => (row.value ?? "").length > 0),
    `${labels.length} rows: ${labels.slice(4).join(", ")}`,
  );
  const separatorsSample = await atPlaces(1234.5);
  const cellTwo = (await cellText("Two"))?.[1];
  b.check(
    "the row above reports the current format by rendering the same number the cell holds",
    (await rows("first")).find((row) => row.label === "Number format")?.value === cellTwo,
    `menu="${(await rows("first")).find((row) => row.label === "Number format")?.value}" cell="${cellTwo}"`,
  );
  await b.shot(`number-format-${width}`);

  /* ---------------------------------------------------------------------------
     3. A click that crosses the 6px gap from the menu row into the submenu's portal.
        Every item below is chosen this way, because that is the only way a person can
        reach one: a synthetic `element.click()` would prove the handler, not the menu.
     --------------------------------------------------------------------------- */
  await clickInSub("Number with separators");
  await waitCell("Two", separatorsSample);
  b.check(
    "choosing “Number with separators” changes the cell on screen",
    (await cellText("Two"))?.[1] === separatorsSample,
    JSON.stringify(await cellText("Two")),
  );

  /* ---------------------------------------------------------------------------
     4. Decimal places — and the proof that the two settings do not overwrite each
        other, which is the merge in `configProperty` doing its job.
     --------------------------------------------------------------------------- */
  await openPropertyMenu("Amount");
  await openSub("Decimal places");
  const decimalRows = await rows();
  b.check(
    "decimal places offers integers through six places",
    decimalRows.length === 7 && decimalRows[0].label === "Integer",
    decimalRows.map((row) => row.label).join(" | "),
  );
  b.check(
    "exactly one decimal count is ticked",
    decimalRows.filter((row) => row.checked).length === 1,
    decimalRows.filter((row) => row.checked).map((row) => row.label).join(","),
  );
  b.check(
    "no label in the decimal-places submenu is clipped",
    (await clippedLabels()).length === 0,
    (await clippedLabels()).join(", "),
  );
  await b.shot(`number-decimals-${width}`);
  await clickInSub("2 decimals");
  const twoPlaces = await intl({ minimumFractionDigits: 2, maximumFractionDigits: 2 }, 1234.5);
  await waitCell("Two", twoPlaces);
  b.check(
    "two decimal places render two decimal places",
    (await cellText("Two"))?.[1] === twoPlaces,
    JSON.stringify(await cellText("Two")),
  );
  /* The merge, in one comparison: had the second write replaced the config instead of
     merging onto it, the format would have fallen back to plain `number`, which renders
     the same value with no grouping — "1234.50". */
  const plainTwo = (1234.5).toFixed(2);
  b.check(
    "…and the separators chosen a moment ago survived the second write",
    twoPlaces === plainTwo || (await cellText("Two"))?.[1] !== plainTwo,
    `cell=${JSON.stringify((await cellText("Two"))?.[1])} grouped=${JSON.stringify(twoPlaces)} plain=${JSON.stringify(plainTwo)}`,
  );

  /* ---------------------------------------------------------------------------
     5. A currency: the symbol on the menu row is the symbol in the cell.
     --------------------------------------------------------------------------- */
  await openPropertyMenu("Amount");
  await openSub("Number format");
  await clickInSub("Euro");
  const euros = await intl({ style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }, 1234.5);
  await waitCell("Two", euros);
  b.check(
    "choosing Euro formats the cell as euros, with the decimal places already set",
    (await cellText("Two"))?.[1] === euros,
    `${JSON.stringify(await cellText("Two"))} vs "${euros}"`,
  );
  await b.shot(`number-currency-${width}`);

  /* ---------------------------------------------------------------------------
     6. Sorting with the new wording actually sorts.
     --------------------------------------------------------------------------- */
  await openPropertyMenu("Amount");
  await openSub("Sort");
  await clickInSub("Low → High");
  await waitOrder(["Three", "One", "Two"]);
  b.check("“Low → High” puts the smallest number first", true, (await rowValues()).map((cells) => cells[0]).join(","));

  await openPropertyMenu("Amount");
  await openSub("Sort");
  await clickInSub("High → Low");
  await waitOrder(["Two", "One", "Three"]);
  b.check("“High → Low” puts the largest number first", true, (await rowValues()).map((cells) => cells[0]).join(","));
  const tooltip = await b.evaluate("(() => document.querySelector('.db-th-label[title*=\"High\"]')?.getAttribute('title') ?? '')()");
  b.check(
    "the sorted header says the same words as the menu did",
    String(tooltip).includes("High → Low"),
    String(tooltip),
  );

  /* ---------------------------------------------------------------------------
     7. A text column must not be given number settings, and keeps A → Z.
     --------------------------------------------------------------------------- */
  await openPropertyMenu("Name");
  const nameRows = await rows("first");
  b.check(
    "a text column has no number format rows",
    !nameRows.some((row) => row.label === "Number format" || row.label === "Decimal places"),
    nameRows.map((row) => row.label).join(" | "),
  );
  await openSub("Sort");
  const nameSorts = await rows();
  b.check(
    "a text column still sorts A → Z",
    nameSorts[0]?.label === "A → Z" && nameSorts[1]?.label === "Z → A",
    nameSorts.slice(0, 2).map((row) => row.label).join(" | "),
  );
  await closeMenu();

  const blocked = await b.blockedWrites();
  b.check("nothing the probe tried was refused a write it needed", blocked.length === 0, blocked.join(", "));
} catch (error) {
  /* A probe that throws must never read as green: `report()` would print "0/0 passed"
     and exit zero, which is the worst possible outcome — a red check disguised as no
     check at all. */
  console.error(error);
  b.check("the probe ran to completion", false, String(error?.message ?? error));
}

await b.report();
