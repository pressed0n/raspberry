// The tag menu's reorder grip — driven with a real pointer against a disposable copy.
//
// Usage:
//   BASE=http://127.0.0.1:3100 PAGE=<page id> DB=<database id> \
//     node scripts/verify-db-option-reorder.mjs [width] [height]
//   …or, end to end on a disposable copy:  powershell -File scripts\run-reorder-probe.ps1
//
// WHY IT WRITES: a reorder *is* a write. Nothing in the DOM can prove that the order the
// browser drew is the order the property will have tomorrow, and this project has already
// shipped a chip that rendered from a value the server had refused. So every assertion
// here reads the stored config back and compares it to the stored array, not to the DOM.
//
// WHY THE DRAG IS MEASURED, NOT ASSUMED: the bug that made the property menu's submenu
// vanish 70% of the time was a 6px corridor no screenshot could see — the pointer left the
// row and the surface unmounted mid-crossing. A drag has the same shape of hazard (a press
// that lands on the row instead of the grip still *looks* like a drag), so the grip's own
// rectangle is hit-tested before it is pressed, and a press that does not move is checked
// to reorder nothing.
import { openBrowser } from "./browser-session.mjs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const pageId = process.env.PAGE;
const databaseId = process.env.DB;
if (!pageId) throw new Error("PAGE=<seeded page id> is required — run scripts/seed-qa-reorder.mjs first");
if (!databaseId) throw new Error("DB=<database id> is required — run scripts/seed-qa-reorder.mjs first");

const width = Number(process.argv[2] ?? process.env.W ?? 1400);
const height = Number(process.argv[3] ?? process.env.H ?? 900);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const b = await openBrowser({ url: `${BASE}/#${pageId}`, width, height });

await b.evaluate(`(() => {
  window.__probeErrors = [];
  window.addEventListener("unhandledrejection", (event) => window.__probeErrors.push("rejection: " + String(event.reason && event.reason.stack || event.reason)));
  window.addEventListener("error", (event) => window.__probeErrors.push("error: " + String(event.message)));
})()`);

/* ---------------------------------------------------------------------------
   The stored truth
   ------------------------------------------------------------------------- */
async function stored() {
  const response = await fetch(`${BASE}/api/databases/${databaseId}`);
  const body = await response.json();
  const database = body.database ?? body;
  const property = database.properties.find((candidate) => candidate.name === "Status");
  return (property?.config?.options ?? []).map((option) => option.name);
}

/* ---------------------------------------------------------------------------
   Pointing at things
   ------------------------------------------------------------------------- */
const tdExpr = (name, row) => `(() => {
  const th = [...document.querySelectorAll('.db-th')]
    .find((node) => (node.querySelector('.db-th-label')?.textContent ?? '').trim() === ${JSON.stringify(name)});
  if (!th) return null;
  return document.querySelectorAll('.db-row[data-row-id]')[${row}]?.querySelectorAll('td')[th.cellIndex] ?? null;
})()`;

const openPanel = async () => {
  /* The page is a document that has to load a block, a database and a view before there is
     a cell to press. Waiting on the trigger rather than on a timeout is also what keeps the
     first sample from measuring a half-drawn table. */
  await b.waitFor(`(() => {
    const td = ${tdExpr("Status", 0)};
    return Boolean(td?.querySelector('.db-tag-trigger'));
  })()`, { timeoutMs: 30000, label: "the Status cell's trigger" });
  const trigger = await b.evaluate(`(() => {
    const td = ${tdExpr("Status", 0)};
    const el = td?.querySelector('.db-tag-trigger');
    if (!el) return null;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const x = Math.round(r.left + Math.min(40, r.width / 2));
    const y = Math.round(r.top + r.height / 2);
    return { x, y, hit: document.elementFromPoint(x, y)?.closest('.db-tag-trigger') ? 'trigger' : 'something else' };
  })()`);
  if (!trigger) throw new Error("no .db-tag-trigger in the Status cell — is the seed applied?");
  if (trigger.hit !== "trigger") throw new Error(`the point that should open the panel hit ${trigger.hit}`);
  await b.mouse(trigger.x, trigger.y);
  await b.waitFor(`document.querySelectorAll('.db-option-row').length > 0`, { label: "the option rows to mount" });
};

/** The rows as drawn, with the geometry the grip's hit test depends on. */
const rows = () => b.evaluate(`(() => {
  return [...document.querySelectorAll('.db-option-row')].map((row) => {
    const grip = row.querySelector('.db-option-grip');
    const chip = row.querySelector('.db-tag');
    const more = row.querySelector('.db-option-more');
    const gr = grip?.getBoundingClientRect() ?? null;
    const cr = chip?.getBoundingClientRect() ?? null;
    return {
      id: row.dataset.optionId ?? null,
      name: (row.querySelector('.db-tag-name')?.textContent ?? '').trim(),
      grip: gr ? { x: Math.round(gr.left + gr.width / 2), y: Math.round(gr.top + gr.height / 2), left: Math.round(gr.left), right: Math.round(gr.right), width: Math.round(gr.width) } : null,
      chipLeft: cr ? Math.round(cr.left) : null,
      gripOpacity: grip ? getComputedStyle(grip).opacity : null,
      gripEvents: grip ? getComputedStyle(grip).pointerEvents : null,
      more: more ? (() => { const r = more.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })() : null,
      drop: row.dataset.drop ?? null,
    };
  });
})()`);

