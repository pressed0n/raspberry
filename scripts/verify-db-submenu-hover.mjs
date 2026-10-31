// The 6px gap between a menu row and the submenu it flies out to — crossed the way a hand
// crosses it, not the way a script does.
//
// WHY THIS EXISTS
// `MenuSub` closes on the wrapper's `mouseleave`, and the surface sits `GAP` px to the
// right of that wrapper. React's enter/leave tracking walks the React tree, so a pointer
// that jumps from the row straight onto the surface is not a leave — the surface is a
// *React child* of the wrapper even though it is in its own portal. That is true, and it
// is why `scripts/verify-db-number.mjs` passes: its crossing is four synthetic hops, the
// first of which already lands past the gap. A hand does not hop. It moves in small steps,
// one of which falls *in* the gap, where the pointer is over neither the row nor the
// surface — the parent menu's own padding — and the wrapper's `mouseleave` fires there,
// unmounting the surface before the pointer can arrive.
//
// That is the whole reason the bug felt like "70% of the time": it is not random, it is
// cursor speed. Flick across and it survives; move deliberately and it dies. So this probe
// never flicks. It dwells in the gap, and it steps across it one pixel at a time.
//
// READ ONLY. Nothing here presses a menu row: the menu is opened on a column header,
// driven by hover, and dismissed with Escape. No write reaches the database — and note
// that `b.blockedWrites()` is checked at the end anyway, because "it should not write" is
// the kind of claim that is worth a failing test rather than a paragraph.
//
// Usage:
//   BASE=http://127.0.0.1:3000 PAGE=<page id with a database block> node scripts/verify-db-submenu-hover.mjs [width] [height]
// Run it at 1400 and at 390: below ~420px the submenu flips to the *left* of its row, and a
// fix that only bridged the right-hand gap would pass the wide run and fail the phone.

import { openBrowser } from "./browser-session.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const width = Number(process.argv[2] ?? 1400);
const height = Number(process.argv[3] ?? 900);
const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const pageId = process.env.PAGE;
if (!pageId) throw new Error("PAGE=<a page with a database block> is required");

const b = await openBrowser({ url: `${BASE}/#${pageId}`, width, height });

const count = () => b.evaluate("document.querySelectorAll('[data-db-popover]').length");

/** The rect of the last surface — the submenu, when one is open. */
const lastSurface = () => b.evaluate(`(() => {
  const all = document.querySelectorAll('[data-db-popover]');
  const el = all[all.length - 1];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) };
})()`);

/** The rect of the row button carrying `label` — the thing the submenu is anchored to. */
const rowRect = (label) => b.evaluate(`(() => {
  const row = [...document.querySelectorAll('.db-menu-item')].find((n) => n.textContent.trim().startsWith(${JSON.stringify(label)}));
  if (!row) return null;
  const r = row.getBoundingClientRect();
  return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) };
})()`);

/** Where the row and its submenu sit relative to each other, and the gap between them. */
async function gapOf(label) {
  const row = await rowRect(label);
  const sub = await lastSurface();
  if (!row || !sub) throw new Error(`no row/submenu pair for ${label}`);
  /* Which side the surface flew out to. Compared by left edge and not by `sub.right <=
     row.left`: on a phone the flip is clamped to the 8px gutter and the surface then
     *overlaps* its row, so the only stable test is which one starts further left. */
  const flipped = sub.left < row.left;
  return {
    flipped,
    /* Midpoint of the strip that belongs to neither the row nor the surface. Negative
       width means they overlap — at that point there is no gap to fall into, and the
       checks below say so instead of failing on geometry the bug never involved. */
    width: flipped ? row.left - sub.right : sub.left - row.right,
    x: Math.round(flipped ? (sub.right + row.left) / 2 : (row.right + sub.left) / 2),
    y: Math.round((row.top + row.bottom) / 2),
    row,
    sub,
  };
}

/** Hover a row, and wait for the surface it should have opened. */
async function hoverRow(label) {
  const row = await rowRect(label);
  if (!row) throw new Error(`no menu row labelled ${label}`);
  await b.move(Math.round((row.left + row.right) / 2), Math.round((row.top + row.bottom) / 2));
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length >= 2", { label: `submenu for ${label}` });
  return row;
}

/**
 * Open the property menu of the *last* column header — deliberately not the first. The
 * submenu only flips to the left of its row when its anchor sits far enough right, so a
 * first-column menu can never produce a left-hand gap no matter how narrow the window.
 */
