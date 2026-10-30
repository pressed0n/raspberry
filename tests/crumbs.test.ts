import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COLLAPSE_AT,
  CRUMB_MAX_CHARS,
  MAX_DEPTH,
  collapseTrail,
  crumbLabel,
  crumbTrail,
  type Crumb,
  type CrumbSource,
} from "../src/lib/crumbs";

const page = (id: string, parentId: string | null, title = id): CrumbSource => ({ id, parentId, title });
const crumb = (id: string): Crumb => ({ id, title: id, label: id, current: false });
const ids = (crumbs: readonly Crumb[]) => crumbs.map((item) => item.id);

test("a root page shows itself as its own trail, marked current", () => {
  assert.deepEqual(crumbTrail([page("a", null)], "a"), [
    { id: "a", title: "a", label: "a", current: true },
  ]);
});

test("one level of nesting shows the parent, then the page you are on", () => {
  assert.deepEqual(crumbTrail([page("a", null), page("b", "a")], "b"), [
    { id: "a", title: "a", label: "a", current: false },
    { id: "b", title: "b", label: "b", current: true },
  ]);
});

test("the trail reads root first and ends with the current page", () => {
  const pages = [page("root", null), page("mid", "root"), page("leaf", "mid")];
  const trail = crumbTrail(pages, "leaf");
  assert.deepEqual(ids(trail), ["root", "mid", "leaf"]);
  assert.equal(trail.at(-1)?.current, true, "the last crumb is the current page");
  assert.equal(trail.filter((item) => item.current).length, 1, "exactly one current crumb");
});

test("the trail keeps its order regardless of the order pages arrive in", () => {
  const pages = [page("leaf", "mid"), page("mid", "root"), page("root", null)];
  assert.deepEqual(ids(crumbTrail(pages, "leaf")), ["root", "mid", "leaf"]);
});

test("an ancestor that is not loaded ends the trail instead of leaving a gap", () => {
  // "mid" is in the trash, so it is absent from the list; "root" is unreachable.
  assert.deepEqual(ids(crumbTrail([page("root", null), page("leaf", "mid")], "leaf")), ["leaf"]);
});

test("an unknown current page has no trail", () => {
  assert.deepEqual(crumbTrail([page("a", null)], "missing"), []);
  assert.deepEqual(crumbTrail([page("a", null)], null), []);
});

test("a cycle in parent ids stops at the first repeat", () => {
  const pages = [page("a", "b"), page("b", "a"), page("c", "a")];
  const trail = crumbTrail(pages, "c");
  assert.ok(trail.length <= 3, `trail must stay finite, got ${trail.length}`);
  assert.equal(new Set(ids(trail)).size, trail.length, "no repeats");
});

test("a page that is its own parent does not hang", () => {
  assert.deepEqual(ids(crumbTrail([page("a", "a")], "a")), ["a"]);
});

test("depth is capped even when the chain is longer, and still ends on the page", () => {
  const pages: CrumbSource[] = [page("p0", null)];
  for (let index = 1; index <= MAX_DEPTH + 4; index += 1) pages.push(page(`p${index}`, `p${index - 1}`));
  const deepest = `p${MAX_DEPTH + 4}`;
  const trail = crumbTrail(pages, deepest);
  assert.equal(trail.length, MAX_DEPTH + 1, "the cap applies to ancestors; the page is still shown");
  assert.equal(trail.at(-1)?.id, deepest);
});

test("a blank title is labelled Untitled rather than rendering an empty target", () => {
  const trail = crumbTrail([page("a", null, "   "), page("b", "a", "")], "b");
  assert.deepEqual(trail.map((item) => item.label), ["Untitled", "Untitled"]);
});

/* ---- truncation ---------------------------------------------------------- */

test("the limit is 25 characters", () => {
  assert.equal(CRUMB_MAX_CHARS, 25);
});

test("a title at the limit is not truncated", () => {
  const exact = "a".repeat(CRUMB_MAX_CHARS);
  assert.equal(crumbLabel(exact), exact);
});

