import { test } from "node:test";
import assert from "node:assert/strict";
import { blockEnd, dropTarget, isNoop, keyboardMove, resolveDrop, subtreeIds, type DragPage, type DragRow } from "../src/lib/sidebar-drag";

/* A tree drawn as it appears on screen: root order a, b, c, with a expanded to a1 → a1x.
   `stack` gives the rows viewport-like coordinates (the browser's units) so a pointer
   position in a test means the same thing it means in the probe. */
const pages: DragPage[] = [
  { id: "a", parentId: null }, { id: "a1", parentId: "a" }, { id: "a1x", parentId: "a1" },
  { id: "b", parentId: null }, { id: "c", parentId: null },
];
function stack(spec: Array<{ id: string; parentId: string | null; depth: number; height?: number }>): DragRow[] {
  let top = 100;
  return spec.map((row) => {
    const height = row.height ?? 28, next = { ...row, height, top };
    top += height;
    return next;
  });
}
const visible = stack([
  { id: "a", parentId: null, depth: 0 }, { id: "a1", parentId: "a", depth: 1 },
  { id: "b", parentId: null, depth: 0 }, { id: "c", parentId: null, depth: 0 },
]);
const none: ReadonlySet<string> = new Set();

test("the middle of a row means: nest inside it", () => {
  assert.deepEqual(dropTarget(visible, visible[2].top + 14, none), { kind: "inside", id: "b" });
});

test("the top edge of a row means: become its previous sibling", () => {
  assert.deepEqual(dropTarget(visible, visible[2].top + 2, none), { kind: "before", id: "b" });
});

test("the bottom edge means: become its next sibling", () => {
  assert.deepEqual(dropTarget(visible, visible[3].top + 26, none), { kind: "after", id: "c" });
});

test("beyond the first row clamps to the top, beyond the last clamps to the bottom", () => {
  assert.deepEqual(dropTarget(visible, 10, none), { kind: "before", id: "a" });
  assert.deepEqual(dropTarget(visible, 5000, none), { kind: "after", id: "c" });
});

test("the gap under an expanded page is its first child, not a sibling slot", () => {
  /* a is expanded, so the pixels just under a's row belong to a1. Dropping there has to
     mean "first child of a" — a line drawn between a parent and its own child would point
     at a slot that does not exist. */
  const target = dropTarget(visible, visible[0].top + 26, none);
  assert.deepEqual(target, { kind: "before", id: "a1" });
  assert.deepEqual(resolveDrop(pages, target, "c"), { parentId: "a", index: 0 });
});

test("a blocked row between two live rows is a dead zone: no target", () => {
  /* Dragging `a1` while hovering over `a1` itself: the row is excluded, and the pixels it
     occupies belong to no live row, so nothing is offered. Drawing a line there would
     point at the page already in hand. */
  const blocked = subtreeIds(pages, "a1");
  assert.equal(dropTarget(visible, visible[1].top + 14, blocked), null);
  assert.equal(resolveDrop(pages, { kind: "inside", id: "a1x" }, "a1"), null);
});

test("dragging a page over its own subtree never produces a real move", () => {
  const blocked = subtreeIds(pages, "a");
  /* Above the first live row there is no dead zone — the pointer clamps to the topmost
     legal gap. Resolving it must be a no-op, or lifting the mouse over your own subtree
     would reorder the tree. */
  const target = dropTarget(visible, visible[0].top + 2, blocked);
  assert.deepEqual(target, { kind: "before", id: "b" });
  const site = resolveDrop(pages, target, "a");
  assert.equal(isNoop(pages, "a", site), true);
});

test("subtree membership is transitive", () => {
  assert.deepEqual([...subtreeIds(pages, "a")].sort(), ["a", "a1", "a1x"]);
  assert.deepEqual([...subtreeIds(pages, "a1")].sort(), ["a1", "a1x"]);
  assert.deepEqual([...subtreeIds(pages, "b")], ["b"]);
});

test("dropping inside a page appends as its last child", () => {
  assert.deepEqual(resolveDrop(pages, { kind: "inside", id: "a" }, "b"), { parentId: "a", index: 1 });
});

test("a gap resolves to a sibling slot in the anchor's parent", () => {
  assert.deepEqual(resolveDrop(pages, { kind: "before", id: "b" }, "c"), { parentId: null, index: 1 });
  assert.deepEqual(resolveDrop(pages, { kind: "after", id: "b" }, "c"), { parentId: null, index: 2 });
  assert.deepEqual(resolveDrop(pages, { kind: "before", id: "c" }, "a"), { parentId: null, index: 1 });
});

test("a gap whose anchor is the dragged page itself is not a drop", () => {
  assert.equal(resolveDrop(pages, { kind: "before", id: "a" }, "a"), null);
});

test("a move that would not change the order is recognised as a no-op", () => {
  /* The index is measured against the list *without* the dragged page, because that is the
     list the server splices into after removing it. Landing back in your own slot is the
     only same-parent drop that changes nothing; `from + 1` is a real one-slot move down.
     Sending either would otherwise bump a revision for nothing — and a needless revision
     bump is how an open editor loses its next save. */
  assert.equal(isNoop(pages, "a", { parentId: null, index: 0 }), true);
  assert.equal(isNoop(pages, "a", { parentId: null, index: 1 }), false);
  assert.equal(isNoop(pages, "a", { parentId: null, index: 2 }), false);
  assert.equal(isNoop(pages, "b", { parentId: null, index: 1 }), true);
  assert.equal(isNoop(pages, "a", { parentId: "b", index: 0 }), false);
  assert.equal(isNoop(pages, "a", null), true);
});

test("the block end of an expanded page is its last visible descendant", () => {
  assert.equal(blockEnd(visible, "a")?.id, "a1");
  assert.equal(blockEnd(visible, "b")?.id, "b");
  /* `a1x` is not expanded into this fixture; its block is its own row. */
  assert.equal(blockEnd(visible, "c")?.id, "c");
});

test("keyboard reorder steps one slot and stops at the ends", () => {
  assert.deepEqual(keyboardMove(pages, "a", "down"), { parentId: null, index: 1 });
  assert.deepEqual(keyboardMove(pages, "b", "up"), { parentId: null, index: 0 });
  assert.equal(keyboardMove(pages, "a", "up"), null);
  assert.equal(keyboardMove(pages, "c", "down"), null);
  /* Moving within a nested parent stays in that parent. */
  assert.equal(keyboardMove(pages, "a1", "up"), null);
});