const names = async () => (await rows()).map((row) => row.name);

/** Polls until the drawn order equals `expected`, so a write in flight is not a failure. */
const waitOrder = async (expected) => {
  for (let i = 0; i < 40; i++) {
    const seen = await names();
    if (seen.join(",") === expected.join(",")) return true;
    await sleep(100);
  }
  return false;
};

/** The same, against the stored config — the only witness that survives a menu closing. */
const waitStored = async (expected) => {
  for (let i = 0; i < 40; i++) {
    if ((await stored()).join(",") === expected.join(",")) return true;
    await sleep(100);
  }
  return false;
};

await openPanel();

/* ---------------------------------------------------------------------------
   1. The list is the property's order, not a re-sorted one
   ------------------------------------------------------------------------- */
const seeded = await stored();
b.check("the panel draws the stored order", (await names()).join(",") === seeded.join(","),
  `drawn=${(await names()).join(",")} stored=${seeded.join(",")}`);
b.check("the seed is not alphabetical, so a sort cannot pass as a reorder",
  seeded.join(",") !== [...seeded].sort().join(","), seeded.join(","));

/* ---------------------------------------------------------------------------
   2. Every row has the shared grip, on the left of its chip
   ------------------------------------------------------------------------- */
const before = await rows();
b.check("every option row has a grip", before.every((row) => row.grip), `${before.length} rows`);
b.check("the grip sits left of the chip", before.every((row) => row.grip && row.chipLeft !== null && row.grip.right <= row.chipLeft),
  before.map((row) => `${row.name}:${row.grip?.right}/${row.chipLeft}`).join(" "));

/* ---------------------------------------------------------------------------
   3. Hidden means hidden, and revealing it does not move the chip
   ------------------------------------------------------------------------- */
const atRest = await rows();
/* `opacity` is compared as a number, not as the string "0"/"1": the shared `.frame-grip`
   reveal is a `--t-tap` transition, so a sample taken mid-fade is a legitimate 0.6 and a
   strict string compare would report a broken grip on a slower machine. */
b.check("the grip is invisible at rest", atRest.every((row) => Number(row.gripOpacity) <= 0.01),
  atRest.map((row) => row.gripOpacity).join(","));
b.check("the grip takes no clicks while invisible", atRest.every((row) => row.gripEvents === "none"),
  atRest.map((row) => row.gripEvents).join(","));

/* Hover the row's *chip*, not the grip: that is the approach a person makes. */
await b.move(before[1].chipLeft + 6, before[1].grip.y);
await sleep(250);
const hovered = await rows();
b.check("hovering the row reveals its grip", Number(hovered[1].gripOpacity) >= 0.99, `opacity=${hovered[1].gripOpacity}`);
b.check("the revealed grip takes clicks", hovered[1].gripEvents === "auto", `pointer-events=${hovered[1].gripEvents}`);
b.check("revealing the grip does not shift the chip", hovered[1].chipLeft === before[1].chipLeft,
  `rest=${before[1].chipLeft} hover=${hovered[1].chipLeft}`);
/* Visual evidence of the state the numbers describe: the grip drawn on the hovered row and
   absent from the others. A screenshot cannot prove a reorder (the list looks like a list
   either way), which is why the assertions above come first — but it *can* show that the
   handle is the six-dot glyph and not a lucide hairline. */
await b.shot(`option-reorder-grip-${width}`);

/* ---------------------------------------------------------------------------
   4. A press that never moves is a click, not a reorder
   ------------------------------------------------------------------------- */
await b.mouse(before[0].grip.x, before[0].grip.y);
await sleep(250);
b.check("a press on the grip that never moves reorders nothing",
  (await names()).join(",") === seeded.join(","), (await names()).join(","));
b.check("...and writes nothing", (await stored()).join(",") === seeded.join(","));

/* ---------------------------------------------------------------------------
   5. The drop line shows where it will land, mid-drag
   ------------------------------------------------------------------------- */
await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: before[0].grip.x, y: before[0].grip.y });
await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: before[0].grip.x, y: before[0].grip.y, button: "left", clickCount: 1 });
for (let i = 1; i <= 10; i++) {
  await b.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: before[0].grip.x,
    y: before[0].grip.y + ((before[2].grip.y - before[0].grip.y) * i) / 10,
    button: "left",
    buttons: 1,
  });
  await sleep(16);
}
const midDrag = await rows();
const marked = midDrag.filter((row) => row.drop);
b.check("the row under the pointer draws a drop line", marked.length === 1,
  marked.map((row) => `${row.name}:${row.drop}`).join(",") || "none");
await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: before[0].grip.x, y: before[2].grip.y, button: "left", clickCount: 1 });

