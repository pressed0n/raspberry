// The Files & Media cell: an upload field that holds one or more files.
//
// Usage:
//   BASE=http://127.0.0.1:3110 PAGE=<page id> DB=<database id> FILES=<property id> \
//     node scripts/verify-db-files.mjs [width] [height]
//   …or end to end on a disposable copy:  powershell -File scripts\run-files-probe.ps1
//
// WHY IT UPLOADS FOR REAL
// "Functional" is the whole ask, and every interesting failure of an upload field is invisible
// to a DOM assertion: a spinner that never resolves, a second file that overwrites the first
// because the commit read a stale list, an `<img>` whose src 404s and paints nothing, a remove
// that deletes the blob three other rows are using. So the probe drives the real `<input
// type=file>` through CDP (`DOM.setFileInputFiles` — a real `change` event on a real input), then
// reads the *stored* value back from `/api/databases` and fetches the bytes from `/api/files`.
//
// WHY THE BATCH CONTAINS A FILE THAT MUST FAIL
// The claim is "nothing is lost when one upload fails". A batch of two where one is refused is
// the only arrangement that can tell "commits the successful ones" from "commits nothing" or
// "commits everything including the empty one". The seed's `pitch.pdf` and the probe's own files
// cover the rest: an image, a document, a text file, and an empty file.
//
// WHY THE DROP IS DRIVEN FROM THE PAGE
// A real OS drag cannot be synthesised by DevTools' input domain. What *can* be made is a real
// `DataTransfer` holding a real `File`, dispatched as `dragover` and `drop` at the cell — which
// exercises every line of our own handling (the `types` check, `preventDefault`, the batch) and
// none of the browser's. That is the honest boundary, and it is stated here rather than implied.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openBrowser } from "./browser-session.mjs";

