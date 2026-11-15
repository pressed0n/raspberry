// The formula editor: a column that computes, and the surface that writes what it computes.
//
// Usage:
//   BASE=http://127.0.0.1:3111 PAGE=<page id> DB=<database id> PRICE=<id> TOTAL=<id> LABEL=<id> OPEN=<id> \
//     node scripts/verify-db-formula.mjs [width] [height]
//   …or end to end on a disposable copy:  powershell -File scripts\run-formula-probe.ps1
//
// WHAT THIS PROVES THAT A UNIT TEST CANNOT
// The language is tested in `tests/database-formula.test.ts` against rows in memory. What that file
// cannot see is whether the *app* computes the column: the server has to fill the derived cells on
// the read path, the cell has to draw them, the editor has to open on the real expression, the
// suggestion list has to insert at the caret, and the one write has to survive a round trip through
// `PATCH /properties`. So every check below is against the running app.
//
// WHY IT EDITS A REAL FORMULA AND READS IT BACK
// "It currently does nothing" is the complaint this turn answers, and "it does something" is only
// true if the expression written in the panel reaches sqlite and comes back as a different number in
// the cell. `prop("Price") + 5` is chosen because it changes the value *and* keeps the other formula
// column (`Label`, which reads `Total`) meaningful — a second read path proving the first.
import { openBrowser } from "./browser-session.mjs";

const width = Number(process.argv[2] ?? 1400);
const height = Number(process.argv[3] ?? 900);
const BASE = process.env.BASE ?? "http://127.0.0.1:3111";
const pageId = process.env.PAGE;
const databaseId = process.env.DB;
const ids = { price: process.env.PRICE, total: process.env.TOTAL, label: process.env.LABEL, open: process.env.OPEN };
if (!pageId || !databaseId || !ids.price || !ids.total || !ids.label || !ids.open) {
  throw new Error("PAGE, DB, PRICE, TOTAL, LABEL and OPEN are required — run scripts/seed-qa-formula.mjs first");
}

/** The stored payload: what sqlite says, independent of what the table drew. */
async function stored() {
  const response = await fetch(`${BASE}/api/databases/${databaseId}`, { headers: { origin: BASE } });
  if (!response.ok) throw new Error(`GET /api/databases/${databaseId} → ${response.status}`);
  const payload = await response.json();
  const database = payload.database ?? payload;
  const formula = database.properties.find((property) => property.id === ids.total);
  return {
    rows: Object.fromEntries(database.rows.map((row) => [row.title, row])),
    expression: formula?.config?.expression ?? null,
  };
}

const b = await openBrowser({ url: `${BASE}/#${pageId}`, width, height });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ROW = (title) => `[...document.querySelectorAll('tr[data-row-id]')].find((node) => {
  const name = node.querySelector('.db-name-cell input')?.value
    ?? node.querySelector('.db-name-cell .db-cell-text')?.textContent
    ?? '';
  return name.trim() === ${JSON.stringify(title)};
})`;

const CELL = (title, propertyId) => `${ROW(title)}?.querySelector('td[data-property-id="${propertyId}"]')`;

/** What the closed cell says. */
const cellOf = (title, propertyId) => b.evaluate(`(() => {
  const cell = ${CELL(title, propertyId)};
  if (!cell) return { missing: "cell" };
  const trigger = cell.querySelector('.db-formula-trigger');
  return {
    missing: trigger ? null : "trigger",
    html: trigger ? null : cell.innerHTML.slice(0, 160),
    tag: trigger?.tagName ?? null,
    haspopup: trigger?.getAttribute('aria-haspopup') ?? null,
    expanded: trigger?.getAttribute('aria-expanded') ?? null,
    text: trigger?.textContent.trim() ?? '',
    empty: !!trigger?.querySelector('.db-cell-empty'),
    error: !!trigger?.querySelector('.db-formula-value.is-error'),
    /* A formula cell that could type would be a cell that stores a value nobody computed. */
    inputs: cell.querySelectorAll('input, textarea').length,
  };
})()`);

