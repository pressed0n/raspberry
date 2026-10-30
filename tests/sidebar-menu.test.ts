import { test } from "node:test";
import assert from "node:assert/strict";
import {
  copyTitle,
  descendantIds,
  filterTargets,
  menuItemsFor,
  moveTargets,
  type PageNode,
} from "../src/lib/sidebar-menu";

const page = (id: string, parentId: string | null = null, title = id): PageNode => ({ id, parentId, title });
const ids = (rows: { id: string | null }[]) => rows.map((row) => row.id);

/* a
   ├─ b
   │   └─ c
   └─ d
   e                                                                    */
const tree: PageNode[] = [
  page("a"), page("b", "a"), page("c", "b"), page("d", "a"), page("e"),
];

test("the menu offers the six verbs with favourite wording that flips", () => {
  assert.deepEqual(menuItemsFor({ favorite: false }).map((item) => item.id), ["favorite", "tab", "rename", "duplicate", "move", "trash"]);
  assert.equal(menuItemsFor({ favorite: false })[0].label, "Add to Favorites");
  assert.equal(menuItemsFor({ favorite: true })[0].label, "Remove from Favorites");
  assert.equal(menuItemsFor({ favorite: false }).at(-1)?.danger, true, "trash is the only destructive verb");
});

test("descendants are every page below, never the page itself", () => {
  assert.deepEqual([...descendantIds(tree, "a")].sort(), ["b", "c", "d"]);
  assert.deepEqual([...descendantIds(tree, "b")], ["c"]);
  assert.deepEqual([...descendantIds(tree, "e")], []);
});

test("descendant search terminates on a cycle in existing data", () => {
  const loop = [page("a", "b"), page("b", "a")];
  assert.deepEqual([...descendantIds(loop, "a")], ["b"]);
});

test("destinations exclude the page and its whole subtree", () => {
  assert.deepEqual(ids(moveTargets(tree, "a")), [null, "e"], "moving a hides a and everything under it");
  assert.deepEqual(ids(moveTargets(tree, "c")), [null, "a", "b", "d", "e"], "a leaf only hides itself");
});

test("destinations follow the sidebar's depth-first order with indentation", () => {
  const rows = moveTargets(tree, "e");
  assert.deepEqual(ids(rows), [null, "a", "b", "c", "d"]);
  assert.deepEqual(rows.map((row) => row.depth), [0, 1, 2, 3, 2]);
});

test("the current parent is shown but not offered", () => {
  const rows = moveTargets(tree, "c");
  const parent = rows.find((row) => row.id === "b");
  assert.equal(parent?.current, true);
  assert.equal(parent?.disabled, true);
  const others = rows.filter((row) => row.id !== "b" && row.id !== null);
  assert.ok(others.every((row) => !row.disabled), "nothing else is disabled");
});

test("a root page already sits at the top level, so that row is not offered", () => {
  const top = moveTargets(tree, "e")[0];
  assert.equal(top.id, null);
  assert.equal(top.current, true);
  assert.equal(top.disabled, true);
});

test("filtering a destination keeps the ancestors that give a match its context", () => {
  const rows = filterTargets(moveTargets(tree, "e"), "c");
  assert.deepEqual(ids(rows), [null, "a", "b", "c"]);
  assert.deepEqual(filterTargets(moveTargets(tree, "e"), "  ").length, 5, "a blank query keeps everything");
  assert.deepEqual(ids(filterTargets(moveTargets(tree, "e"), "zzz")), [] as (string | null)[]);
});

test("copy titles replace the suffix instead of stacking it", () => {
  assert.equal(copyTitle("Notes", []), "Notes (copy)");
  assert.equal(copyTitle("Notes", ["Notes (copy)"]), "Notes (copy 2)");
  assert.equal(copyTitle("Notes", ["Notes (copy)", "Notes (copy 2)"]), "Notes (copy 3)");
  assert.equal(copyTitle("Notes (copy)", ["Notes (copy 2)"]), "Notes (copy)");
  assert.equal(copyTitle("Notes (copy 2)", []), "Notes (copy)", "a third generation starts the suffix again");
});

test("copy titles are matched case-insensitively and empty ones get a name", () => {
  assert.equal(copyTitle("Notes", ["notes (COPY)"]), "Notes (copy 2)");
  assert.equal(copyTitle("   ", []), "Untitled (copy)");
  assert.equal(copyTitle("Notes", ["Notes"]), "Notes (copy)", "a page may share a title with its source");
});