async function openPropertyMenu() {
  const at = await b.evaluate(`(() => {
    const labels = document.querySelectorAll('.db-th .db-th-label');
    const button = labels[labels.length - 1];
    if (!button) return null;
    const r = button.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!at) throw new Error("no column header to open a property menu from");
  await b.mouse(at.x, at.y);
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 1", { label: "property menu" });
}

/**
 * A point inside the *real* viewport that is on none of the app's menus.
 *
 * Not `height - 20`: the window size asked for is not the viewport (`1400x900` opens as
 * `1378x802`, because of browser chrome), and a pointer move to a coordinate outside the
 * viewport produces no event at all — Chrome silently drops it. A "the pointer left the
 * menu" step that moves nowhere is the worst kind of check: it fails on correct code and
 * passes on a menu that never closes.
 */
const leavePoint = () => b.evaluate("({ x: Math.round(innerWidth / 2), y: Math.round(innerHeight - 4) })");

async function closeMenu() {
  const away = await leavePoint();
  await b.move(away.x, away.y);
  await b.key("Escape", { keyCode: 27 });
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 0", { timeoutMs: 2000, label: "menu closes" });
}

/**
 * Walk the pointer from the row's edge toward a point inside the submenu, one pixel per
 * step. This is the motion the bug is about: a flick sends a single sample that lands past
 * the gap, a hand sends a sample *in* it.
 */
async function stepAcross(gap, targetX, y) {
  const sign = Math.sign(targetX - gap.x) || (gap.flipped ? -1 : 1);
  const startX = gap.flipped ? gap.row.left - 1 : gap.row.right + 1;
  for (let x = startX; sign > 0 ? x <= targetX : x >= targetX; x += sign) {
    await b.move(x, y);
    await sleep(16);
  }
}

try {
  await b.waitFor("!!document.querySelector('.db-row[data-row-id]')", { timeoutMs: 45000, label: "the table renders" });
  

  /* -------------------------------------------------------------------------
     1. Dwell in the gap. This is the bug.
     ------------------------------------------------------------------------- */
  await openPropertyMenu();
  await hoverRow("Sort");
  let gap = await gapOf("Sort");
  /* Below ~470px the flip is clamped to the gutter and the surface *overlaps* its row, so
     there is no strip to fall into. Report the geometry rather than assert a gap that the
     window cannot have — the checks after it still have to pass. */
  b.check(
    `the submenu opens clear of its row (${gap.flipped ? "left" : "right"} of it)`,
    gap.width >= 2 ? gap.width >= 4 && gap.width <= 10 : true,
    `${gap.width}px gap, flipped=${gap.flipped}`,
  );

  await b.move(gap.x, gap.y);
  await sleep(450);
  let open = await count();
  b.check("a pointer resting in the gap leaves the submenu up", open >= 2, `${open} surfaces after 450ms in the gap`);

  /* -------------------------------------------------------------------------
     2. Cross it a pixel at a time — the way a careful hand does.
     ------------------------------------------------------------------------- */
  const insideX = gap.flipped ? gap.sub.right + 12 : gap.sub.left - 12;
  await stepAcross(gap, insideX, gap.y);
  open = await count();
  b.check("a pointer stepping across the gap reaches the submenu", open >= 2, `${open} surfaces at the far side`);

  /* Now the pointer is 12px inside the submenu. It must still be there a moment later —
     nothing may close a surface the pointer is sitting on. */
  await sleep(450);
  open = await count();
  b.check("the submenu stays up while the pointer is on it", open >= 2, `${open} surfaces`);

  /* -------------------------------------------------------------------------
     3. Coming back the same way: submenu → row keeps the submenu, no flicker.
     ------------------------------------------------------------------------- */
  for (let x = insideX; gap.flipped ? x <= gap.row.left - 1 : x >= gap.row.right + 1; x += gap.flipped ? 1 : -1) {
    await b.move(x, gap.y);
    await sleep(16);
  }
  await sleep(300);
  open = await count();
  b.check("crossing back to the row keeps the submenu up", open >= 2, `${open} surfaces`);

  /* -------------------------------------------------------------------------
     4. Leaving for real still closes it. The fix must not make the submenu stick.
     ------------------------------------------------------------------------- */
  const away = await leavePoint();
  await b.move(away.x, away.y);
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 1", { timeoutMs: 900, label: "submenu closes when the pointer leaves it" });
  b.check("leaving the menu still closes the submenu", (await count()) === 1);

  await closeMenu();

  /* -------------------------------------------------------------------------
     5. The diagonal. A hand aiming at the top of a tall submenu from the row's
     bottom corner spends part of the crossing above both boxes.
     ------------------------------------------------------------------------- */
  await openPropertyMenu();
  await hoverRow("Sort");
  gap = await gapOf("Sort");
  const cornerX = gap.flipped ? gap.row.left - 1 : gap.row.right + 1;
  const cornerY = gap.row.bottom - 2;
  const aimX = gap.flipped ? gap.sub.right + 14 : gap.sub.left - 14;
  const aimY = Math.max(gap.sub.top + 6, cornerY - 10);
  for (let i = 1; i <= 24; i++) {
    await b.move(Math.round(cornerX + (aimX - cornerX) * (i / 24)), Math.round(cornerY + (aimY - cornerY) * (i / 24)));
    await sleep(12);
  }
  await sleep(250);
  open = await count();
  b.check("a diagonal approach to the submenu survives", open >= 2, `${open} surfaces`);

  await closeMenu();

  /* -------------------------------------------------------------------------
     6. Siblings still exchange instantly, and a plain row still just closes it.
     The corridor must not become a way for two submenus to be open at once — the old
     `mouseleave` gave one at a time, and a plain grace-period fix would have shown two
     overlapping surfaces for the length of the delay. Every row ends at the row's right
     edge, so the corridor is the one place outside the menu where a pointer can be, and
     "on a sibling row" is not it.
     ------------------------------------------------------------------------- */
  await openPropertyMenu();
  await hoverRow("Sort");
  const sibling = await rowRect("Change type");
  await b.move(Math.round((sibling.left + sibling.right) / 2), Math.round((sibling.top + sibling.bottom) / 2));
  await sleep(300);
  const surfaces = await count();
  const showing = await b.evaluate(`(() => {
    const all = document.querySelectorAll('[data-db-popover]');
    return (all[all.length - 1]?.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 40);
  })()`);
  b.check(
    "hovering a sibling row leaves exactly one submenu open",
    surfaces === 2 && !/Low → High/.test(showing),
    `${surfaces} surfaces, showing "${showing}"`,
  );

  const plain = await rowRect("Duplicate property");
  await b.move(Math.round((plain.left + plain.right) / 2), Math.round((plain.top + plain.bottom) / 2));
  await sleep(300);
  b.check("hovering a plain row closes the submenu", (await count()) === 1, `${await count()} surfaces`);

  await closeMenu();
} catch (error) {
  console.error(error);
  b.check("the probe ran to completion", false, String(error?.message ?? error));
}

await b.report();
