// The tag menu — Select, Multi-select, create, recolour, delete — driven with a real
// pointer against a disposable copy of the app.
//
// Usage:
//   BASE=http://127.0.0.1:3100 PAGE=<page id> DB=<database id> \
//     node scripts/verify-db-tags.mjs [width] [height]
//   …or, end to end on a disposable copy:  powershell -File scripts\run-tags-probe.ps1
//
// WHY IT WRITES: none of this can be proved by a screenshot. "Selecting a tag sticks",
// "creating a tag sticks", "multi-select keeps both" are claims about what the *server*
// stored, and the old control's most expensive bug was silent — it looked like it worked.
// So every check reads the stored cell back over the API rather than trusting pixels: a
// chip can render from a value the server refused.
//
// WHY EVERY WRITE IS WAITED FOR: `commit` closes the panel synchronously and the write
// lands a moment later, so asserting the DOM immediately after a click reads the *old*
// row. Two failures in the first draft of this file were that race, not the control.
//
// WHY A DISPOSABLE COPY: it writes, so it must not touch the owner's database. The runner
// starts a second instance from a copy of the project on port 3100 and re-seeds a fresh
// database for each resolution, so no pass inherits another pass's tags.
import { openBrowser } from "./browser-session.mjs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const pageId = process.env.PAGE;
const databaseId = process.env.DB;
if (!pageId) throw new Error("PAGE=<seeded page id> is required — run scripts/seed-qa-tags.mjs first");
if (!databaseId) throw new Error("DB=<database id> is required — run scripts/seed-qa-tags.mjs first");

const width = Number(process.argv[2] ?? process.env.W ?? 1400);
const height = Number(process.argv[3] ?? process.env.H ?? 900);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const b = await openBrowser({ url: `${BASE}/#${pageId}`, width, height });

/* `create` is async and called as `void create(...)`, so anything it throws becomes an
   unhandled rejection: no failure banner, no console trace in the probe, just a click that
   does nothing. Collecting them is what turns "nothing happened" into a stack. */
await b.evaluate(`(() => {
  window.__probeErrors = [];
  window.__probeLogs = [];
  const original = console.log;
  console.log = (...args) => { window.__probeLogs.push(args.map((value) => String(value)).join(" ")); original(...args); };
  window.addEventListener("unhandledrejection", (event) => window.__probeErrors.push("rejection: " + String(event.reason && event.reason.stack || event.reason)));
  window.addEventListener("error", (event) => window.__probeErrors.push("error: " + String(event.message)));
})()`);

/* ---------------------------------------------------------------------------
   The stored truth
   --------------------------------------------------------------------------- */
async function state() {
  const response = await fetch(`${BASE}/api/databases/${databaseId}`);
  const body = await response.json();
  const database = body.database ?? body;
  return (name) => {
    const property = database.properties.find((candidate) => candidate.name === name);
    return {
      property,
      options: (property?.config?.options ?? []).map((option) => ({ id: option.id, name: option.name, color: option.color })),
      cells: database.rows.map((row) => row.cells[property?.id] ?? null),
    };
  };
}

/** The option ids a cell holds, normalised: `select` stores one id, `multiSelect` a list. */
const idsOf = (value) => (Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : value ? [value] : []);

/* ---------------------------------------------------------------------------
   Pointing at things
   --------------------------------------------------------------------------- */
/* The `td` for one column, by its header label. Inlined into every expression below
   because a DOM node cannot come back over `returnByValue`. */
const tdExpr = (name, row) => `(() => {
  const th = [...document.querySelectorAll('.db-th')]
    .find((node) => (node.querySelector('.db-th-label')?.textContent ?? '').trim() === ${JSON.stringify(name)});
  if (!th) return null;
  return document.querySelectorAll('.db-row[data-row-id]')[${row}]?.querySelectorAll('td')[th.cellIndex] ?? null;
})()`;

/** The tag button inside one cell, with the label it carries, so a caller can assert it
    found the column it asked for instead of silently clicking the neighbour. */
