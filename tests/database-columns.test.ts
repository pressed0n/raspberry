import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultViewConfig,
  primaryPropertyId,
  titleProperty,
  titlePropertyWith,
  type PropertyDef,
  type RowDef,
  type ViewConfig,
} from "../src/lib/database/types";
import { propertyById, nextSorts, selectRows, titlePropertyOf, visibleProperties } from "../src/lib/database/rows";

/**
 * The primary property's name and icon.
 *
 * The primary property is `pages.title`, not a row in `database_properties`, so the
 * two things a person can change about it — what it is called and what it looks like —
 * live on the database row instead. These assertions exist because the failure they
 * prevent is silent: rename the first column to "Task", and every read that still
 * reaches for the constant `titleProperty` renders "Name" while the menu insists the
 * rename worked.
 */

const row = (id: string, title: string): RowDef => ({
  id, title, icon: "", cells: {}, createdAt: "2026-10-30T00:00:00.000Z", updatedAt: "2026-10-30T00:00:00.000Z", position: 0,
});
const view = (patch: Partial<ViewConfig> = {}): ViewConfig => ({ ...defaultViewConfig, ...patch });
const renamed = (meta: { name?: string; icon?: string }): PropertyDef => titlePropertyWith(meta);

test("a database that has never been renamed still calls its first column Name", () => {
  assert.equal(titlePropertyWith(undefined).name, "Name");
  assert.equal(titlePropertyWith(null).name, "Name");
  assert.equal(titlePropertyOf({}).name, "Name");
});

test("renaming the primary property changes only its name", () => {
  const property = renamed({ name: "Task" });
  assert.equal(property.name, "Task");
  assert.equal(property.id, primaryPropertyId, "the reserved id must survive a rename");
  assert.equal(property.type, "text", "the primary property is always text");
  assert.deepEqual(property.config, {});
  assert.equal(property.position, -1);
});

test("an icon without a name does not invent a name", () => {
  const property = renamed({ icon: "flag" });
  assert.equal(property.icon, "flag");
  assert.equal(property.name, "Name");
});

test("the shared title property constant is never mutated by a rename", () => {
  renamed({ name: "Contract", icon: "briefcase" });
  assert.equal(titleProperty.name, "Name", "titleProperty is shared by every database");
  assert.equal(titleProperty.icon, undefined);
});

test("propertyById resolves the reserved id through the database's own title property", () => {
  const database = { properties: [], titleProperty: renamed({ name: "Contact", icon: "user" }) };
  const property = propertyById(database, primaryPropertyId);
  assert.equal(property.name, "Contact");
  assert.equal(property.icon, "user");
});

test("propertyById falls back to Name when the database has no title property", () => {
  assert.equal(propertyById({ properties: [] }, primaryPropertyId).name, "Name");
});

test("the renamed primary property is still the first visible column and cannot be hidden", () => {
  const database = {
    properties: [{ id: "p1", name: "Due", type: "date" as const, config: {}, position: 0 }],
    titleProperty: renamed({ name: "Task" }),
  };
  assert.deepEqual(visibleProperties(database, view()).map((property) => property.name), ["Task", "Due"]);
  /* `visibleProperties` is a list of what to *show*, so explicitly listing only the
     other column must not drop the name column: a table of unnamed rows is unusable. */
  assert.deepEqual(visibleProperties(database, view({ visibleProperties: ["p1"] })).map((property) => property.name), ["Task", "Due"]);
});

test("sorting by the primary property sorts by the row's title, under its new name", () => {
  const database = {
    properties: [],
    titleProperty: renamed({ name: "Task" }),
    rows: [row("b", "Beta"), row("a", "Alpha")],
  };
  const ascending = selectRows(database as never, view({ sorts: [{ propertyId: primaryPropertyId, direction: "ascending" }] }));
  assert.deepEqual(ascending.rows.map((item) => item.title), ["Alpha", "Beta"]);
  const descending = selectRows(database as never, view({ sorts: [{ propertyId: primaryPropertyId, direction: "descending" }] }));
  assert.deepEqual(descending.rows.map((item) => item.title), ["Beta", "Alpha"]);
});

test("a database that predates renaming still sorts by its title column", () => {
  const database = { properties: [], rows: [row("b", "Beta"), row("a", "Alpha")] };
  const ascending = selectRows(database as never, view({ sorts: [{ propertyId: primaryPropertyId, direction: "ascending" }] }));
  assert.deepEqual(ascending.rows.map((item) => item.title), ["Alpha", "Beta"]);
});