test("one character past the limit truncates, so the crumb changes at 26", () => {
  const label = crumbLabel("a".repeat(CRUMB_MAX_CHARS + 1));
  assert.equal(label, `${"a".repeat(CRUMB_MAX_CHARS)}…`);
});

test("truncation counts what you can see, not UTF-16 units", () => {
  // 25 emoji are 50 code units; a naive slice would cut one in half.
  const label = crumbLabel("🌱".repeat(CRUMB_MAX_CHARS + 5));
  assert.equal([...label].length, CRUMB_MAX_CHARS + 1, "25 glyphs plus the ellipsis");
  assert.ok(!label.includes("\uFFFD"), "no replacement character from a split surrogate pair");
});

test("a trimmed title does not keep the space it was cut at", () => {
  assert.equal(crumbLabel(`${"a".repeat(30)} `), `${"a".repeat(CRUMB_MAX_CHARS)}…`);
});

test("the full title survives for the tooltip even when the label is cut", () => {
  const long = "A page title that is definitely longer than twenty-five characters";
  const [only] = crumbTrail([page("a", null, long)], "a");
  assert.equal(only.title, long);
  assert.equal(only.label, `${long.slice(0, CRUMB_MAX_CHARS)}…`);
});

/* ---- collapsing ---------------------------------------------------------- */

const trailOf = (ids: string[]): Crumb[] =>
  ids.map((id, index) => ({ ...crumb(id), current: index === ids.length - 1 }));

test("a short trail is passed through untouched", () => {
  const trail = trailOf(["a", "b"]);
  const { head, hidden, tail } = collapseTrail(trail);
  assert.deepEqual([...head, ...hidden, ...tail], trail);
  assert.equal(hidden.length, 0);
  assert.equal(tail.at(-1)?.current, true);
});

test("a long trail keeps the top, the immediate parent and the current page", () => {
  const trail = trailOf(["a", "b", "c", "d", "e", "f"]);
  const { head, hidden, tail } = collapseTrail(trail, COLLAPSE_AT);
  assert.deepEqual(ids(head), ["a"]);
  assert.deepEqual(ids(hidden), ["b", "c"]);
  assert.deepEqual(ids(tail), ["d", "e", "f"]);
  assert.equal(tail.at(-1)?.current, true, "the current page is still last");
});

test("a trail that fits its budget is never collapsed", () => {
  /* Four ancestors is exactly the budget, so nothing folds — the current page
     sits on top of a complete trail rather than forcing one into the menu. */
  const trail = trailOf(["a", "b", "c", "d", "e"]);
  const { head, hidden, tail } = collapseTrail(trail, COLLAPSE_AT);
  assert.deepEqual(ids(head), ["a", "b", "c", "d"]);
  assert.deepEqual(hidden, []);
  assert.deepEqual(ids(tail), ["e"]);
});

test("the current page does not consume an ancestor slot", () => {
  /* Five ancestors: three survive at the default budget, and the page is a
     fourth slot on top. If the budget counted the current crumb this would
     drop to two ancestors. */
  const trail = trailOf(["a", "b", "c", "d", "e", "f"]);
  const { head, hidden, tail } = collapseTrail(trail, COLLAPSE_AT);
  assert.equal(head.length + tail.length - 1, 3, "three ancestor slots");
  assert.equal(hidden.length, 2);
  assert.equal(tail.at(-1)?.current, true);
});

test("collapsing loses no crumb", () => {
  const trail = trailOf(["a", "b", "c", "d", "e", "f"]);
  const { head, hidden, tail } = collapseTrail(trail);
  assert.deepEqual(ids([...head, ...hidden, ...tail]), ids(trail));
});

test("a collapse budget too small to be useful degrades to showing everything", () => {
  const trail = trailOf(["a", "b", "c", "d"]);
  const { hidden } = collapseTrail(trail, 2);
  assert.equal(hidden.length, 0);
});