const cellTrigger = (name, row = 0) => b.evaluate(`(() => {
  const td = ${tdExpr(name, row)};
  const el = td?.querySelector('.db-tag-trigger');
  if (!el) return null;
  /* At a narrow viewport the table scrolls horizontally and this column starts off-screen.
     A user scrolls it into view; so does the probe, rather than measuring a coordinate no
     pointer can reach. 'nearest' keeps the page itself from jumping. */
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  /* The left end of the cell: the chips live there. The hit test is part of the answer —
     a coordinate the pointer cannot reach is not a target, which is exactly how the
     colour-submenu probe failed before (a move outside the viewport sends no event). */
  const x = Math.round(r.left + Math.min(40, r.width / 2));
  const y = Math.round(r.top + r.height / 2);
  const under = document.elementFromPoint(x, y);
  return {
    x,
    y,
    label: el.getAttribute('aria-label') ?? '',
    hit: under?.closest('.db-tag-trigger')?.getAttribute('aria-label') ?? (under ? under.tagName + '.' + under.className : 'nothing'),
  };
})()`);

/** The chips a cell is rendering, with the colour attribute the CSS keys on. */
const cellChips = (name, row = 0) => b.evaluate(`(() => {
  const td = ${tdExpr(name, row)};
  if (!td) return [];
  return [...td.querySelectorAll('.db-tag')].map((chip) => ({
    name: (chip.querySelector('.db-tag-name')?.textContent ?? '').trim(),
    color: chip.getAttribute('data-color'),
  }));
})()`);

/** Waits until a cell shows exactly these tag names, sorted. */
const waitChips = (name, row, expected) => b.waitFor(`(() => {
  const td = ${tdExpr(name, row)};
  if (!td) return false;
  const seen = [...td.querySelectorAll('.db-tag-name')].map((node) => node.textContent.trim()).sort().join(',');
  return seen === ${JSON.stringify([...expected].sort().join(","))};
})()`, { label: `${name} row ${row} shows "${expected.join(",")}"` });

/** A row or control inside the *topmost* menu surface, by its visible text.
    Scrolls the surface first when the row is below its fold — a tall menu (the colour
    list is 408px) is reached by scrolling, and measuring an unreachable row would report
    a coordinate no pointer can hit rather than a menu that has to scroll. */
const hitInLastSurface = (selector, text = "") => b.evaluate(`(() => {
  const all = [...document.querySelectorAll('[data-db-popover]')];
  const scope = all[all.length - 1];
  if (!scope) return null;
  const el = [...scope.querySelectorAll(${JSON.stringify(selector)})]
    .find((node) => ${JSON.stringify(text)} === "" || node.textContent.trim() === ${JSON.stringify(text)});
  if (!el) return null;
  const surfaceRect = scope.getBoundingClientRect();
  let rect = el.getBoundingClientRect();
  if (rect.bottom > surfaceRect.bottom) {
    scope.scrollTop += rect.bottom - surfaceRect.bottom + 6;
    rect = el.getBoundingClientRect();
  } else if (rect.top < surfaceRect.top) {
    scope.scrollTop -= surfaceRect.top - rect.top + 6;
    rect = el.getBoundingClientRect();
  }
  if (!rect.width || !rect.height) return null;
  return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
})()`);