/** The open panel, described by what a person can read off it. */
const panel = () => b.evaluate(`(() => {
  const panel = [...document.querySelectorAll('[data-db-popover]')].find((node) => node.querySelector('.db-fx-input'));
  if (!panel) return { open: false };
  const field = panel.querySelector('.db-fx-input');
  const painted = panel.querySelector('.db-fx-code');
  const rect = panel.getBoundingClientRect();
  return {
    open: true,
    role: panel.getAttribute('role'),
    title: panel.querySelector('.db-fx-title')?.textContent ?? '',
    value: field.value,
    painted: (painted?.textContent ?? '').replace(/​/g, ''),
    spans: [...panel.querySelectorAll('.db-fx-code span')].map((span) => span.className),
    sections: [...panel.querySelectorAll('.db-fx-section-title')].map((node) => node.textContent),
    properties: [...panel.querySelectorAll('.db-fx-entry[data-fx-entry^="prop:"]')].map((node) => node.textContent.trim()),
    entries: [...panel.querySelectorAll('.db-fx-entry')].map((node) => ({
      key: node.getAttribute('data-fx-entry'),
      label: node.querySelector('.db-fx-entry-label')?.textContent ?? '',
    })),
    active: panel.querySelector('.db-fx-entry.is-active .db-fx-entry-label')?.textContent ?? null,
    signature: panel.querySelector('.db-fx-signature')?.textContent ?? null,
    output: panel.querySelector('.db-fx-value')?.textContent ?? null,
    type: panel.querySelector('.db-fx-type')?.textContent ?? null,
    error: panel.querySelector('.db-fx-error')?.textContent ?? null,
    hint: !!panel.querySelector('.db-fx-hint'),
    trace: [...panel.querySelectorAll('.db-fx-trace-row')].map((node) => ({
      code: node.querySelector('.db-fx-trace-code')?.textContent ?? '',
      value: node.querySelector('.db-fx-trace-value')?.textContent ?? '',
      type: node.querySelector('.db-fx-trace-type')?.textContent ?? '',
    })),
    rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width },
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
})()`);

/** A real press at the middle of a thing, after scrolling it into view, and only if the point
 *  actually lands on it — a press at an off-screen coordinate reports "nothing happened". */
async function pressAt(expression, label) {
  const point = await b.evaluate(`(() => {
    const node = ${expression};
    if (!node) return { missing: true };
    node.scrollIntoView({ block: 'nearest', inline: 'center' });
    const box = node.getBoundingClientRect();
    const x = Math.round(box.left + box.width / 2);
    const y = Math.round(box.top + box.height / 2);
    const hit = document.elementFromPoint(x, y);
    return {
      x, y,
      reachable: !!hit && (hit === node || node.contains(hit)),
      blockedBy: hit ? (hit.className || hit.tagName) : null,
    };
  })()`);
  if (point.missing) throw new Error(`nothing to press: ${label}`);
  if (!point.reachable) throw new Error(`${label} is at ${point.x},${point.y} but ${point.blockedBy} is on top of it`);
  await b.mouse(point.x, point.y);
  await sleep(160);
  return point;
}

const setField = async (text) => {
  await b.evaluate("(() => { const f = document.querySelector('.db-fx-input'); f.focus(); f.select(); return true; })()");
  if (text) await b.type(text);
  else await b.key("Delete", { code: "Delete", keyCode: 46 });
};

const closePanel = async () => {
  await b.key("Escape", { code: "Escape", keyCode: 27 });
  await b.waitFor("!document.querySelector('.db-fx')", { timeoutMs: 4000, label: "the panel to close" });
};

/* ---------------------------------------------------------------------------
   1. The read path: a derived column, computed by the server from the row.
   --------------------------------------------------------------------------- */
/* The block fetches its payload after hydration, so the first assertion has to wait for the
   table to exist rather than assume the load event means the database is drawn. */
await b.waitFor("document.querySelectorAll('tr[data-row-id]').length >= 3", { timeoutMs: 20000, label: "the seeded table" });
console.log("§1 the column computes");
const alpha = await cellOf("Alpha", ids.total);
b.check("a formula cell is a button, not a field", alpha.tag === "BUTTON" && alpha.inputs === 0, JSON.stringify({ tag: alpha.tag, inputs: alpha.inputs }));
b.check("it says it opens a dialog", alpha.haspopup === "dialog", String(alpha.haspopup));
b.check("Alpha's arithmetic reads 80", alpha.text === "80", JSON.stringify(alpha.text));
b.check("Alpha's text formula reads its own sentence", (await cellOf("Alpha", ids.label)).text === "Total 80");
b.check("Alpha's checkbox reads No", (await cellOf("Alpha", ids.open)).text === "No");

const beta = await cellOf("Beta", ids.total);
b.check("Beta's arithmetic reads 14", beta.text === "14", JSON.stringify(beta.text));
b.check("Beta's checkbox reads Yes", (await cellOf("Beta", ids.open)).text === "Yes");

