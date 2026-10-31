// The Sort submenu of a Select column: does "Manual order" exist, and does it sort the rows
// the way the tags were arranged?
//
// Usage:
//   BASE=http://127.0.0.1:3100 PAGE=<page id> DB=<database id> \
//     node scripts/verify-db-sort-order.mjs [width] [height]
//   …or end to end on a disposable copy:  powershell -File scripts\run-sort-probe.ps1
//
// WHY IT WRITES: a sort *is* a view-config write, and the claim is that the write is what
// reorders the table. A DOM-only assertion would pass on a menu that reordered nothing but
// the local copy, so every claim here is read back from the server as well. It must point
// at a **disposable instance** (docs/TESTING.md).
//
// The three orders in the fixture are all different on purpose — see seed-qa-sort.mjs. A
// fixture where the arrangement is alphabetical cannot tell the two comparators apart, and
// that is exactly the bug this probe exists to catch.
import { openBrowser } from "./browser-session.mjs";

const width = Number(process.argv[2] ?? 1400);
const height = Number(process.argv[3] ?? 900);
const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const pageId = process.env.PAGE;
const databaseId = process.env.DB;
if (!pageId) throw new Error("PAGE=<seeded page id> is required — run scripts/seed-qa-sort.mjs first");

const ARRANGED = ["Row three", "Row two", "Row one", "Row four", "Row five"];
const ALPHABETICAL = ["Row two", "Row four", "Row one", "Row three", "Row five"];
const SEEDED = ["Row three", "Row one", "Row five", "Row four", "Row two"];

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

/** Rows of one open surface, with the tick each carries. */
const menuRows = (which = "last") => b.evaluate(`(() => {
  const all = [...document.querySelectorAll('[data-db-popover]')];
  const surface = ${JSON.stringify(which)} === "last" ? all[all.length - 1] : all[0];
  if (!surface) return [];
  return [...surface.querySelectorAll('.db-menu-item')].map((item) => ({
    label: (item.querySelector('.db-menu-label') ?? item).textContent.trim(),
    checked: !!item.querySelector('.db-menu-check'),
    hasIcon: !!item.querySelector('.db-menu-icon svg'),
  }));
})()`);

/* The row's name, not its tag: `.db-cell-name` is the primary cell on every row. In edit
   mode the name lives in an input (CellEditor) and in read mode in a span, so both are
   read — a probe that assumed one of them printed five empty strings and "passed" the
   count. */
const ORDER = `[...document.querySelectorAll('tr.db-row[data-row-id]')].map((tr) => {
  const cell = tr.querySelector('.db-cell-name');
  const input = cell?.querySelector('input');
  return (input ? input.value : cell?.querySelector('.db-cell-text')?.textContent ?? '').trim();
})`;

const rowOrder = () => b.evaluate(ORDER);

const waitOrder = (expected) => b.waitFor(`JSON.stringify(${ORDER}) === ${JSON.stringify(JSON.stringify(expected))}`, {
  timeoutMs: 8000,
  label: `rows in the order ${expected.join(", ")}`,
});

/** What the view config says the sort is, read from the server rather than from the DOM. */
async function storedSorts() {
  const response = await fetch(`${BASE}/api/databases/${databaseId}`, { headers: { origin: BASE } });
  if (!response.ok) throw new Error(`GET /api/databases/${databaseId} → ${response.status}`);
  const payload = await response.json();
  const database = payload.database ?? payload;
  return database.views.flatMap((view) => (view.config?.sorts ?? []).map((sort) => ({ view: view.id, ...sort })));
}

const headerState = (column) => b.evaluate(`(() => {
  const th = [...document.querySelectorAll('.db-th')].find((node) => node.textContent.trim().startsWith(${JSON.stringify(column)}));
  const label = th?.querySelector('.db-th-label');
  if (!label) return null;
  return { title: label.getAttribute('title') ?? '', indicator: !!label.querySelector('svg.db-th-sorted') };
})()`);