/** The `⋯` belonging to the option row whose chip reads `text`. */
const hitOptionMore = (text) => b.evaluate(`(() => {
  const all = [...document.querySelectorAll('[data-db-popover]')];
  const scope = all[all.length - 1];
  const row = [...(scope?.querySelectorAll('.db-option-row') ?? [])]
    .find((node) => (node.querySelector('.db-tag-name')?.textContent ?? '').trim() === ${JSON.stringify(text)});
  const el = row?.querySelector('.db-option-more');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);

const surfaces = () => b.evaluate("document.querySelectorAll('[data-db-popover]').length");
const optionRows = () => b.evaluate(`(() => {
  const all = [...document.querySelectorAll('[data-db-popover]')];
  return [...(all[all.length - 1]?.querySelectorAll('.db-option-row .db-tag-name') ?? [])].map((node) => node.textContent.trim());
})()`);

const click = async (point) => {
  if (!point) throw new Error("nothing to click at");
  await b.mouse(point.x, point.y);
  await sleep(150);
};

const openCell = async (name, row = 0) => {
  const trigger = await cellTrigger(name, row);
  if (!trigger) throw new Error(`no tag button in ${name} row ${row}`);
  /* If the pointer is about to press a cell that says it is a different column, say so
     here — otherwise the probe happily edits the neighbour and the assertion two steps
     later blames the wrong thing. */
  if (!trigger.label.startsWith(`${name}:`)) {
    throw new Error(`asked for ${name} row ${row}, found "${trigger.label}"`);
  }
  if (trigger.hit !== trigger.label) {
    throw new Error(`the pointer at ${trigger.x},${trigger.y} would hit "${trigger.hit}", not "${trigger.label}"`);
  }
  await click(trigger);
  await b.waitFor("!!document.querySelector('[data-db-popover] .db-option-input')", { label: "the tag panel" });
};

const typeSearch = async (text) => {
  await click(await hitInLastSurface(".db-option-input"));
  await b.type(text);
  await sleep(140);
};

/** A point on inert content far from any menu: the page's first paragraph, found by the
    text the seed gave it. Earlier attempts clicked a filler cell (the panel was drawn *over*
    it, so the press landed inside the popover and correctly did not close) and a `main`
    fallback (which resolved to the top bar). */
const inertPoint = () => b.evaluate(`(() => {
  const el = [...document.querySelectorAll('p, h1, div')]
    .find((node) => node.childElementCount === 0 && (node.textContent ?? '').trim() === 'QA tags page');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const x = Math.round(r.left + 6);
  const y = Math.round(r.top + r.height / 2);
  const under = document.elementFromPoint(x, y);
  return { x, y, hit: under ? under.tagName + '.' + String(under.className).slice(0, 40) : 'nothing' };
})()`);

/** Closes every open menu surface the way a person does: click away from it.
    Escape was tried first and never closed anything through CDP's key path, and a probe
    that dismisses with something users do not is a probe that hides a real dismissal bug.
    Clicking outside also exercises `useMenuDismiss`'s capture listener, which is the path
    that has to work regardless. */
const closeSurfaces = async () => {
  for (let i = 0; i < 4; i++) {
    if ((await surfaces()) === 0) return;
    const point = await inertPoint();
    if (!point) throw new Error("no inert point to click away to");
    await click(point);
    await sleep(200);
  }
  if ((await surfaces()) !== 0) throw new Error("a menu surface would not close");
};

/* ---------------------------------------------------------------------------
   The checks
   --------------------------------------------------------------------------- */
try {
  await b.waitFor("!!document.querySelector('.db-row[data-row-id] .db-tag-trigger')", { label: "the tag cells" });

  /* 1. It is no longer a native `<select>`. That element can only choose from options
     that already exist, which is why creating a tag was impossible. */
  const natives = await b.evaluate("document.querySelectorAll('.db-cell select').length");
  b.check("no cell is a native <select> any more", natives === 0, `${natives} found`);

  const before = await state();
  const seeded = before("Status").options.map((option) => option.name);
  b.check("the seeded select column lists its options", seeded.includes("Alpha") && seeded.includes("Beta"), seeded.join(","));

  /* 2. Picking an existing option, and the stored value behind it. */
  await openCell("Status", 0);
  const listed = await optionRows();
  b.check(
    "the panel lists the existing options",
    listed.includes("Alpha") && listed.includes("Beta"),
    listed.join(","),
  );

  await click(await hitInLastSurface(".db-option-pick", "Alpha"));
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 0", { label: "the panel closing on pick" });
  await waitChips("Status", 0, ["Alpha"]);

  let status = await state();
  const alphaId = status("Status").options.find((option) => option.name === "Alpha").id;
  b.check(
    "…and the server stored the option id, not a label",
    idsOf(status("Status").cells[0]).join(",") === alphaId,
    JSON.stringify(status("Status").cells[0]),
  );
  let chips = await cellChips("Status", 0);
  b.check(
    "…and the chip is drawn in that option's colour",
    chips[0]?.color === "orange",
    `chip says ${chips[0]?.color}, option says orange`,
  );

  /* 3. Clicking the current value clears it. Without this a select can never be emptied. */
  await openCell("Status", 0);
  await click(await hitInLastSurface(".db-option-pick", "Alpha"));
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 0", { label: "the panel closing on clear" });
  await waitChips("Status", 0, []);
  status = await state();
  b.check("clicking the chosen tag again clears the cell", idsOf(status("Status").cells[0]).length === 0, JSON.stringify(status("Status").cells[0]));

  /* 4. Creating a tag.
     The check that matters most. The option lives in the *property's* config and the cell
     stores its id; the server's `coerce` drops an id it cannot find, so a cell written
     before the option exists is stored as empty — the tag flashes, then vanishes. Reading
     the cell back after the write is the only way to see that. */
  await openCell("Status", 0);
  await typeSearch("Gamma");
  const createRow = await hitInLastSurface(".db-option-create", "Create Gamma");
  b.check("typing a new name offers to create it", Boolean(createRow));

  await click(createRow);
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 0", { label: "the panel closing after create" });
  await waitChips("Status", 0, ["Gamma"]);

  status = await state();
  const gamma = status("Status").options.find((option) => option.name === "Gamma");
  b.check("creating a tag writes it into the property's config", Boolean(gamma), status("Status").options.map((option) => option.name).join(","));
  b.check(
    "creating a tag leaves the cell holding it (not silently emptied)",
    Boolean(gamma) && idsOf(status("Status").cells[0]).join(",") === gamma.id,
    `cell ${JSON.stringify(status("Status").cells[0])} vs option ${gamma?.id}`,
  );
  b.check(
    "a created tag gets a real palette colour",
    Boolean(gamma) && gamma.color !== "default",
    String(gamma?.color),
  );

  /* 5. Recolouring. The colour lives on the option, so every cell using it follows —
     which is the whole reason options are not stored per cell. */
  await openCell("Status", 0);
  await click(await hitOptionMore("Gamma"));
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 2", { label: "the option's own panel" });
  const colors = await b.evaluate(`(() => {
    const all = [...document.querySelectorAll('[data-db-popover]')];
    return [...(all[all.length - 1]?.querySelectorAll('.db-option-colors .db-menu-label') ?? [])].map((node) => node.textContent.trim());
  })()`);
  b.check(
    "the colour list is the palette plus Default",
    colors[0] === "Default" && colors.includes("Blue") && colors.length === 10,
    colors.join(","),
  );

  const bluePoint = await hitInLastSurface(".db-menu-row", "Blue");
  await click(bluePoint);
  await b.waitFor(`(() => {
    const td = ${tdExpr("Status", 0)};
    return !!td?.querySelector('.db-tag[data-color="blue"]');
  })()`, { label: "the chip repainting blue" });
  status = await state();
  const recoloured = status("Status").options.find((option) => option.name === "Gamma");
  b.check("choosing a colour writes it to the option", recoloured?.color === "blue", String(recoloured?.color));
  chips = await cellChips("Status", 0);
  b.check("…and the chip in the cell repaints", chips[0]?.color === "blue", JSON.stringify(chips));
  await closeSurfaces();

  /* 6. Multi-select appends instead of replacing. The native `<select>` committed
     `[...selected, id]` from a fresh Set every time, so a second pick wiped the first. */
  await openCell("Tags", 1);
  await typeSearch("One");
  const onePoint = await hitInLastSurface(".db-option-create", "Create One");
  await click(onePoint);
  await waitChips("Tags", 1, ["One"]);
  await typeSearch("Two");
  await click(await hitInLastSurface(".db-option-create", "Create Two"));
  await waitChips("Tags", 1, ["One", "Two"]);

  let tags = await state();
  b.check(
    "multi-select keeps both tags",
    idsOf(tags("Tags").cells[1]).length === 2,
    JSON.stringify(tags("Tags").cells[1]),
  );

  /* 7. Deleting an option removes it from the config *and* clears the cells that held it,
     rather than leaving them pointing at an id that no longer resolves. */
  await click(await hitOptionMore("One"));
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 2", { label: "the option's own panel" });
  await click(await hitInLastSurface(".db-menu-item", "Delete"));
  await waitChips("Tags", 1, ["Two"]);

  tags = await state();
  b.check(
    "deleting an option removes it from the config",
    !tags("Tags").options.some((option) => option.name === "One"),
    tags("Tags").options.map((option) => option.name).join(","),
  );
  b.check(
    "…and the cell that held it no longer points at it",
    idsOf(tags("Tags").cells[1]).length === 1,
    JSON.stringify(tags("Tags").cells[1]),
  );

  const blocked = await b.blockedWrites();
  b.check("nothing the probe tried was refused a write it needed", blocked.length === 0, blocked.join(", "));
} catch (error) {
  /* A probe that throws must never read as green: `report()` would print "0/0 passed"
     and exit zero — a red check disguised as no check at all. Dumping the page turns
     "it did not render" into "it did not render *because*". */
  console.error(error);
  try {
    await b.shot("tags-failure");
    const seen = await b.evaluate("({ text: document.body.innerText.slice(0, 700), cells: document.querySelectorAll('.db-cell').length })");
    console.error("PAGE:", JSON.stringify(seen, null, 2));
  } catch { }
  b.check("the probe ran to completion", false, String(error?.message ?? error));
}

await b.report();