const gamma = await cellOf("Gamma", ids.total);
b.check("a row with nothing reads Empty, not 0", gamma.empty && gamma.text === "Empty", JSON.stringify(gamma));

const before = await stored();
b.check("the expression is the seed's", before.expression === 'prop("Price") * 2', JSON.stringify(before.expression));
b.check("nothing is stored for a formula cell", before.rows.Alpha.cells[ids.total] === 80, "the *payload* carries the value; sqlite does not");

/* ---------------------------------------------------------------------------
   2. Opening the editor.
   --------------------------------------------------------------------------- */
console.log("§2 the editor opens on the real expression");
await pressAt(`${CELL("Alpha", ids.total)}?.querySelector('.db-formula-trigger')`, "Alpha's Total cell");
await b.waitFor("!!document.querySelector('.db-fx-input')", { timeoutMs: 6000, label: "the formula panel" });

const opened = await panel();
b.check("the panel is a dialog", opened.role === "dialog", String(opened.role));
b.check("it is titled Edit formula", opened.title === "Edit formula", JSON.stringify(opened.title));
b.check("the field holds the stored expression", opened.value === 'prop("Price") * 2', JSON.stringify(opened.value));
b.check("the painted layer says exactly what the field says", opened.painted === opened.value, JSON.stringify(opened.painted));
b.check("the property reference is painted as a property", opened.spans.includes("db-fx-t-property"), JSON.stringify(opened.spans));
b.check("the numbers are painted as numbers", opened.spans.includes("db-fx-t-number"));
b.check("the operators are painted as operators", opened.spans.includes("db-fx-t-operator"));

b.check("the browser lists the categories in order",
  opened.sections.join("|") === "Properties|Built-ins|General|Text|Number|Date|List",
  opened.sections.join("|"));
b.check("the properties section names the columns", opened.properties.includes("Price") && opened.properties.includes("Due"),
  JSON.stringify(opened.properties));
b.check("the formula itself is not offered as a source", !opened.properties.includes("Total"),
  JSON.stringify(opened.properties));
b.check("the preview evaluates on the first page", opened.output === "80" && opened.type === "Type: number",
  JSON.stringify({ output: opened.output, type: opened.type }));
b.check("the panel fits in the window", opened.rect.left >= 0 && opened.rect.right <= opened.viewport.width + 1,
  JSON.stringify(opened.rect));

/* ---------------------------------------------------------------------------
   3. The suggestion list: filter, choose, insert at the caret.
   --------------------------------------------------------------------------- */
console.log("§3 the list narrows as you type");
await setField("dateB");
const typed = await panel();
b.check("three letters narrow it to one name", typed.entries.length === 1 && typed.entries[0].label === "dateBetween()", JSON.stringify(typed.entries));
b.check("the detail pane documents what is highlighted", typed.signature === "dateBetween(start, end, unit)", String(typed.signature));

await b.key("ArrowDown", { code: "ArrowDown", keyCode: 40 });
await b.key("ArrowUp", { code: "ArrowUp", keyCode: 38 });
await b.key("Enter", { code: "Enter", keyCode: 13 });
const inserted = await panel();
b.check("Enter inserts the name, caret inside the brackets", inserted.value === "dateBetween()", JSON.stringify(inserted.value));
b.check("a half-written call says what it still needs", /takes 3 arguments/.test(inserted.error ?? ""), JSON.stringify(inserted.error));
b.check("and the badge stops claiming a type", /^Type: (error|unknown)$/.test(inserted.type ?? ""), String(inserted.type));

console.log("§4 prop(\" narrows the list to columns");
await setField('prop("Du');
const columns = await panel();
b.check("typing prop( switches the list to properties", columns.entries.length === 1 && columns.entries[0].label === "Due", JSON.stringify(columns.entries));
await b.key("Enter", { code: "Enter", keyCode: 13 });
const referenced = await panel();
b.check("pressing it writes a complete prop() call", referenced.value === 'prop("Due")', JSON.stringify(referenced.value));
b.check("which evaluates to a date", referenced.type === "Type: date", String(referenced.type));

/* ---------------------------------------------------------------------------
   5. The preview follows the expression and the page.
   --------------------------------------------------------------------------- */
console.log("§5 the preview is the same call the cell makes");
await setField('prop("Price") * 2');
const previewed = await panel();
b.check("the arithmetic previews 80 on Alpha", previewed.output === "80", JSON.stringify(previewed.output));