const width = Number(process.argv[2] ?? 1400);
const height = Number(process.argv[3] ?? 900);
const BASE = process.env.BASE ?? "http://127.0.0.1:3110";
const pageId = process.env.PAGE;
const databaseId = process.env.DB;
const filesId = process.env.FILES;
if (!pageId || !databaseId || !filesId) {
  throw new Error("PAGE=<page id> DB=<database id> FILES=<files property id> are required — run scripts/seed-qa-files.mjs first");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------------------------------------------------------------------------
   The two files this probe uploads, and the one that must be refused.
   --------------------------------------------------------------------------- */
const workspace = mkdtempSync(join(tmpdir(), "raspberry-files-"));
const notePath = join(workspace, "note.txt");
const secondPath = join(workspace, "second.txt");
const emptyPath = join(workspace, "empty.txt");
const NOTE = "a note about the garden\n";
const SECOND = "and another one\n";
writeFileSync(notePath, NOTE);
writeFileSync(secondPath, SECOND);
writeFileSync(emptyPath, "");

/* ---------------------------------------------------------------------------
   Reading the app
   --------------------------------------------------------------------------- */
async function stored() {
  const response = await fetch(`${BASE}/api/databases/${databaseId}`, { headers: { origin: BASE } });
  if (!response.ok) throw new Error(`GET /api/databases/${databaseId} → ${response.status}`);
  const payload = await response.json();
  const database = payload.database ?? payload;
  return Object.fromEntries(
    database.rows.map((row) => [row.title, Array.isArray(row.cells?.[filesId]) ? row.cells[filesId] : []]),
  );
}

/** The bytes behind a reference, so "the file is really there" is a measurement. */
async function bytesOf(id) {
  const response = await fetch(`${BASE}/api/files/${encodeURIComponent(id)}`, { headers: { origin: BASE } });
  if (!response.ok) return { status: response.status, length: 0 };
  const body = Buffer.from(await response.arrayBuffer());
  return { status: response.status, length: body.length, text: body.length < 200 ? body.toString("utf8") : "" };
}

const b = await openBrowser({ url: `${BASE}/#${pageId}`, width, height });

const ROW = (title) => `[...document.querySelectorAll('tr[data-row-id]')].find((node) => {
  const name = node.querySelector('.db-name-cell input')?.value
    ?? node.querySelector('.db-name-cell .db-cell-text')?.textContent
    ?? '';
  return name.trim() === ${JSON.stringify(title)};
})`;

const CELL = (title) => `${ROW(title)}?.querySelector('td[data-property-id="${filesId}"]') ?? null`;

/** Everything the *closed* cell says. */
const cellOf = (title) => b.evaluate(`(() => {
  const cell = ${CELL(title)};
  if (!cell) return { missing: "cell" };
  const trigger = cell.querySelector('.db-files-trigger');
  if (!trigger) return { missing: "trigger", html: cell.innerHTML.slice(0, 120) };
  const tile = trigger.querySelector('.db-files-tile');
  return {
    tag: trigger.tagName,
    role: trigger.getAttribute('aria-haspopup'),
    expanded: trigger.getAttribute('aria-expanded'),
    controls: trigger.getAttribute('aria-controls'),
    label: trigger.getAttribute('aria-label'),
    title: trigger.getAttribute('title'),
    first: trigger.querySelector('.db-files-first')?.textContent ?? '',
    more: trigger.querySelector('.db-files-more')?.textContent ?? null,
    empty: !!trigger.querySelector('.db-cell-empty'),
    text: trigger.textContent.trim(),
    /* A cell that could type is the bug this turn removes, so the count is the claim. */
    inputs: cell.querySelectorAll('input').length,
    tile: tile ? {
      tag: tile.tagName,
      src: tile.getAttribute('src'),
      badge: tile.tagName === 'SPAN' ? tile.textContent.trim() : null,
      painted: tile.tagName === 'IMG' ? tile.complete && tile.naturalWidth > 0 : null,
    } : null,
  };
})()`);

/** The open surface, described by what a person could read off it. */
const surface = () => b.evaluate(`(() => {
  const all = [...document.querySelectorAll('[data-db-popover]')];
  const node = all[all.length - 1];
  if (!node) return null;
  const r = node.getBoundingClientRect();
  const round = (value) => Math.round(value * 100) / 100;
  return {
    role: node.getAttribute('role'),
    id: node.id,
    left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom),
    width: Math.round(r.width),
    inside: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
    head: node.querySelector('.db-files-head .db-menu-title')?.textContent?.trim() ?? null,
    /* The small named button, not a glyph well: Upload is a verb. */
    upload: (() => {
      const button = node.querySelector('.db-files-upload');
      return button ? {
        text: button.textContent.trim(),
        className: button.className,
        disabled: button.disabled,
        isMini: button.classList.contains('db-mini-btn'),
      } : null;
    })(),
    rows: [...node.querySelectorAll('.db-files-row:not(.is-pending)')].map((row) => ({
      name: row.querySelector('.db-files-name')?.textContent ?? '',
      href: row.querySelector('.db-files-name')?.getAttribute('href') ?? null,
      target: row.querySelector('.db-files-name')?.getAttribute('target') ?? null,
      size: row.querySelector('.db-files-size')?.textContent ?? '',
      badge: row.querySelector('.db-files-badge')?.textContent?.trim() ?? null,
      thumb: (() => {
        const img = row.querySelector('img.db-files-tile');
        return img ? { src: img.getAttribute('src'), painted: img.complete && img.naturalWidth > 0 } : null;
      })(),
      remove: row.querySelector('.db-files-remove')?.getAttribute('aria-label') ?? null,
      bare: row.querySelector('.db-files-remove')?.classList.contains('db-menu-back') ?? false,
      download: (() => {
        const link = row.querySelector('.db-files-download');
        return link ? {
          href: link.getAttribute('href'),
          label: link.getAttribute('aria-label'),
          title: link.getAttribute('title'),
          target: link.getAttribute('target'),
          bare: link.classList.contains('db-menu-back'),
        } : null;
      })(),
    })),
    pending: [...node.querySelectorAll('.db-files-row.is-pending')].map((row) => row.textContent.trim()),
    note: node.querySelector('.db-files-note')?.textContent?.trim() ?? null,
    alert: node.querySelector('[role=alert]')?.textContent?.trim() ?? null,
    alertCount: node.querySelectorAll('.db-files-error').length,
  };
})()`);

const anySurface = () => b.evaluate("!!document.querySelector('[data-db-popover]')");

/** The hover preview, as it was painted: where it is, what it shows, and what it is not. */
const peekState = () => b.evaluate(`(() => {
  const node = document.querySelector('[data-file-peek]');
  if (!node) return null;
  const r = node.getBoundingClientRect();
  const img = node.querySelector('.db-file-peek-img');
  const panel = [...document.querySelectorAll('[data-db-popover]')].pop();
  const p = panel ? panel.getBoundingClientRect() : null;
  return {
    mime: node.getAttribute('data-file-peek'),
    left: Math.round(r.left), top: Math.round(r.top),
    right: Math.round(r.right), bottom: Math.round(r.bottom),
    width: Math.round(r.width), height: Math.round(r.height),
    inside: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
    /* Outside the dropdown, in the body: a peek inside the panel would be clipped by it. */
    inBody: node.parentElement === document.body,
    pointerEvents: getComputedStyle(node).pointerEvents,
    ariaHidden: node.getAttribute('aria-hidden'),
    name: node.querySelector('.db-file-peek-name')?.textContent ?? null,
    size: node.querySelector('.db-file-peek-size')?.textContent ?? null,
    src: img ? img.getAttribute('src') : null,
    painted: img ? (img.complete && img.naturalWidth > 0) : null,
    gap: p ? Math.round(r.left - p.right) : null,
  };
})()`);

/** Hover a row of the open panel, without pressing anything: `move` is a real `mouseMoved`. */
const rowCentre = (index) => b.evaluate(`(() => {
  const row = document.querySelectorAll('[data-db-popover] .db-files-row')[${index}];
  if (!row) return null;
  const r = row.getBoundingClientRect();
  return { x: Math.round(r.left + Math.min(r.width / 2, 60)), y: Math.round(r.top + r.height / 2) };
})()`);

async function hover(index) {
  const point = await rowCentre(index);
  if (!point) throw new Error(`the open panel has no row ${index} to hover`);
  await b.move(point.x, point.y);
  /* The peek waits 300ms on purpose; the probe waits longer than the feature, not the same. */
  await sleep(520);
}

/** Wait for a *cell* to reach a state. A thumbnail is an `<img>`, and an image is painted
 *  asynchronously — a check that asks once measures the network, not the code. */
async function untilCell(title, predicate, timeoutMs = 8000) {
  const steps = Math.ceil(timeoutMs / 150);
  let last = null;
  for (let i = 0; i < steps; i++) {
    last = await cellOf(title);
    if (last && predicate(last)) return last;
    await sleep(150);
  }
  return last;
}

async function until(predicate, label, timeoutMs = 8000) {
  const steps = Math.ceil(timeoutMs / 150);
  let last = null;
  for (let i = 0; i < steps; i++) {
    last = await surface();
    if (last && predicate(last)) return last;
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${label}; last surface ${JSON.stringify(last)}`);
}

/** The same wait for the thing being *tested*: returns the last state instead of throwing, so a
 *  missing feature is a named failure and not a run that printed nothing. */
async function softUntil(predicate, timeoutMs = 8000) {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs)) {
    throw new Error("softUntil takes milliseconds, not a label — a non-number makes the wait run zero times");
  }
  const steps = Math.ceil(timeoutMs / 150);
  let last = null;
  for (let i = 0; i < steps; i++) {
    last = await surface();
    if (last && predicate(last)) return last;
    await sleep(150);
  }
  if (process.env.DEBUG_SURFACE) console.log("  … unmatched wait, last surface:", JSON.stringify(last));
  return last;
}

/** The cell's button, scrolled into view, with the point a real press should land on. */
const triggerOf = (title) => b.evaluate(`(() => {
  const cell = ${CELL(title)};
  const button = cell?.querySelector('.db-files-trigger');
  if (!button) return { missing: button === null ? "trigger" : "cell" };
  button.scrollIntoView({ block: 'nearest', inline: 'center' });
  const r = button.getBoundingClientRect();
  const x = Math.round(r.left + r.width / 2);
  const y = Math.round(r.top + r.height / 2);
  const hit = document.elementFromPoint(x, y);
  return {
    x, y,
    reachable: !!hit && (hit === button || button.contains(hit)),
    blockedBy: hit ? (hit.className || hit.tagName) : null,
    expanded: button.getAttribute('aria-expanded'),
  };
})()`);

async function pressCell(title) {
  const point = await triggerOf(title);
  if (point.missing) throw new Error(`no files cell for the ${title} row (${point.missing})`);
  if (!point.reachable) throw new Error(`the ${title} cell is at ${point.x},${point.y} but ${point.blockedBy} is on top of it`);
  await b.mouse(point.x, point.y);
  await sleep(160);
  return point;
}

/** Press anything by its own centre inside the open surface. */
const centreOf = (selector, index = 0) => b.evaluate(`(() => {
  const node = document.querySelectorAll('[data-db-popover] ' + ${JSON.stringify(selector)})[${index}];
  if (!node) return null;
  const r = node.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);

async function pressInside(selector, index = 0) {
  const point = await centreOf(selector, index);
  if (!point) throw new Error(`nothing to press for ${selector}[${index}]`);
  await b.mouse(point.x, point.y);
  await sleep(160);
}

/**
 * Put real files into the panel's real `<input type=file>`.
 *
 * `DOM.setFileInputFiles` is the browser's own file chooser: it sets the input's files and fires
 * `input` and `change`, which is the event the panel listens for. Calling the handler with a
 * hand-made `FileList` would test the branch and skip the wiring.
 */
async function choose(paths) {
  const handle = await b.send("Runtime.evaluate", {
    expression: "document.querySelector('[data-db-popover] input[type=file]')",
  });
  const objectId = handle.result?.result?.objectId;
  if (!objectId) throw new Error("the open panel has no file input");
  await b.send("DOM.setFileInputFiles", { files: paths, objectId });
  await sleep(60);
}

/** Wait for a write to land, reading the value the server holds rather than the one on screen. */
async function storedUntil(label, predicate, timeoutMs = 12000) {
  const steps = Math.ceil(timeoutMs / 200);
  let last = null;
  for (let i = 0; i < steps; i++) {
    last = await stored();
    if (predicate(last)) return last;
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${label}; stored ${JSON.stringify(last)}`);
}

const names = (files) => files.map((file) => file.name);

try {
  await b.waitFor("!!document.querySelector('.db-table tbody tr')", { label: "the table", timeoutMs: 25000 });
  const seed = await stored();
  b.check("the seeded rows are on screen", Object.keys(seed).length >= 5, JSON.stringify(Object.keys(seed)));

  /* §1 — The cell is a control, not a text field. The old Files column fell through to
     `db-cell-input`, where typing "holiday.png" stored a reference to bytes nobody uploaded. */
  const both = await cellOf("Both");
  b.check(
    "a Files cell has no text field in it",
    both.inputs === 0,
    `${both.inputs} inputs${both.missing ? ` (missing ${both.missing})` : ""}`,
  );
  b.check(
    "and it is a button that announces the surface it opens",
    both.tag === "BUTTON" && both.role === "dialog" && both.expanded === "false" && typeof both.controls === "string",
    `tag ${both.tag}, haspopup ${JSON.stringify(both.role)}, expanded ${JSON.stringify(both.expanded)}, controls ${JSON.stringify(both.controls)}`,
  );

  /* §2 — What the cell reads: the first file, and how many more there are. */
  b.check(
    "the cell names the first file and counts the rest",
    both.first === "holiday.png" && both.more === "+1",
    `first ${JSON.stringify(both.first)}, more ${JSON.stringify(both.more)}`,
  );
  const bothTile = await untilCell("Both", (cell) => cell.tile?.painted === true);
  b.check(
    "the first file's tile is the picture, and it painted",
    bothTile.tile?.tag === "IMG" && bothTile.tile.src === `/api/files/${seed.Both[0].id}` && bothTile.tile.painted === true,
    JSON.stringify(bothTile.tile),
  );
  const one = await cellOf("One");
  b.check(
    "a cell with one document shows its name and no count",
    one.first === "pitch.pdf" && one.more === null,
    `first ${JSON.stringify(one.first)}, more ${JSON.stringify(one.more)}`,
  );
  b.check(
    "a document has no thumbnail — it has a badge",
    one.tile?.tag === "SPAN" && one.tile.badge === "PDF",
    JSON.stringify(one.tile),
  );
  const nothing = await cellOf("Nothing");
  b.check(
    "an empty cell says so, and does not pretend to be a text box",
    nothing.empty === true && nothing.text === "Empty",
    `empty ${nothing.empty}, text ${JSON.stringify(nothing.text)}`,
  );

  /* §3 — Press it: the surface opens on what is there, and says what can be done.
     Everything from here to §9 needs the control the section above just looked for, so it lives
     in one function: on a tree without it, the run still prints the two failures above and one
     honest "could not continue" instead of dying with no verdicts at all. That is what `-Before`
     is for — a red log that names what is missing. */
  async function behaviour() {
  await pressCell("Both");
  const panel = await until((state) => state.rows.length === 2, "the panel's two rows");
  /* The same wait for the picture inside the list: it is a second `<img>` and it loads on its own
     schedule. Everything else on the panel exists the moment the surface does. */
  const panelPainted = await softUntil((state) => state.rows[0]?.thumb?.painted === true);
  b.check("pressing the cell opens a dialog", panel.role === "dialog" && (await anySurface()), `role ${JSON.stringify(panel.role)}`);
  b.check(
    "the dialog is on screen, whole",
    panel.inside === true && panel.width === 252,
    `inside ${panel.inside}, ${panel.width}px`,
  );
  b.check(
    "it is headed by the count and offers Upload",
    panel.head === "2 files" && panel.upload?.text === "Upload" && panel.upload?.isMini === true,
    `head ${JSON.stringify(panel.head)}, upload ${JSON.stringify(panel.upload)}`,
  );
  b.check(
    "both files are listed with the size the server stores",
    panel.rows[0].name === "holiday.png" && panel.rows[0].size === `${seed.Both[0].size} B`
      && panel.rows[1].name === "pitch.pdf" && panel.rows[1].size === `${seed.Both[1].size} B`,
    JSON.stringify(panel.rows.map((row) => `${row.name} ${row.size}`)),
  );
  b.check(
    "each name is a real link to its own bytes, in a new tab",
    panel.rows[0].href === `/api/files/${seed.Both[0].id}` && panel.rows[0].target === "_blank"
      && panel.rows[1].href === `/api/files/${seed.Both[1].id}`,
    JSON.stringify(panel.rows.map((row) => row.href)),
  );
  b.check(
    "the picture in the list painted, and the document wears its badge",
    panelPainted?.rows[0]?.thumb?.painted === true && panelPainted?.rows[0]?.thumb?.src === `/api/files/${seed.Both[0].id}`
      && panelPainted?.rows[1]?.badge === "PDF",
    `${JSON.stringify(panelPainted?.rows[0]?.thumb)}, badge ${JSON.stringify(panelPainted?.rows[1]?.badge)}`,
  );
  b.check(
    "each row can remove itself, in the bare glyph well every other × uses",
    panel.rows[0].remove === "Remove holiday.png" && panel.rows[0].bare === true,
    `label ${JSON.stringify(panel.rows[0].remove)}, bare ${panel.rows[0].bare}`,
  );
  b.check(
    "nothing is pending before a file is chosen",
    panel.pending.length === 0 && panel.note === null,
    `${JSON.stringify(panel.pending)}`,
  );

  /* §3b — The save button, and the preview that follows a file (B54).

     The preview is the one part of this cell that a DOM assertion can only half-reach: it is
     portalled, positioned by arithmetic, and appears after a rest. So the probe hovers a real
     row with a real `mouseMoved`, waits longer than the feature's own delay, and then reads the
     box's rect, its picture and its computed `pointer-events` out of the painted page. */
  b.check(
    "each row can save its file, in the bare glyph well beside the name",
    panel.rows[0].download?.href === `/api/files/${seed.Both[0].id}?download=1`
      && panel.rows[0].download?.label === "Download holiday.png"
      && panel.rows[0].download?.target === null
      && panel.rows[0].download?.bare === true
      && panel.rows[1].download?.href === `/api/files/${seed.Both[1].id}?download=1`,
    JSON.stringify(panel.rows.map((row) => row.download)),
  );
  /* The claim is about the *response*, not about the attribute: an `<img>` on this route is
     `inline`, and the same bytes asked for as a save must arrive as an `attachment` carrying
     the stored name. Read from the page, so it is the headers the browser actually got. */
  const dispositions = await b.evaluate(`(async () => {
    const row = document.querySelectorAll('[data-db-popover] .db-files-row')[0];
    const view = row.querySelector('.db-files-name').getAttribute('href');
    const save = row.querySelector('.db-files-download').getAttribute('href');
    const [shown, saved] = await Promise.all([fetch(view), fetch(save)]);
    return {
      viewStatus: shown.status, saveStatus: saved.status,
      view: shown.headers.get('content-disposition'),
      save: saved.headers.get('content-disposition'),
      type: saved.headers.get('content-type'),
    };
  })()`);
  b.check(
    "the save is an attachment in the stored name, and the view is still inline",
    dispositions.saveStatus === 200
      && String(dispositions.save).startsWith("attachment")
      && String(dispositions.save).includes("holiday.png")
      && String(dispositions.view).startsWith("inline"),
    JSON.stringify(dispositions),
  );

  await hover(0);
  const peeked = await peekState();
  b.check(
    "hovering an image row shows a preview, outside the panel and in the body",
    peeked !== null && peeked.inBody === true && peeked.mime === "image/png",
    JSON.stringify(peeked),
  );
  b.check(
    "the preview is the picture itself, painted, named and measured",
    peeked?.src === `/api/files/${seed.Both[0].id}` && peeked?.painted === true
      && peeked?.name === "holiday.png" && peeked?.size === `${seed.Both[0].size} B`,
    `${JSON.stringify(peeked?.src)}, painted ${peeked?.painted}, name ${JSON.stringify(peeked?.name)}, size ${JSON.stringify(peeked?.size)}`,
  );
  b.check(
    "it is decoration: hidden from assistive tech, and it cannot take the pointer",
    peeked?.ariaHidden === "true" && peeked?.pointerEvents === "none",
    `aria-hidden ${JSON.stringify(peeked?.ariaHidden)}, pointer-events ${JSON.stringify(peeked?.pointerEvents)}`,
  );
  b.check(
    "it is on screen, whole, and beside the panel rather than over it",
    peeked?.inside === true && (width < 600 || (peeked?.gap ?? -1) >= 0),
    `inside ${peeked?.inside}, ${JSON.stringify(peeked)}`,
  );
  /* A picture, portalled and inside the viewport, is still an assertion about a DOM node. The
     screenshot is what says whether it *looks* like a preview — the last two turns each shipped
     a UI bug that every assertion passed and the picture showed. */
  if (peeked) await b.shot(`files-peek-${width}`);

  /* A PDF has nothing to show. Not a grey box, not a spinner — no box. The pointer moves to the
     document row, and the picture from the row above must go with it. */
  await hover(1);
  const overDocument = await peekState();
  b.check(
    "a document gets no preview at all",
    overDocument === null,
    JSON.stringify(overDocument),
  );
  await b.move(Math.round(width / 2), height - 4);
  await sleep(220);
  b.check(
    "leaving the list takes the preview with it",
    (await peekState()) === null,
    "a preview is still on screen with the pointer off the list",
  );

  /* §4 — The three ways out. A cell that could not be closed again would be worse than no
     surface at all, and the `keep`+toggle pair is exactly where that goes wrong. */
  await pressCell("Both");
  b.check("pressing the cell again closes it", !(await anySurface()), "the surface is still open");
  await pressCell("Both");
  await until((state) => state.rows.length === 2, "the panel again");
  await b.key("Escape", { keyCode: 27 });
  await sleep(200);
  b.check("Escape closes it", !(await anySurface()), "the surface is still open after Escape");
  await pressCell("Both");
  await until((state) => state.rows.length === 2, "the panel once more");
  await b.mouse(Math.round(width / 2), height - 6);
  await sleep(220);
  b.check("a press outside closes it", !(await anySurface()), "the surface is still open after a press outside");

  /* §4b — The same preview from the closed cell's own tile, which is the *other* call site: the
     summary is drawn inside the cell's button and in the read-only table, so a peek that only
     worked from the panel would be half a feature. Hovering the button itself must do nothing —
     it opens the list, and a preview on the way to a press would cover the panel it just opened. */
  const tilePoint = await b.evaluate(`(() => {
    const button = ${CELL("Both")}?.querySelector('.db-files-trigger');
    const tile = button?.querySelector('img.db-files-tile');
    if (!tile) return null;
    button.scrollIntoView({ block: 'nearest', inline: 'center' });
    const r = tile.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!tilePoint) throw new Error("the Both cell has no thumbnail to hover");
  await b.move(tilePoint.x, tilePoint.y);
  await sleep(520);
  const cellPeek = await peekState();
  b.check(
    "hovering the thumbnail in a closed cell previews the file too",
    cellPeek !== null && cellPeek.name === "holiday.png" && cellPeek.inside === true && !(await anySurface()),
    JSON.stringify(cellPeek),
  );
  await b.move(Math.round(width / 2), height - 4);
  await sleep(220);
  b.check("and it goes when the pointer does", (await peekState()) === null, "the cell's preview is still on screen");

  /* §5 — One file, end to end: chosen through the real picker, stored, and served back. */
  await pressCell("Spare");
  const empty = await until((state) => state.head === "No files", "the empty panel");
  b.check(
    "an empty cell explains both ways in",
    empty.note === "Drop files here, or press Upload." && empty.rows.length === 0 && empty.upload?.disabled === false,
    `note ${JSON.stringify(empty.note)}`,
  );
  await choose([notePath]);
  const afterOne = await softUntil((state) => state.rows.length === 1 && state.pending.length === 0, 15000);
  b.check(
    "a chosen file appears in the list, with its size",
    afterOne?.rows.length === 1 && afterOne.rows[0].name === "note.txt" && /^\d+ B$/.test(afterOne.rows[0].size),
    JSON.stringify(afterOne?.rows),
  );
  b.check("and it is not still pending", afterOne?.pending.length === 0, JSON.stringify(afterOne?.pending));
  const storedOne = await storedUntil("the first upload to be written", (rows) => rows.Spare?.length === 1);
  const noteRef = storedOne.Spare[0];
  b.check(
    "the cell stores a reference with the name, type and size the server measured",
    noteRef.name === "note.txt" && noteRef.mime === "text/plain" && noteRef.size === Buffer.byteLength(NOTE),
    JSON.stringify(noteRef),
  );
  b.check(
    "the reference has no `url` of its own — that is derived from the id",
    !("url" in noteRef),
    JSON.stringify(Object.keys(noteRef)),
  );
  const noteBytes = await bytesOf(noteRef.id);
  b.check(
    "the bytes are really on disk and served back",
    noteBytes.status === 200 && noteBytes.length === Buffer.byteLength(NOTE) && noteBytes.text === NOTE,
    `status ${noteBytes.status}, ${noteBytes.length} bytes`,
  );
  b.check("the surface stays open while you work in it", !!(await anySurface()), "the panel closed after an upload");
  const spareCell = await cellOf("Spare");
  b.check(
    "the closed cell now reads the file, without a reload",
    spareCell.first === "note.txt" && spareCell.more === null,
    `first ${JSON.stringify(spareCell.first)}`,
  );

  /* §6 — A batch of two where one is refused. The interesting half is that the other one still
     lands: "nothing is lost when an upload fails" is a claim about the batch, not about the file. */
  await choose([secondPath, emptyPath]);
  const afterBatch = await softUntil((state) => state.rows.length === 2 && state.pending.length === 0, 15000);
  b.check(
    "a batch adds every file that landed",
    afterBatch?.rows.length === 2 && names(afterBatch.rows).join(",") === "note.txt,second.txt",
    JSON.stringify(afterBatch?.rows.map((row) => row.name)),
  );
  b.check(
    "and names the one that did not, in the surface",
    afterBatch?.alertCount === 1 && afterBatch.alert?.includes("empty.txt"),
    `alert ${JSON.stringify(afterBatch?.alert)}`,
  );
  const storedBatch = await storedUntil("the batch to be written", (rows) => rows.Spare?.length === 2);
  b.check(
    "the stored cell holds both files and not the empty one",
    names(storedBatch.Spare).join(",") === "note.txt,second.txt",
    JSON.stringify(names(storedBatch.Spare)),
  );

  /* §7 — Removing a file removes the reference, and only the reference. */
  await pressInside(".db-files-remove", 0);
  const afterRemove = await storedUntil("the removal to be written", (rows) => rows.Spare?.length === 1);
  b.check(
    "removing a row takes that file out of the cell",
    names(afterRemove.Spare).join(",") === "second.txt",
    JSON.stringify(names(afterRemove.Spare)),
  );
  const keptBytes = await bytesOf(noteRef.id);
  b.check(
    "and leaves the bytes alone — another cell may be using them",
    keptBytes.status === 200 && keptBytes.length === Buffer.byteLength(NOTE),
    `status ${keptBytes.status}, ${keptBytes.length} bytes`,
  );
  const afterRemovePanel = await softUntil((state) => state.rows.length === 1, 8000);
  b.check(
    "the list on screen follows the removal",
    afterRemovePanel?.rows[0]?.name === "second.txt" && afterRemovePanel?.head === "1 file",
    `rows ${JSON.stringify(afterRemovePanel?.rows.map((row) => row.name))}, head ${JSON.stringify(afterRemovePanel?.head)}`,
  );

  /* §8 — Dropping on the closed cell. A real `DataTransfer`, a real `File`, our own handlers. */
  await b.key("Escape", { keyCode: 27 });
  await sleep(200);
  const dropped = await b.evaluate(`(() => {
    const cell = ${CELL("Drop")};
    const button = cell?.querySelector('.db-files-trigger');
    if (!button) return { missing: "trigger" };
    const transfer = new DataTransfer();
    transfer.items.add(new File(["dropped by the probe\\n"], "dropped.txt", { type: "text/plain" }));
    const seen = [];
    for (const type of ["dragover", "drop"]) {
      const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer });
      button.dispatchEvent(event);
      seen.push({ type, prevented: event.defaultPrevented });
    }
    return { seen, types: [...transfer.types] };
  })()`);
  b.check(
    "a file dropped on a cell is accepted, not navigated away from",
    dropped?.missing === undefined && dropped.seen.every((entry) => entry.prevented),
    JSON.stringify(dropped)
  );
  const storedDrop = await storedUntil("the dropped file to be written", (rows) => (rows.Drop ?? []).length === 1);
  b.check(
    "a dropped file is uploaded and stored like a chosen one",
    names(storedDrop.Drop).join(",") === "dropped.txt" && storedDrop.Drop[0].mime === "text/plain",
    JSON.stringify(storedDrop.Drop),
  );
  const dropSurface = await until((state) => state.rows.length === 1, "the panel a drop opens");
  b.check(
    "and the surface it opened says what landed",
    dropSurface.head === "1 file" && dropSurface.rows[0].name === "dropped.txt",
    `head ${JSON.stringify(dropSurface.head)}`,
  );
  }

  try {
    await behaviour();
  } catch (error) {
    b.check("the run reached every section of the files panel", false, String(error?.message ?? error));
  }

  /* §9 — The untouched rows really are untouched: a probe that wrote to every cell it looked at
     would pass this whole file while having proved nothing about the seeded ones. */
  const final = await stored();
  b.check(
    "the seeded cells were never rewritten",
    names(final.Both).join(",") === "holiday.png,pitch.pdf" && names(final.One).join(",") === "pitch.pdf",
    JSON.stringify({ Both: names(final.Both), One: names(final.One) }),
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

await b.report();
