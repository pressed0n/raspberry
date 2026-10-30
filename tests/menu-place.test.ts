import { test } from "node:test";
import assert from "node:assert/strict";
import { GUTTER, atPointer, atRect, placeMenu, type MenuAnchor } from "../src/lib/menu-place";

/* Two anchors, one function. The suites that matter here are the ones the browser
   can only reach by accident: a menu taller than the space above *and* below it, a
   menu wider than the viewport, and the proof that moving the math out of the
   component did not move a single pixel for the `⋯` case. */

const VIEW = { width: 1400, height: 900 };
const SIZE = { width: 220, height: 200 };

/* A ⋯ button at the right edge of a 264px sidebar. */
const more: MenuAnchor = atRect({ x: 236, y: 300, width: 20, height: 20 });

test("end-aligned to a button: right edges meet, not left edges", () => {
  const { left, top } = placeMenu(more, SIZE, VIEW);
  assert.equal(left, 236 + 20 - 220, "the menu's right edge sits on the button's right edge");
  assert.equal(top, 300 + 20 + 6, "6px below the button, not overlapping it");
});

test("end-aligned never hangs off the left edge in a narrow sidebar", () => {
  // A ⋯ only 30px from the left: right-aligned would start at 30 + 20 - 220 = -170.
  const { left } = placeMenu(atRect({ x: 30, y: 300, width: 20, height: 20 }), SIZE, VIEW);
  assert.equal(left, GUTTER, "clamped to the gutter rather than off-screen");
});

test("end-aligned never hangs off the right edge either", () => {
  const { left } = placeMenu(atRect({ x: 1380, y: 100, width: 20, height: 20 }), SIZE, VIEW);
  assert.equal(left, VIEW.width - SIZE.width - GUTTER);
});

test("start-aligned to a pointer: the menu's corner is the click", () => {
  const { left, top } = placeMenu(atPointer(700, 400), SIZE, VIEW);
  assert.equal(left, 700, "left edge exactly on the click");
  assert.equal(top, 400, "top edge exactly on the click — no gap to leave a sliver of target visible");
});

test("a pointer anchor gets no default 6px gap", () => {
  assert.equal(atPointer(700, 400).gap, 0);
  assert.equal(placeMenu(atPointer(700, 400), SIZE, VIEW).top, 400);
  // Whereas a rect anchor deliberately keeps it.
  assert.equal(placeMenu(more, SIZE, VIEW).top, 326);
});

test("a pointer near the bottom flips the menu above the click", () => {
  const { top } = placeMenu(atPointer(700, 860), SIZE, VIEW);
  assert.equal(top, 860 - 200, "menu's bottom edge lands on the click");
  assert.ok(top + SIZE.height <= VIEW.height - GUTTER + 0, "and stays on screen");
});

test("a pointer near the right edge slides left instead of flipping", () => {
  const { left } = placeMenu(atPointer(1390, 400), SIZE, VIEW);
  assert.equal(left, VIEW.width - SIZE.width - GUTTER);
  assert.ok(left <= 1390, "still on the same side of the click — no jump between two adjacent clicks");
});

test("flip is decided by the bottom of the menu, not its top", () => {
  // y = 700 leaves 200px below the pointer and the menu is exactly 201px tall
  // including the gutter, so it must flip even though its top edge fits.
  assert.equal(placeMenu(atPointer(500, 700), { width: 220, height: 200 }, VIEW).top, 700 - 200);
  assert.equal(placeMenu(atPointer(500, 680), { width: 220, height: 200 }, VIEW).top, 680);
});

test("a menu taller than the space above and below is pinned to the top gutter", () => {
  const tall = { width: 220, height: 2000 };
  const { top } = placeMenu(atPointer(500, 100), tall, VIEW);
  assert.equal(top, GUTTER, "clamped to the top gutter rather than pushed to a negative top");
});

test("a menu wider than the viewport honours the left gutter, as the old math did", () => {
  // `max(GUTTER, min(value, rightMost))` — the low bound wins. Writing the clamp
  // the other way round would silently put the menu at a negative left here.
  const wide = { width: 1390, height: 100 };
  assert.equal(placeMenu(atPointer(600, 100), wide, VIEW).left, GUTTER);
});

test("results are whole pixels", () => {
  const { left, top } = placeMenu(atPointer(700.4, 400.6), SIZE, VIEW);
  assert.equal(left, 700);
  assert.equal(top, 401);
});

test("the pre-B37 numbers are unchanged for a real ⋯ rect", () => {
  /* The exact arithmetic the component used to do inline, re-stated here so a
     future 'simplification' of the clamp has to break a test rather than a menu. */
  const anchor = { x: 236, y: 300, width: 20, height: 20 };
  const legacyLeft = Math.max(GUTTER, Math.min(anchor.x + anchor.width - SIZE.width, VIEW.width - SIZE.width - GUTTER));
  const below = anchor.y + anchor.height + 6;
  const legacyTop = below + SIZE.height > VIEW.height - GUTTER ? Math.max(GUTTER, anchor.y - SIZE.height - 6) : below;
  assert.deepEqual(placeMenu(atRect(anchor), SIZE, VIEW), { left: Math.round(legacyLeft), top: Math.round(legacyTop) });
});

test("a rect anchor defaults to end alignment, a pointer anchor to start", () => {
  assert.equal(atRect({ x: 0, y: 0, width: 0, height: 0 }).align, undefined, "end is the default, so it need not be stated");
  assert.equal(placeMenu(atRect({ x: 700, y: 400, width: 0, height: 0 }), SIZE, VIEW).left, 700 - 220);
  assert.equal(atPointer(700, 400).align, "start");
  assert.equal(placeMenu(atPointer(700, 400), SIZE, VIEW).left, 700);
});