test("a sort pointing at a property that no longer exists is ignored, not thrown", () => {
  const database = { properties: [], rows: [row("a", "Alpha"), row("b", "Beta")] };
  const set = selectRows(database as never, view({ sorts: [{ propertyId: "deleted-property", direction: "descending" }] }));
  assert.equal(set.rows.length, 2);
});

/* ---------------------------------------------------------------------------
   Empty cells and sort direction
   ---------------------------------------------------------------------------
   Every `compare` in the registry ends with `compareNullable` and says the same thing:
   empties go last. Reversing a comparator to sort descending reverses that promise too,
   so `Z → A` used to float every blank row to the top of the table — the one place a
   person is least likely to look and most likely to drag the table into.

   The rows below are deliberately *unnamed* so nothing about them is alphabetical, and
   the property is a real number column so the emptiness is a real `null` rather than a
   missing title. */

const scoreProperty: PropertyDef = { id: "score", name: "Score", position: 0, type: "number", config: {} };
const scored = (id: string, title: string, score: number | null): RowDef => ({
  ...row(id, title),
  cells: score === null ? {} : { [scoreProperty.id]: score },
});
const byScore = (propertyId: string, direction: "ascending" | "descending") =>
  view({ sorts: [{ propertyId, direction }] });

test("a descending sort keeps empty cells last, because that is what the comparator promised", () => {
  const database = { properties: [scoreProperty], rows: [scored("a", "one", null), scored("b", "two", 5), scored("c", "three", 9)] };
  assert.deepEqual(selectRows(database as never, byScore("score", "ascending")).rows.map((item) => item.title), ["two", "three", "one"]);
  assert.deepEqual(selectRows(database as never, byScore("score", "descending")).rows.map((item) => item.title), ["three", "two", "one"]);
});

test("a descending sort on the title column keeps an untitled row last too", () => {
  /* The title column is text, so its emptiness is the empty string rather than a null —
     the reason the sort asks `isEmpty` instead of testing for null. */
  const database = { properties: [], rows: [row("a", ""), row("b", "Beta"), row("c", "Alpha")] };
  assert.deepEqual(selectRows(database as never, byScore(primaryPropertyId, "descending")).rows.map((item) => item.title), ["Beta", "Alpha", ""]);
});

test("a second sort key only decides rows the first key ties on", () => {
  const group: PropertyDef = { id: "group", name: "Group", position: 1, type: "text", config: {} };
  const database = {
    properties: [scoreProperty, group],
    rows: [
      { ...row("a", "one"), cells: { score: 1, group: "b" } },
      { ...row("b", "two"), cells: { score: 1, group: "a" } },
      { ...row("c", "three"), cells: { score: 2, group: "c" } },
    ],
  };
  const set = selectRows(database as never, view({ sorts: [{ propertyId: "score", direction: "descending" }, { propertyId: "group", direction: "ascending" }] }));
  assert.deepEqual(set.rows.map((item) => item.title), ["three", "two", "one"]);
});

/* The menu's half of multi-sort. It used to write `sorts: [oneKey]`, so a second column
   silently replaced the first and the table could never have two keys — which made the
   pipeline's list look like dead capability. */

test("sorting a second column adds a key instead of replacing the first", () => {
  const after = nextSorts([{ propertyId: "score", direction: "descending" }], "group", "ascending");
  assert.deepEqual(after, [
    { propertyId: "score", direction: "descending" },
    { propertyId: "group", direction: "ascending" },
  ]);
});

test("re-sorting a column replaces its key where it was, keeping its precedence", () => {
  const first = nextSorts([], "score", "ascending");
  const second = nextSorts(first, "group", "ascending");
  const flipped = nextSorts(second, "score", "descending");
  assert.deepEqual(flipped, [
    { propertyId: "score", direction: "descending" },
    { propertyId: "group", direction: "ascending" },
  ]);
});

test("clearing one column's sort leaves the others alone", () => {
  const both = nextSorts(nextSorts([], "score", "descending"), "group", "ascending");
  assert.deepEqual(nextSorts(both, "score", null), [{ propertyId: "group", direction: "ascending" }]);
  assert.deepEqual(nextSorts(both, "absent", null), both);
});


