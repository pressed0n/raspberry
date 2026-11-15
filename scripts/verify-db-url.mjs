// The URL cell: short by default, whole on disk, and opened from a mark you can see.
//
// Usage:
//   BASE=http://127.0.0.1:3107 PAGE=<page id> DB=<database id> LINK=<property id> \
//     node scripts/verify-db-url.mjs [width] [height]
//   …or end to end on a disposable copy:  powershell -File scripts\run-url-probe.ps1
//
// WHY IT WRITES
// The feature is a *formatter* and a *property setting*, and both claims are about what the
// server holds afterwards. A cell that only painted a shortened copy of the value, or a
// "Show full URL" that flipped a checkbox in React and nothing else, would pass every
// DOM-only assertion here. So each is checked twice: the pixels, and `/api/databases` read
// back. Nothing is seeded but this run's own database, and the runner deletes it with the
// copy (docs/TESTING.md).
//
// WHAT IT REFUSES TO ASSUME
// A probe written after a fix proves it runs. The three claims that could be faked —
// "the link is clickable", "the text is not", "the setting is the column's" — are each
// checked against the running app and against `/api/databases`, and the opener's press is
// observed as a *new page target* at the browser's debugging port, not as a class name.
import { openBrowser } from "./browser-session.mjs";

const width = Number(process.argv[2] ?? 1400);
const height = Number(process.argv[3] ?? 900);
const BASE = process.env.BASE ?? "http://127.0.0.1:3107";
const pageId = process.env.PAGE;
const databaseId = process.env.DB;
const linkId = process.env.LINK;
if (!pageId || !databaseId || !linkId) {
  throw new Error("PAGE=<page id> DB=<database id> LINK=<url property id> are required — run scripts/seed-qa-url.mjs first");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* The property and the cells as the server holds them. The only source a storage claim trusts. */
async function stored() {
  const response = await fetch(`${BASE}/api/databases/${databaseId}`, { headers: { origin: BASE } });
  if (!response.ok) throw new Error(`GET /api/databases/${databaseId} → ${response.status}`);
  const payload = await response.json();
  const database = payload.database ?? payload;
  const property = database.properties.find((candidate) => candidate.id === linkId);
  if (!property) throw new Error(`property ${linkId} is not in the payload`);
  const rows = Object.fromEntries(database.rows.map((row) => [row.title, row.cells?.[linkId] ?? null]));
  return { config: property.config ?? {}, rows };
}

const b = await openBrowser({ url: `${BASE}/#${pageId}`, width, height });

/** A row, found the way a person reads it — by the name in its title cell. The name is an
 *  `<input value="…">`, so `textContent` cannot find it. */
const ROW = (title) => `[...document.querySelectorAll('tr[data-row-id]')].find((node) => {
  const name = node.querySelector('.db-name-cell input')?.value
    ?? node.querySelector('.db-name-cell .db-cell-text')?.textContent
    ?? '';
  return name.trim() === ${JSON.stringify(title)};
})`;

const CELL = (title) => `${ROW(title)}?.querySelector('td[data-property-id="${linkId}"]') ?? null`;

/** What the cell *draws* — the field's own value, which is what a person reads. */
const cellText = (title) => b.evaluate(`(() => {
  const cell = ${CELL(title)};
  const field = cell?.querySelector('input');
  return field ? field.value : (cell ? cell.textContent.trim() : null);
})()`);

async function clickAt(at, what) {
  if (!at) throw new Error(`nothing to click for ${what}`);
  if (!at.reachable) throw new Error(`${what} is at ${at.x},${at.y} but something else is on top of it`);
  await b.mouse(at.x, at.y);
  await sleep(160);
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

const menuRow = (label) => b.evaluate(`(() => {
  const all = [...document.querySelectorAll('[data-db-popover]')];
  const surface = all[all.length - 1];
  if (!surface) return null;
  const item = [...surface.querySelectorAll('.db-menu-item')]
    .find((node) => (node.querySelector('.db-menu-label') ?? node).textContent.trim() === ${JSON.stringify(label)});
  if (!item) return null;
  return {
    ticked: !!item.querySelector('.db-menu-check'),
    title: item.getAttribute('title') ?? '',
    count: [...surface.querySelectorAll('.db-menu-item')]
      .filter((node) => (node.querySelector('.db-menu-label') ?? node).textContent.trim() === ${JSON.stringify(label)}).length,
  };
})()`);

/** The opener of one row, and everything about it that can be measured rather than trusted. */
const openerOf = (title) => b.evaluate(`(() => {
  const cell = ${CELL(title)};
  if (!cell) return { missing: "cell" };
  const mark = cell.querySelector('.db-url-open');
  const field = cell.querySelector('input');
  if (!mark) return { missing: "opener", field: !!field, hasValue: !!field && field.value !== "" };
  mark.scrollIntoView({ block: "nearest", inline: "nearest" });
  const r = mark.getBoundingClientRect();
  /* Measured *after* the scroll, not before: on a phone the table scrolls sideways, and a
     box captured before the scroll describes where the cell used to be. */
  const cellBox = cell.getBoundingClientRect();
  const style = getComputedStyle(mark);
  const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
  return {
    href: mark.getAttribute("href"),
    title: mark.getAttribute("title"),
    target: mark.getAttribute("target"),
    rel: mark.getAttribute("rel"),
    label: mark.getAttribute("aria-label"),
    opacity: style.opacity,
    pointerEvents: style.pointerEvents,
    width: Math.round(r.width),
    height: Math.round(r.height),
    /* Centre line of the mark against centre line of the cell — the row's Open button and
       this one are the same kind of thing and have to sit the same way. */
    offsetY: Math.round((r.top + r.height / 2) - (cellBox.top + cellBox.height / 2)),
    insideRight: Math.round(cellBox.right - r.right),
    takesClicks: !!hit && (hit === mark || mark.contains(hit)),
    x: Math.round(r.left + r.width / 2),
    y: Math.round(r.top + r.height / 2),
  };
})()`);

/** A press inside a link cell, aimed at the *field* — and it says so when it is not: an
 *  element that has scrolled under a header, or a column that has scrolled off a phone,
 *  is how three probes in this repo once "tested" a click that never landed. */
const fieldPoint = (title) => b.evaluate(`(() => {
  const cell = ${CELL(title)};
  const field = cell?.querySelector('input');
  if (!field) return null;
  cell.scrollIntoView({ block: "center", inline: "nearest" });
  const r = field.getBoundingClientRect();
  const x = Math.round(r.left + Math.min(30, r.width / 2)), y = Math.round(r.top + r.height / 2);
  const hit = document.elementFromPoint(x, y);
  return { x, y, reachable: !!hit && (hit === field || field.contains(hit)), under: hit ? (hit.tagName ?? "") + "." + (hit.className ?? "") : "nothing" };
})()`);

/** Does a control cover what it is drawn over? "Opaque" is a claim about the composited frame,
 *  and the only way to check it is to put something behind the control and compare the pixels
 *  inside it with and without.
 *
 *  The thing behind is a saturated patch in the control's own box rather than the real text,
 *  because text has antialiased edges and a fill test against a moving edge is a coin toss.
 *  The patch is the stronger question: not "does this particular glyph show through" but "does
 *  anything show through", and the field's words are not more opaque than red.
 *
 *  `node` names the control, which must be absolutely positioned inside a positioned parent
 *  (both openers are). Returns the worst channel difference over three interior points, kept
 *  clear of the 1px border and of the centred glyph. */
async function occlusion(node, label) {
  const box = await b.evaluate(`(() => {
    const mark = ${node};
    if (!mark) return null;
    const parent = mark.offsetParent;
    if (!parent) return null;
    mark.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = mark.getBoundingClientRect();
    const p = parent.getBoundingClientRect();
    return {
      points: [
        { x: Math.round(r.left + 3.5), y: Math.round(r.top + r.height / 2) },
        { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 3.5) },
        { x: Math.round(r.right - 4.5), y: Math.round(r.top + r.height / 2) },
      ],
      centre: { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) },
      offset: { left: r.left - p.left, top: r.top - p.top },
      size: { width: r.width, height: r.height },
      radius: getComputedStyle(mark).borderTopLeftRadius,
    };
  })()`);
  if (!box) return { missing: label };

  /* The pointer goes on the control, because the pointer being on it is the state at issue. */
  await b.move(box.centre.x, box.centre.y);
  await sleep(250);
  const clear = [];
  for (const point of box.points) clear.push(await b.pixel(point.x, point.y));

  await b.evaluate(`(() => {
    const mark = ${node};
    const patch = document.createElement('div');
    patch.id = '__probe_behind';
    Object.assign(patch.style, {
      position: 'absolute',
      left: ${box.offset.left} + 'px',
      top: ${box.offset.top} + 'px',
      width: ${box.size.width} + 'px',
      height: ${box.size.height} + 'px',
      borderRadius: ${JSON.stringify(box.radius)},
      background: 'rgb(255, 0, 0)',
      /* Above the field's words, below the control (which declares z-index: 1). */
      zIndex: '0',
      pointerEvents: 'none',
    });
    mark.offsetParent.appendChild(patch);
    return true;
  })()`);
  await sleep(150);
  const behind = [];
  for (const point of box.points) behind.push(await b.pixel(point.x, point.y));

  const worst = clear.reduce((max, pixel, index) => Math.max(
    max,
    Math.abs(pixel.r - behind[index].r),
    Math.abs(pixel.g - behind[index].g),
    Math.abs(pixel.b - behind[index].b),
  ), 0);
  return {
    worst,
    size: `${Math.round(box.size.width)}x${Math.round(box.size.height)}`,
    detail: clear.map((p, i) => `${p.r},${p.g},${p.b}→${behind[i].r},${behind[i].g},${behind[i].b}`).join(" · "),
  };
}

/** Every page target the browser is willing to talk about — the only honest way to see that
 *  a press opened *another* page rather than this one. */
async function targets() {
  try {
    const list = await (await fetch(`http://127.0.0.1:${b.port}/json/list`)).json();
    return list.filter((entry) => entry.type === "page");
  } catch {
    return [];
  }
}

const here = () => b.evaluate("location.href");

try {
  await b.waitFor("!!document.querySelector('.db-table tbody tr')", { label: "the table" });
  const seed = await stored();

  /* ---------------------------------------------------------------------------------
     1. What the cell draws, and what the column keeps
     --------------------------------------------------------------------------------- */
  b.check(
    "a link reads without the scheme and the www",
    (await cellText("Site")) === "example.com/docs",
    `cell reads ${JSON.stringify(await cellText("Site"))}`,
  );
  b.check(
    "the address on disk keeps both",
    seed.rows.Site === "https://www.example.com/docs",
    `stored ${JSON.stringify(seed.rows.Site)}`,
  );
  b.check(
    "a link typed without a scheme is stored as a real address and read bare",
    seed.rows.Local === `${BASE}/api/health` && (await cellText("Local")) === `${new URL(BASE).host}/api/health`,
    `stored ${JSON.stringify(seed.rows.Local)}, cell ${JSON.stringify(await cellText("Local"))}`,
  );
  b.check("a new URL column starts showing links short", seed.config.fullUrl === false, `config ${JSON.stringify(seed.config)}`);

  /* The shortening exists to stop the address clipping, so the claim is a measurement of the
     ink, not of the string: a canvas set in the field's own computed font, against the room
     the field has left after its padding. A check that reads "the cell is not scrolled" would
     pass whatever the value was — `scrollWidth` equals `clientWidth` on an `<input>`. */
  const fits = await b.evaluate(`(() => {
    const field = (${CELL("Site")})?.querySelector('input');
    if (!field) return null;
    const style = getComputedStyle(field);
    const canvas = document.createElement('canvas').getContext('2d');
    canvas.font = style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
    return {
      text: Math.ceil(canvas.measureText(field.value).width),
      room: Math.floor(field.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)),
      value: field.value,
    };
  })()`);
  b.check(
    "the short form fits the column it is in",
    !!fits && fits.text < fits.room,
    fits ? `${fits.text}px of ink in ${fits.room}px of field, reading ${JSON.stringify(fits.value)}` : "no field",
  );

  /* ---------------------------------------------------------------------------------
     2. The opener: invisible at rest, a real link, and on the cell's centre line
     --------------------------------------------------------------------------------- */
  const rest = await openerOf("Site");
  b.check(
    "a cell with a link has an opener, and the empty one does not",
    !rest.missing && (await openerOf("Empty")).missing === "opener",
    `Site ${JSON.stringify(rest.missing ?? "present")}, Empty ${JSON.stringify((await openerOf("Empty")).missing ?? "present")}`,
  );
  b.check(
    "the opener is invisible at rest and takes no clicks",
    rest.opacity === "0" && rest.pointerEvents === "none" && !rest.takesClicks,
    `opacity ${rest.opacity}, pointer-events ${rest.pointerEvents}, hit test ${rest.takesClicks}`,
  );
  b.check(
    "it points at the address, not at what the cell shows",
    rest.href === "https://www.example.com/docs" && rest.title === rest.href,
    `href ${JSON.stringify(rest.href)}, title ${JSON.stringify(rest.title)}`,
  );
  b.check(
    "it opens elsewhere, and tells the new page nothing about this one",
    rest.target === "_blank" && /noopener/.test(rest.rel ?? "") && /noreferrer/.test(rest.rel ?? ""),
    `target ${JSON.stringify(rest.target)}, rel ${JSON.stringify(rest.rel)}`,
  );
  b.check(
    "it sits on the cell's centre line, its own inset from the cell's right edge",
    rest.offsetY === 0 && rest.insideRight >= 3 && rest.insideRight <= 6 && rest.width >= 20,
    `offset ${rest.offsetY}px, ${rest.insideRight}px from the cell's right edge, ${rest.width}x${rest.height}`,
  );
  b.check("it names itself for anyone who cannot see it", /open link/i.test(rest.label ?? ""), `aria-label ${JSON.stringify(rest.label)}`);

  /* Hovering the row is what reveals it — the same rule the row's `Open` button follows. */
  const words = await fieldPoint("Site");
  b.check(
    "the probe's press lands on the field, not on whatever is in front of it",
    !!words && words.reachable,
    words ? `${words.x},${words.y} is ${words.under}` : "no field to press",
  );
  await b.move(words.x, words.y);
  await sleep(300);
  const hovered = await openerOf("Site");
  b.check(
    "hovering the row reveals it, and then it takes the click",
    hovered.opacity === "1" && hovered.pointerEvents === "auto" && hovered.takesClicks,
    `opacity ${hovered.opacity}, pointer-events ${hovered.pointerEvents}, hit test ${hovered.takesClicks}`,
  );
  /* Looked at, not just measured: a mark that is technically visible and visually invisible
     passes every number above. */
  await b.shot(`url-mark-${width}`);

  /* ---------------------------------------------------------------------------------
     2b. The mark covers what it is drawn over
     ---------------------------------------------------------------------------------
     The report, verbatim: "the button to open the link is covering the link which is good
     but on hover i can see the text behind it when it overlays it".

     The fill was `background: var(--surface)` and the hover state was
     `background: var(--hover-strong)` — and `--hover-strong` is 7% white, which is a *wash*.
     The `background` shorthand does not add a second coat of paint, it replaces the first,
     so reaching for the mark was precisely the moment its opaque fill became transparent and
     the address underneath read through the box that was supposed to be covering it.

     Measured as paint, not as style, because computed style is what hid this: it would have
     reported `rgba(255,255,255,0.07)` and every assertion about the mark would have passed.
     A saturated patch is drawn behind each opener, in its own box, and the pixels inside are
     sampled with the patch and without it. Same colour twice is the whole claim: whatever is
     behind the mark, the mark looks the same. */
  const markOpacity = await occlusion(`(${CELL("Site")})?.querySelector('.db-url-open')`, "the mark");
  b.check(
    "nothing behind the mark reads through it, even with the pointer on it",
    markOpacity.worst !== undefined && markOpacity.worst <= 2,
    markOpacity.missing
      ? "no mark to measure"
      : `${markOpacity.size}, worst channel difference ${markOpacity.worst}/255: ${markOpacity.detail}`,
  );
  /* Looked at with the patch still behind it: a number that says "opaque" and a screenshot
     that shows red through the box would mean the number was measuring the wrong pixel. */
  await b.shot(`url-mark-opaque-${width}`);
  await b.evaluate("document.getElementById('__probe_behind')?.remove()");
  await sleep(100);

  /* The row's `Open` chip is the same control over the same kind of thing — the name it sits
     on. It had the same bug, so it gets the same measurement rather than a note saying the
     two are alike. */
  const openOpacity = await occlusion(`(${ROW("Site")})?.querySelector('.db-open')`, "the row's Open");
  b.check(
    "and neither does the row's Open chip, which covers the end of the name",
    openOpacity.worst !== undefined && openOpacity.worst <= 2,
    openOpacity.missing
      ? "no Open chip to measure"
      : `${openOpacity.size}, worst channel difference ${openOpacity.worst}/255: ${openOpacity.detail}`,
  );
  await b.evaluate("document.getElementById('__probe_behind')?.remove()");
  await sleep(100);

  /* ---------------------------------------------------------------------------------
     3. The words do not navigate; the mark does
     --------------------------------------------------------------------------------- */
  const before = await here();
  /* A double press, because that is the gesture that used to throw the owner out of the
     table: two presses in a text cell select a word, and nothing else may happen. */
  await b.doubleMouse(words.x, words.y);
  await sleep(400);
  b.check(
    "pressing the words of a link cell does not leave the page",
    (await here()) === before && (await b.evaluate("!!document.querySelector('.db-table')")),
    `location ${await here()}`,
  );
  b.check(
    "and it puts the caret in the field, where the words are",
    await b.evaluate(`document.activeElement === (${CELL("Site")})?.querySelector('input')`),
    await b.evaluate("document.activeElement?.tagName ?? 'body'"),
  );

  /* The press that opens goes through the real pointer, and the observation is a *new page
     target* at the browser's port — a class name cannot fake that. */
  const local = await b.evaluate(`(() => {
    const cell = ${CELL("Local")};
    const mark = cell?.querySelector('.db-url-open');
    if (!mark) return null;
    mark.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = mark.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  await b.move(local.x, local.y);
  await sleep(250);
  const openers = await targets();
  const pageBefore = await here();
  await b.mouse(local.x, local.y);
  let opened = null;
  for (let i = 0; i < 25; i++) {
    await sleep(200);
    const now = await targets();
    opened = now.find((entry) => entry.url.includes("/api/health") && !openers.some((was) => was.id === entry.id));
    if (opened) break;
  }
  b.check(
    "pressing the mark opens the address in another page",
    !!opened,
    opened ? `new target ${opened.url}` : `targets: ${(await targets()).map((entry) => entry.url).join(" | ")}`,
  );
  b.check(
    "and this page is exactly where it was",
    (await here()) === pageBefore && (await b.evaluate("!!document.querySelector('.db-table')")),
    `location ${await here()}`,
  );
  b.check(
    "the caret was not thrown away on the way to the link",
    await b.evaluate(`document.activeElement === (${CELL("Site")})?.querySelector('input')`),
    await b.evaluate("document.activeElement?.tagName ?? 'body'"),
  );
  /* The tab it opened is not this probe's subject; close it so the next claim is not
     measuring two pages at once. */
  if (opened?.id) {
    try { await fetch(`http://127.0.0.1:${b.port}/json/close/${opened.id}`); } catch {}
    await sleep(300);
  }

  /* ---------------------------------------------------------------------------------
     4. Typing a link commits an address and shows a short one
     --------------------------------------------------------------------------------- */
  await b.mouse(words.x, words.y);
  await sleep(200);
  await b.evaluate("document.activeElement?.select?.()");
  await b.type("newsite.test");
  await b.key("Enter", { keyCode: 13 });
  await sleep(700);
  const typed = await stored();
  b.check(
    "a typed link is stored with a scheme",
    typed.rows.Site === "https://newsite.test/",
    `stored ${JSON.stringify(typed.rows.Site)}`,
  );
  b.check(
    "and the cell shows it without one",
    (await cellText("Site")) === "newsite.test",
    `cell ${JSON.stringify(await cellText("Site"))}`,
  );
  b.check(
    "the opener now points at the new address",
    (await openerOf("Site")).href === "https://newsite.test/",
    `href ${JSON.stringify((await openerOf("Site")).href)}`,
  );

  /* ---------------------------------------------------------------------------------
     5. The dropdown: one row, off by default, and it writes the *column*
     --------------------------------------------------------------------------------- */
  await clickAt(await b.evaluate(`(() => {
    const label = [...document.querySelectorAll('.db-th-label')]
      .find((node) => node.querySelector('.db-th-text')?.textContent.trim() === "Link");
    if (!label) return null;
    label.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = label.getBoundingClientRect();
    const x = Math.round(r.left + Math.min(40, r.width / 2)), y = Math.round(r.top + r.height / 2);
    const hit = document.elementFromPoint(x, y);
    return { x, y, reachable: !!hit && (hit === label || label.contains(hit)) };
  })()`), "the Link column's header");
  await b.waitFor("!!document.querySelector('.db-prop-menu')", { label: "the property menu" });

  const off = await menuRow("Show full URL");
  b.check(
    "the dropdown offers it, once",
    !!off && off.count === 1,
    off ? `${off.count} row(s)` : "no row named 'Show full URL'",
  );
  b.check(
    "it is off, because the column is showing links short",
    !!off && off.ticked === false,
    `ticked ${off?.ticked}`,
  );
  b.check(
    "and the row says what off means",
    !!off && /https/.test(off.title) && /www/.test(off.title),
    `title ${JSON.stringify(off?.title)}`,
  );

  const cellsBefore = (await stored()).rows;
  await clickMenu("Show full URL");
  let on = { config: {}, rows: {} };
  for (let i = 0; i < 20; i++) {
    await sleep(200);
    on = await stored();
    if (on.config.fullUrl === true) break;
  }
  b.check(
    "pressing it writes the column's config, not a cell",
    on.config.fullUrl === true && JSON.stringify(on.rows) === JSON.stringify(cellsBefore),
    `config ${JSON.stringify(on.config)}, cells changed: ${JSON.stringify(on.rows) !== JSON.stringify(cellsBefore)}`,
  );
  /* The tick moved in the surface; the cells are one re-render behind it, and this check used
     to read the cell in a *separate* evaluation from the one it printed — so it could assert
     against the short form and then caption the full one, which is a failure that reads as a
     pass and is neither. One value, read until it settles, and reported once. */
  let full = "";
  for (let i = 0; i < 15; i++) {
    full = await cellText("Site");
    if (full === "https://newsite.test/") break;
    await sleep(100);
  }
  b.check(
    "the cell reads the full address immediately",
    full === "https://newsite.test/",
    `cell ${JSON.stringify(full)}`,
  );
  b.check(
    "the tick moved in the same surface, which stayed open",
    (await menuRow("Show full URL"))?.ticked === true,
    `ticked ${(await menuRow("Show full URL"))?.ticked}`,
  );

  await clickMenu("Show full URL");
  for (let i = 0; i < 20; i++) {
    await sleep(200);
    if ((await stored()).config.fullUrl === false) break;
  }
  b.check(
    "and pressing it again puts the links back to short",
    (await stored()).config.fullUrl === false && (await cellText("Site")) === "newsite.test",
    `config ${JSON.stringify((await stored()).config)}, cell ${JSON.stringify(await cellText("Site"))}`,
  );

  await b.shot(`url-menu-${width}`);
} catch (error) {
  /* A probe that catches its own exception and then reports the score prints OK for a run
     that died at step one. Recorded as a failure, by name (docs/TESTING.md). */
  b.check("the probe itself ran to the end without throwing", false, String(error?.stack ?? error));
} finally {
  await b.report();
}
