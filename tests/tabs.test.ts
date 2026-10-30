import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_TABS, activateTab, closeTab, isTabOpen, moveTab, nearestIndex, openTab,
  parseTabs, pruneTabs, restoreTabs, serializeTabs, type TabsState,
} from "../src/lib/tabs";

const ids = (state: TabsState) => state.ids;
const live = (...id: string[]) => new Set(id);

/** The two invariants every operation must preserve, checked in one place. */
function assertWellFormed(state: TabsState) {
  assert.equal(new Set(state.ids).size, state.ids.length, "ids must be unique");
  if (state.active !== null) assert.ok(state.ids.includes(state.active), "active must be an open tab");
  if (state.ids.length === 0) assert.equal(state.active, null, "no tabs means no active tab");
}

test("opening into an empty tab set creates the first tab", () => {
  const next = openTab(EMPTY_TABS, "a");
  assert.deepEqual(ids(next), ["a"]);
  assert.equal(next.active, "a");
  assertWellFormed(next);
});

test("replacing reuses the active tab's slot instead of reshuffling the strip", () => {
  const state = openTab(openTab(openTab(EMPTY_TABS, "a", "append"), "b", "append"), "c", "append");
  const next = openTab(activateTab(state, "b"), "z");
  assert.deepEqual(ids(next), ["a", "z", "c"]);
  assert.equal(next.active, "z");
  assertWellFormed(next);
});

test("appending places the new tab at the end and activates it", () => {
  const state = openTab(openTab(EMPTY_TABS, "a"), "b", "append");
  assert.deepEqual(ids(state), ["a", "b"]);
  assert.equal(state.active, "b");
});

test("opening a page that already has a tab activates it rather than duplicating it", () => {
  const state = openTab(openTab(EMPTY_TABS, "a", "append"), "b", "append");
  for (const mode of ["append", "replace"] as const) {
    const next = openTab(activateTab(state, "b"), "a", mode);
    assert.deepEqual(ids(next), ["a", "b"], `${mode} must not duplicate`);
    assert.equal(next.active, "a");
    assertWellFormed(next);
  }
});

test("replacing never strands the active marker when the active id is missing from ids", () => {
  // A state that only a corrupt storage record could produce.
  const broken: TabsState = { ids: ["a"], active: "gone" };
  const next = openTab(broken, "b");
  assert.deepEqual(ids(next), ["a", "b"]);
  assert.equal(next.active, "b");
  assertWellFormed(next);
});

test("an empty id is refused so a blank tab can never exist", () => {
  assert.equal(openTab(EMPTY_TABS, ""), EMPTY_TABS);
});

test("activating an id that is not open is ignored", () => {
  const state = openTab(openTab(EMPTY_TABS, "a", "append"), "b", "append");
  const next = activateTab(state, "never-opened");
  assert.deepEqual(next, state);
  assertWellFormed(next);
});

test("closing the active middle tab activates its right neighbour", () => {
  const state = { ids: ["a", "b", "c"], active: "b" };
  const { state: next, closed } = closeTab(state, "b");
  assert.equal(closed, true);
  assert.deepEqual(ids(next), ["a", "c"]);
  assert.equal(next.active, "c");
  assertWellFormed(next);
});

test("closing the active last tab falls back to the left neighbour", () => {
  const { state } = closeTab({ ids: ["a", "b"], active: "b" }, "b");
  assert.deepEqual(ids(state), ["a"]);
  assert.equal(state.active, "a");
});

test("closing the only tab leaves no active tab", () => {
  const { state } = closeTab({ ids: ["a"], active: "a" }, "a");
  assert.deepEqual(state, EMPTY_TABS);
  assertWellFormed(state);
});

test("closing a tab before the active one does not move the active marker", () => {
  const { state } = closeTab({ ids: ["a", "b", "c"], active: "c" }, "a");
  assert.deepEqual(ids(state), ["b", "c"]);
  assert.equal(state.active, "c");
});

test("closing a tab that is not open reports no change", () => {
  const state: TabsState = { ids: ["a"], active: "a" };
  const { state: next, closed } = closeTab(state, "zzz");
  assert.equal(closed, false);
  assert.deepEqual(next, state);
});

test("moving a tab forward lands it at the target index", () => {
  const next = moveTab({ ids: ["a", "b", "c", "d"], active: "b" }, 0, 2);
  assert.deepEqual(ids(next), ["b", "c", "a", "d"]);
  assert.equal(next.active, "b", "moving must not change which tab is active");
});

test("moving a tab backward lands it at the target index", () => {
  const next = moveTab({ ids: ["a", "b", "c", "d"], active: "a" }, 3, 1);
  assert.deepEqual(ids(next), ["a", "d", "b", "c"]);
});

test("a move to its own slot, or out of range, is refused without reordering", () => {
  const state: TabsState = { ids: ["a", "b", "c"], active: "a" };
  assert.deepEqual(moveTab(state, 1, 1), state);
  assert.deepEqual(moveTab(state, -1, 2), state);
  assert.deepEqual(moveTab(state, 3, 0), state);
});

test("a move past the end clamps rather than producing a hole", () => {
  const next = moveTab({ ids: ["a", "b", "c"], active: "a" }, 0, 99);
  assert.deepEqual(ids(next), ["b", "c", "a"]);
  assertWellFormed(next);
});