/* The drag above went from row 0 to row 2, so the moved option lands *after* row 2. */
const expectedDown = [seeded[1], seeded[2], seeded[0], seeded[3]];
b.check("dragging the top tag down three rows reorders the list", await waitOrder(expectedDown), (await names()).join(","));
b.check("...and the property stores that order", (await stored()).join(",") === expectedDown.join(","), (await stored()).join(","));

/* ---------------------------------------------------------------------------
   6. The order is the property's, not the panel's
   ------------------------------------------------------------------------- */
/* `Page.navigate`, not `location.reload()`: the reload destroys the execution context the
   evaluate call is running in, so the call itself rejects and the next read races the new
   document. */
await b.send("Page.navigate", { url: `${BASE}/#${pageId}` });
await sleep(1500);
await b.waitFor(`!!document.querySelector('.db-row[data-row-id]')`, { timeoutMs: 30000, label: "the table after a reload" });
await openPanel();
b.check("the order survives a reload", (await names()).join(",") === expectedDown.join(","), (await names()).join(","));

/* ---------------------------------------------------------------------------
   7. Dragging back up lands *before* the target, not after it
   ------------------------------------------------------------------------- */
const moving = await rows();
const top = moving.findIndex((row) => row.name === seeded[0]);
await b.drag(
  { x: moving[top].grip.x, y: moving[top].grip.y },
  { x: moving[0].grip.x, y: moving[0].grip.y },
  { steps: 14 },
);
const expectedUp = [seeded[0], seeded[1], seeded[2], seeded[3]];
b.check("dragging back up restores the seeded order", await waitOrder(expectedUp), (await names()).join(","));
b.check("...in one write, on the server too", (await stored()).join(",") === expectedUp.join(","), (await stored()).join(","));

/* ---------------------------------------------------------------------------
   8. The keyboard path, because a drag is not available to everyone
   ------------------------------------------------------------------------- */
/** Opens one row's `⋯` panel and returns both move items as measured targets. */
const openEditor = async (index) => {
  const list = await rows();
  await b.mouse(list[index].more.x, list[index].more.y);
  await b.waitFor(`[...document.querySelectorAll('.db-menu-label')].some((n) => n.textContent === 'Move down')`, { label: "the ⋯ panel to offer the move items" });
  return b.evaluate(`(() => {
    const read = (text) => {
      const item = [...document.querySelectorAll('.db-menu-label')]
        .find((node) => node.textContent === text)?.closest('button, [role="menuitem"]') ?? null;
      if (!item) return null;
      const r = item.getBoundingClientRect();
      return {
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
        disabled: item.disabled === true || item.getAttribute('aria-disabled') === 'true',
      };
    };
    return { up: read('Move up'), down: read('Move down') };
  })()`);
};

const first = await openEditor(0);
b.check("Move up is disabled on the first tag", first.up?.disabled === true, JSON.stringify(first.up));
b.check("Move down is enabled on the first tag", first.down !== null && first.down.disabled === false, JSON.stringify(first.down));

await b.mouse(first.down.x, first.down.y);
const expectedKey = [seeded[1], seeded[0], seeded[2], seeded[3]];
/* The server first. A press inside the `⋯` submenu closes the whole menu — it is portalled
   outside the panel that dismissed itself — so the drawn list is gone by the time the write
   lands, and reading it here would test the menu's dismissal, not the reorder. */
b.check("Move down moves exactly one place", await waitStored(expectedKey), (await stored()).join(","));
if (!(await b.evaluate("Boolean(document.querySelector('.db-option-row'))"))) await openPanel();
b.check("...and the drawn list agrees", (await names()).join(",") === expectedKey.join(","), (await names()).join(","));

const last = await openEditor(3);
b.check("Move down is disabled on the last tag", last.down?.disabled === true, JSON.stringify(last.down));
b.check("Move up is enabled on the last tag", last.up !== null && last.up.disabled === false, JSON.stringify(last.up));

/* ---------------------------------------------------------------------------
   9. Filtering hides the grip: a subset has no index to drop into
   ------------------------------------------------------------------------- */
await b.key("Escape", { keyCode: 27 });
await sleep(200);
if (!(await b.evaluate("Boolean(document.querySelector('.db-option-row'))"))) await openPanel();
const search = await b.evaluate(`(() => {
  const el = document.querySelector('.db-option-input');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);
await b.mouse(search.x, search.y);
await b.type("e");
await sleep(300);
const filtered = await b.evaluate(`(() => ({
  rows: document.querySelectorAll('.db-option-row').length,
  grips: document.querySelectorAll('.db-option-grip').length,
  names: [...document.querySelectorAll('.db-option-row .db-tag-name')].map((node) => node.textContent),
}))()`);
b.check("a filtered list still lists the matches", filtered.rows > 0 && filtered.rows < 4, JSON.stringify(filtered.names));
b.check("a filtered list draws no grips", filtered.grips === 0, JSON.stringify(filtered));

/* ---------------------------------------------------------------------------
   10. Nothing threw
   ------------------------------------------------------------------------- */
const errors = await b.evaluate("window.__probeErrors ?? []");
b.check("no runtime errors", errors.length === 0, errors.join(" | "));

await b.shot(`option-reorder-${width}`);
await b.report();