async function openPropertyMenu(column) {
  const at = await b.evaluate(`(() => {
    const th = [...document.querySelectorAll('.db-th')].find((node) => node.textContent.trim().startsWith(${JSON.stringify(column)}));
    const button = th?.querySelector('.db-th-label');
    if (!button) return null;
    /* The table scrolls sideways; a narrow viewport can put this column past the right edge,
       and a press at a coordinate outside the page goes nowhere. Scroll it in, then say
       whether the centre is actually reachable — found once the viewport was pinned to a true
       390 (browser-session.mjs). */
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

/** Hover a row of the open menu and wait for its submenu surface to appear. */
async function openSub(label) {
  const at = await centre(".db-menu-label", label);
  if (!at) throw new Error(`no menu row labelled ${label}`);
  await b.move(at.x, at.y);
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length >= 2", { label: `submenu for ${label}` });
  return at;
}

/** Click a row inside the open submenu the way a hand gets there.
 *
 * A straight line from the trigger row to the item is not that gesture. When the item is
 * *below* the trigger (which is every row except the first), the line cuts the corner —
 * and the corner is the parent surface's other rows, where "the pointer went to a sibling"
 * is exactly what the menu is supposed to read it as. So the crossing is two moves: out of
 * the trigger, through the gap (the corridor), into the surface; then vertically inside it.
 * Both directions of flip are handled, because at 390px the surface opens to the left.
 */
async function clickInSub(label, origin) {
  const at = await centre(".db-menu-label", label);
  if (!at) throw new Error(`no submenu row labelled ${label}`);
  const geometry = await b.evaluate(`(() => {
    const all = [...document.querySelectorAll('[data-db-popover]')];
    const sub = all[all.length - 1].getBoundingClientRect();
    const parent = all[all.length - 2].getBoundingClientRect();
    const toRight = sub.left >= parent.right;
    return {
      entryX: Math.round(toRight ? sub.left + 12 : sub.right - 12),
      top: Math.round(sub.top + 6),
      bottom: Math.round(sub.bottom - 6),
    };
  })()`);
  const entryY = Math.min(Math.max(origin.y, geometry.top), geometry.bottom);
  for (let step = 1; step <= 4; step++) {
    await b.move(Math.round(origin.x + (geometry.entryX - origin.x) * (step / 4)), Math.round(origin.y + (entryY - origin.y) * (step / 4)));
    await new Promise((r) => setTimeout(r, 40));
  }
  if ((await surfaceCount()) < 2) throw new Error(`the submenu closed while the pointer crossed the gap to ${label}`);
  for (let step = 1; step <= 3; step++) {
    await b.move(geometry.entryX, Math.round(entryY + (at.y - entryY) * (step / 3)));
    await new Promise((r) => setTimeout(r, 40));
  }
  await b.move(at.x, at.y);
  await new Promise((r) => setTimeout(r, 60));
  if ((await surfaceCount()) < 2) throw new Error(`the submenu closed before ${label} could be clicked`);
  await b.mouse(at.x, at.y);
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 0", { timeoutMs: 4000, label: "menu closes after choosing" });
}

async function chooseSort(column, label) {
  await openPropertyMenu(column);
  const origin = await openSub("Sort");
  await clickInSub(label, origin);
}

try {
  await b.waitFor("!!document.querySelector('.db-row[data-row-id]')", { timeoutMs: 45000, label: "the table renders" });

  /* ---------------------------------------------------------------------------
     1. The fixture is not degenerate: three different orders, all observable.
     --------------------------------------------------------------------------- */
  const seeded = await rowOrder();
  b.check(
    "the rows are seeded in the stored order, which is neither of the two sorts",
    JSON.stringify(seeded) === JSON.stringify(SEEDED),
    seeded.join(" | "),
  );
  b.check(
    "no sort is set before the probe touches anything",
    (await storedSorts()).length === 0,
    JSON.stringify(await storedSorts()),
  );

  /* ---------------------------------------------------------------------------
     2. The menu offers the row — and only where an arrangement exists.
     --------------------------------------------------------------------------- */
  await openPropertyMenu("Tags");
  await openSub("Sort");
  const sortRows = await menuRows();
  const labels = sortRows.map((row) => row.label);
  b.check(
    "a Select column's Sort submenu leads with Manual order",
    labels[0] === "Manual order",
    labels.join(" | "),
  );
  b.check(
    "…and still keeps A → Z, Z → A and Don't sort, because all three are real",
    ["A → Z", "Z → A", "Don't sort"].every((label) => labels.includes(label)),
    labels.join(" | "),
  );
  b.check(
    "the Manual order row is drawn with an icon, like every other row",
    sortRows.find((row) => row.label === "Manual order")?.hasIcon === true,
    JSON.stringify(sortRows[0]),
  );

  /* The gesture the safe triangle exists for, and the one this menu's shape invites: right
     and down at once, cutting the corner over the parent's other rows. Straight-line, no
     courtesy stop at the gap — because a hand has no such courtesy, and reaching the third
     item of a submenu is a diagonal by definition. */
  const trigger = await centre(".db-menu-label", "Sort");
  const lower = await centre(".db-menu-label", "Z → A");
  for (let step = 1; step <= 4; step++) {
    await b.move(
      Math.round(trigger.x + (lower.x - trigger.x) * (step / 4)),
      Math.round(trigger.y + (lower.y - trigger.y) * (step / 4)),
    );
    await new Promise((r) => setTimeout(r, 40));
  }
  b.check(
    "a diagonal move to a lower submenu row does not close the submenu",
    (await surfaceCount()) >= 2,
    `${await surfaceCount()} surfaces still open`,
  );
  await b.shot(`sort-menu-${width}`);
  await b.key("Escape", { keyCode: 27 });
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 0", { timeoutMs: 3000, label: "menu closes" });

  /* A type with no arrangement must not advertise one. Which column is the text one is
     read from the table rather than assumed: the primary column's name is per database.
     Filtered to headers that *have* a label, because the "+" column is also a `.db-th`
     and its text is empty — which found the wrong column and threw. */
  const otherColumn = await b.evaluate(`(() => [...document.querySelectorAll('.db-th')]
    .filter((th) => th.querySelector('.db-th-label'))
    .map((th) => th.querySelector('.db-th-label').textContent.trim())
    .find((text) => text && !text.startsWith("Tags")) ?? null)()`);
  await openPropertyMenu(otherColumn);
  await openSub("Sort");
  const nameLabels = (await menuRows()).map((row) => row.label);
  b.check(
    "a text column's Sort submenu has no Manual order row",
    !nameLabels.includes("Manual order"),
    nameLabels.join(" | "),
  );
  await b.key("Escape", { keyCode: 27 });
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 0", { timeoutMs: 3000, label: "menu closes" });

  /* ---------------------------------------------------------------------------
     3. Manual order: the arrangement, not the alphabet, and not the stored order.
     --------------------------------------------------------------------------- */
  await chooseSort("Tags", "Manual order");
  await waitOrder(ARRANGED);
  const manual = await rowOrder();
  b.check(
    "Manual order sorts the rows by the tag arrangement (Gamma, Alpha, Delta, Beta)",
    JSON.stringify(manual) === JSON.stringify(ARRANGED),
    manual.join(" | "),
  );
  b.check(
    "…and it is genuinely not the alphabetical order",
    JSON.stringify(manual) !== JSON.stringify(ALPHABETICAL),
    `manual=${manual.join(",")}`,
  );
  b.check(
    "…nor the order the rows were stored in",
    JSON.stringify(manual) !== JSON.stringify(SEEDED),
    manual.join(" | "),
  );
  b.check(
    "the untagged row is last, not first",
    manual.at(-1) === "Row five",
    `last="${manual.at(-1)}"`,
  );

  const storedManual = await storedSorts();
  b.check(
    "the server stored the sort as direction=manual",
    storedManual.length === 1 && storedManual[0].direction === "manual",
    JSON.stringify(storedManual),
  );
  b.check(
    "the server stored it against the Tags column, not some other one",
    storedManual[0]?.propertyId === process.env.TAGS,
    `stored="${storedManual[0]?.propertyId}" expected="${process.env.TAGS}"`,
  );

  const manualHeader = await headerState("Tags");
  b.check(
    "the header says which sort is on, in words",
    (manualHeader?.title ?? "").includes("Manual order"),
    `title="${manualHeader?.title}"`,
  );
  b.check(
    "…and draws an indicator, because a sorted column has to look sorted",
    manualHeader?.indicator === true,
    JSON.stringify(manualHeader),
  );
  await b.shot(`sort-manual-${width}`);

  /* The menu must show the tick on the order it is actually in. */
  await openPropertyMenu("Tags");
  await openSub("Sort");
  const ticked = (await menuRows()).find((row) => row.checked)?.label ?? null;
  b.check(
    "reopening the menu ticks Manual order",
    ticked === "Manual order",
    `ticked="${ticked}"`,
  );
  await b.key("Escape", { keyCode: 27 });
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 0", { timeoutMs: 3000, label: "menu closes" });

  /* ---------------------------------------------------------------------------
     4. A → Z is a different comparison, not a synonym.
     --------------------------------------------------------------------------- */
  await chooseSort("Tags", "A → Z");
  await waitOrder(ALPHABETICAL);
  const alpha = await rowOrder();
  b.check(
    "A → Z sorts by tag name now, which is what it always claimed",
    JSON.stringify(alpha) === JSON.stringify(ALPHABETICAL),
    alpha.join(" | "),
  );
  b.check(
    "the untagged row is last under A → Z too",
    alpha.at(-1) === "Row five",
    `last="${alpha.at(-1)}"`,
  );
  const storedAlpha = await storedSorts();
  b.check(
    "the server stored the alphabetical sort, replacing the manual one",
    storedAlpha.length === 1 && storedAlpha[0].direction === "ascending",
    JSON.stringify(storedAlpha),
  );
  b.check(
    "the header no longer claims a manual order",
    !(await headerState("Tags"))?.title.includes("Manual order"),
    `title="${(await headerState("Tags"))?.title}"`,
  );
  await b.shot(`sort-alphabetical-${width}`);

  /* ---------------------------------------------------------------------------
     5. Back to manual, then off — a sort can be removed like any other.
     --------------------------------------------------------------------------- */
  await chooseSort("Tags", "Manual order");
  await waitOrder(ARRANGED);
  await chooseSort("Tags", "Don't sort");
  await waitOrder(SEEDED);
  b.check(
    "Don't sort returns the rows to their stored order and clears the config",
    (await storedSorts()).length === 0,
    JSON.stringify(await storedSorts()),
  );
} catch (error) {
  /* `report()` ends the process, so a throw inside the body used to be swallowed and the
     run still printed OK — five checks, green, and the other twelve never ran. An exception
     is a failure of the probe itself and has to be scored as one. */
  b.check("the probe itself ran to the end without throwing", false, String(error?.stack ?? error));
} finally {
  await b.report();
}
