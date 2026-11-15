import { test } from "node:test";
import assert from "node:assert/strict";
import { PEEK_GAP, PEEK_GUTTER, placePeek } from "../src/lib/peek-place";

/* Where the hover preview of a file goes.

   This is the half of the feature a browser can only prove by accident. The edges of the
   viewport — a row under the bottom of the screen, a panel against the right wall, a viewport
   narrower than the box itself — are exactly the cases a person reaches by scrolling to the
   last attachment in a long list, and exactly the cases a probe would have to be lucky to
   visit. So the arithmetic is a module and the module is tested here. */

const SIZE = { width: 268, height: 224 };
const VIEW = { width: 1400, height: 900 };
const row = (x: number, y: number, width = 252, height = 28) => ({ x, y, width, height });

test("a peek sits to the right of its row, centred on it", () => {
  const at = placePeek(row(300, 400), SIZE, VIEW);
  assert.equal(at.left, 300 + 252 + PEEK_GAP, "the left edge is the row's right edge plus the gap");
  assert.equal(at.top, 400 + 14 - 112, "vertically centred: half the row, minus half the box");
});

test("no room on the right, so it flips left rather than covering the row", () => {
  /* A row against the right wall of a 1400px screen: 1200 + 252 + 10 + 268 leaves the screen,
     and a peek that slid sideways over the row would hide the name it is meant to illustrate. */
  const at = placePeek(row(1200, 400), SIZE, VIEW);
  assert.equal(at.left, 1200 - PEEK_GAP - SIZE.width);
  assert.ok(at.left + SIZE.width <= 1200, "the peek must not overlap the row it describes");
});

test("a peek whose right edge lands exactly on the gutter stays on the right", () => {
  /* The boundary is inclusive. Flipping here would put the box over the row for the sake of one
     pixel, and a person scrolling the list would see it jump from one side to the other with
     no visible cause. */
  const x = VIEW.width - PEEK_GUTTER - SIZE.width - PEEK_GAP - 252;
  const at = placePeek(row(x, 400), SIZE, VIEW);
  assert.equal(at.left, x + 252 + PEEK_GAP);
});

test("a viewport too narrow for either side keeps the peek on screen", () => {
  /* A 300px phone. Neither side fits, so the third branch goes over the row, flush right —
     overlapping is not good, but it is the only answer that keeps the picture where it can be
     seen. Hover is not a phone gesture, so this is a guard, not a design. */
  const at = placePeek(row(0, 400), SIZE, { width: 300, height: 900 });
  assert.equal(at.left, 300 - SIZE.width - PEEK_GUTTER);
  assert.ok(at.left >= PEEK_GUTTER && at.left + SIZE.width <= 300, "and it is still inside");
});

test("vertically it is clamped, never centred off the screen", () => {
  const top = placePeek(row(300, 0), SIZE, VIEW);
  assert.equal(top.top, PEEK_GUTTER, "the first row of a list");

  const bottom = placePeek(row(300, VIEW.height - 28), SIZE, VIEW);
  assert.equal(bottom.top, VIEW.height - SIZE.height - PEEK_GUTTER, "the last row of a list");
});

test("whole pixels, so the box's own border is not blurred by its position", () => {
  const at = placePeek({ x: 10.5, y: 400.4, width: 252.3, height: 28.7 }, { width: 268.4, height: 224 }, VIEW);
  assert.ok(Number.isInteger(at.left) && Number.isInteger(at.top), JSON.stringify(at));
});