await pressAt("document.querySelector('.db-fx-row-btn')", "the preview page picker");
await b.waitFor("document.querySelectorAll('[data-db-popover] .db-menu-item').length > 1", { timeoutMs: 4000, label: "the page list" });
await pressAt("[...document.querySelectorAll('[data-db-popover] .db-menu-item')].find((n) => n.textContent.trim() === 'Beta')", "the Beta page");
const onBeta = await panel();
b.check("switching the page re-evaluates against that row", onBeta.output === "14", JSON.stringify(onBeta.output));

await pressAt("document.querySelector('.db-fx-row-btn')", "the preview page picker");
await b.waitFor("document.querySelectorAll('[data-db-popover] .db-menu-item').length > 1", { timeoutMs: 4000, label: "the page list" });
await pressAt("[...document.querySelectorAll('[data-db-popover] .db-menu-item')].find((n) => n.textContent.trim() === 'Alpha')", "the Alpha page");

/* ---------------------------------------------------------------------------
   6. Debug mode shows the values the evaluator produced.
   --------------------------------------------------------------------------- */
console.log("§6 debug mode");
await pressAt("document.querySelector('.db-fx-switch')", "the debug switch");
await b.waitFor("document.querySelectorAll('.db-fx-trace-row').length > 0", { timeoutMs: 4000, label: "the trace" });
const debug = await panel();
b.check("every part of the formula is listed", debug.trace.length >= 3, String(debug.trace.length));
b.check("the answer is at the top, because the tree is drawn root first",
  debug.trace[0].value === "80", JSON.stringify(debug.trace.map((entry) => `${entry.code} → ${entry.value}`)));
b.check("and the property reference is in there with its type",
  debug.trace.some((entry) => entry.type === "number" && entry.value === "40"),
  JSON.stringify(debug.trace.map((entry) => `${entry.code} → ${entry.value}`)));
await pressAt("document.querySelector('.db-fx-switch')", "the debug switch");

/* ---------------------------------------------------------------------------
   7. The write: one commit on close, and the column re-reads.
   --------------------------------------------------------------------------- */
console.log("§7 committing is one write, and the table agrees");
await setField('prop("Price") + 5');
await closePanel();
await b.waitFor(`${CELL("Alpha", ids.total)}?.textContent.trim() === '45'`, { timeoutMs: 8000, label: "the cell to re-read after the write" });
const after = await stored();
b.check("the expression reached the database", after.expression === 'prop("Price") + 5', JSON.stringify(after.expression));
b.check("the cell shows the new value", (await cellOf("Alpha", ids.total)).text === "45");
b.check("a second formula reads the first one's new value", (await cellOf("Alpha", ids.label)).text === "Total 45");
b.check("and the untouched rows still compute", (await cellOf("Beta", ids.total)).text === "12", JSON.stringify((await cellOf("Beta", ids.total)).text));
b.check("an empty row is still empty", (await cellOf("Gamma", ids.total)).empty);

/* ---------------------------------------------------------------------------
   8. The header menu opens the same editor.
   --------------------------------------------------------------------------- */
console.log("§8 the column header offers the same editor");
await pressAt(`[...document.querySelectorAll('th')].find((node) => node.textContent.includes('Total'))?.querySelector('.db-th-label')`, "the Total header");
await b.waitFor("[...document.querySelectorAll('.db-menu-item')].some((n) => n.textContent.trim().startsWith('Edit formula'))", { timeoutMs: 4000, label: "the Edit formula row" });
b.check("the menu has an Edit formula row", true);
await pressAt("[...document.querySelectorAll('.db-menu-item')].find((n) => n.textContent.trim().startsWith('Edit formula'))", "Edit formula");
await b.waitFor("!!document.querySelector('.db-fx-input')", { timeoutMs: 6000, label: "the formula panel from the header" });
const fromHeader = await panel();
b.check("it opens with the stored expression", fromHeader.value === 'prop("Price") + 5', JSON.stringify(fromHeader.value));
await closePanel();

/* ---------------------------------------------------------------------------
   9. The write path refuses a stored value, which is what `derived` means.
   --------------------------------------------------------------------------- */
console.log("§9 a formula cell cannot be written");
const rowId = (await stored()).rows.Alpha.id;
const refused = await fetch(`${BASE}/api/databases/${databaseId}/rows/${rowId}`, {
  method: "PATCH",
  headers: { "content-type": "application/json", origin: BASE, "sec-fetch-site": "same-origin" },
  body: JSON.stringify({ cells: { [ids.total]: 999 }, mutationId: crypto.randomUUID() }),
});
b.check("the write is refused", !refused.ok && refused.status >= 400 && refused.status < 500, String(refused.status));

await b.shot(`formula-${width}`);
await b.report();