test("pruning drops dead pages, keeps order, and moves the active marker to a survivor", () => {
  const state: TabsState = { ids: ["a", "b", "c", "d"], active: "c" };
  const next = pruneTabs(state, live("a", "d"));
  assert.deepEqual(ids(next), ["a", "d"]);
  assert.equal(next.active, "a", "an active id that vanished falls back to the first survivor");
  assertWellFormed(next);
});

test("pruning keeps the active marker when it survives", () => {
  const next = pruneTabs({ ids: ["a", "b", "c"], active: "b" }, live("b", "c"));
  assert.deepEqual(ids(next), ["b", "c"]);
  assert.equal(next.active, "b");
});

test("pruning everything yields the empty state, not a dangling active id", () => {
  const next = pruneTabs({ ids: ["a", "b"], active: "b" }, live());
  assert.deepEqual(next, EMPTY_TABS);
});

test("pruning with nothing to drop returns the same state", () => {
  const state: TabsState = { ids: ["a", "b"], active: "a" };
  assert.equal(pruneTabs(state, live("a", "b", "extra")), state);
});

test("unreadable storage degrades to no tabs instead of throwing", () => {
  assert.deepEqual(parseTabs(null), EMPTY_TABS);
  assert.deepEqual(parseTabs(""), EMPTY_TABS);
  assert.deepEqual(parseTabs("{not json"), EMPTY_TABS);
  assert.deepEqual(parseTabs('"a string"'), EMPTY_TABS);
  assert.deepEqual(parseTabs('{"ids":"a"}'), EMPTY_TABS);
  assert.deepEqual(parseTabs('{"ids":[]}'), EMPTY_TABS);
  assert.deepEqual(parseTabs("null"), EMPTY_TABS);
});

test("stored tabs are sanitised: duplicates collapsed, junk dropped, active resolved", () => {
  const next = parseTabs('{"ids":["a","a","","b",7,null],"active":"missing"}');
  assert.deepEqual(ids(next), ["a", "b"]);
  assert.equal(next.active, "a", "a dangling active id resolves to the first tab");
  assertWellFormed(next);
});

test("a legacy bare array is still readable", () => {
  assert.deepEqual(parseTabs('["a","b"]'), { ids: ["a", "b"], active: "a" });
});

test("stored tabs round-trip through serialisation", () => {
  const state: TabsState = { ids: ["a", "b", "c"], active: "b" };
  assert.deepEqual(parseTabs(serializeTabs(state)), state);
});

test("restoring honours a deep link to a page that is not already open", () => {
  const stored: TabsState = { ids: ["a", "b"], active: "a" };
  const next = restoreTabs(stored, live("a", "b", "d"), "d");
  assert.deepEqual(ids(next), ["d", "b"], "the deep link takes the active slot");
  assert.equal(next.active, "d");
  assertWellFormed(next);
});

test("restoring an already-open deep link just activates it", () => {
  const next = restoreTabs({ ids: ["a", "b"], active: "a" }, live("a", "b"), "b");
  assert.deepEqual(ids(next), ["a", "b"]);
  assert.equal(next.active, "b");
});

test("restoring ignores a deep link to a page that no longer exists", () => {
  const next = restoreTabs({ ids: ["a", "b"], active: "b" }, live("a", "b"), "deleted");
  assert.deepEqual(next, { ids: ["a", "b"], active: "b" });
});

test("restoring with no stored tabs opens the deep link as the only tab", () => {
  const next = restoreTabs(EMPTY_TABS, live("a"), "a");
  assert.deepEqual(next, { ids: ["a"], active: "a" });
});

test("restoring with neither stored tabs nor a deep link stays empty", () => {
  assert.deepEqual(restoreTabs(EMPTY_TABS, live("a"), null), EMPTY_TABS);
});

test("nearest centre picks the tab the pointer is closest to", () => {
  const centers = [50, 150, 250];
  assert.equal(nearestIndex(centers, 10), 0);
  assert.equal(nearestIndex(centers, 140), 1);
  assert.equal(nearestIndex(centers, 400), 2);
  assert.equal(nearestIndex([], 100), 0, "an empty strip must not return -1");
});

test("isTabOpen reports membership", () => {
  const state: TabsState = { ids: ["a", "b"], active: "a" };
  assert.equal(isTabOpen(state, "b"), true);
  assert.equal(isTabOpen(state, "c"), false);
});

test("random sequences of operations never break the invariants", () => {
  // Deterministic LCG so a failure is reproducible.
  let seed = 20261028;
  const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const pool = ["a", "b", "c", "d", "e"];
  let state: TabsState = EMPTY_TABS;

  for (let step = 0; step < 2000; step += 1) {
    switch (Math.floor(random() * 5)) {
      case 0: state = openTab(state, pick(pool), random() < 0.5 ? "append" : "replace"); break;
      case 1: state = closeTab(state, pick(pool)).state; break;
      case 2: state = activateTab(state, pick(pool)); break;
      case 3: state = moveTab(state, Math.floor(random() * 5), Math.floor(random() * 5)); break;
      default: state = pruneTabs(state, new Set(pool.filter(() => random() < 0.7))); break;
    }
    assertWellFormed(state);
    assert.ok(state.ids.length <= pool.length, "no operation may invent a tab");
  }
});
