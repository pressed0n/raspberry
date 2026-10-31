import { test } from "node:test";
import assert from "node:assert/strict";
import { nextSorts, sortRows } from "../src/lib/database/rows";
import { formatCell, resolveProperty, sortLabels } from "../src/lib/database/properties";
import { sortSchema, type RowDef, type ViewConfig } from "../src/lib/database/types";

/* The `manual` sort direction, and the lie it was added to pay off.
   ---------------------------------------------------------------------------
   For Select, Multi-select and Status, `compare` used to answer with the property's
   arranged order *and* the menu called it "A → Z". Only one of those could be true. The
   arranged order is now a direction of its own, so both are asked for by name — and the
   tests below exist because the two are indistinguishable on the day they agree: a
   fixture whose options happen to be alphabetical passes with either wiring in place.
   Every fixture here is deliberately *not* alphabetical, in both directions.
   --------------------------------------------------------------------------- */

const tags: Record<string, unknown> = {
  options: [
    { id: "o1", name: "Zebra", color: "yellow", groupId: null },
    { id: "o2", name: "Apple", color: "red", groupId: null },
    { id: "o3", name: "Mango", color: "orange", groupId: null },
  ],
};

/* Groups top to bottom, and the statuses inside each group. "Done" is last by group but
   first by name, so a status column tells the two orders apart in one comparison. */
const workflow: Record<string, unknown> = {
  groups: [
    { id: "g1", name: "To do", color: "gray" },
    { id: "g2", name: "In progress", color: "blue" },
    { id: "g3", name: "Complete", color: "green" },
  ],
  options: [
    { id: "s1", name: "Not started", color: "gray", groupId: "g1" },
    { id: "s2", name: "Doing", color: "blue", groupId: "g2" },
    { id: "s3", name: "Done", color: "green", groupId: "g3" },
  ],
};

const database = {
  properties: [
    { id: "p1", name: "Tags", type: "select" as const, config: tags, position: 0 },
    { id: "p2", name: "Labels", type: "multiSelect" as const, config: tags, position: 1 },
    { id: "p3", name: "Status", type: "status" as const, config: workflow, position: 2 },
  ],
};

function row(id: string, position: number, cells: Record<string, unknown>, title = id): RowDef {
  return { id, title, icon: "", cells: cells as RowDef["cells"], createdAt: "", updatedAt: "", position };
}

/* Deliberately *not* in either expected order: in the arranged order the dropdown shows
   (Zebra, Apple, Mango), nor in alphabetical order (Apple, Mango, Zebra), nor in the
   order the rows are stored. A fixture that matched any of those would pass with the
   wrong comparator wired in. */
const rows = [
  row("mango", 0, { p1: "o3" }),
  row("zebra", 1, { p1: "o1" }),
  row("apple", 2, { p1: "o2" }),
  row("blank", 3, {}),
];

const order = (sorted: RowDef[]) => sorted.map((item) => item.title);

/* ---------------------------------------------------------------------------
   The menu's claim matches the comparison
   --------------------------------------------------------------------------- */

test("only the types that own a sequence offer a manual order", () => {
  assert.equal(sortLabels("select").manual, "Manual order");
  assert.equal(sortLabels("multiSelect").manual, "Manual order");
  assert.equal(sortLabels("status").manual, "Manual order");
  /* A text column's "arranged order" does not exist, so offering the row would be the
     same class of lie in the other direction. */
  assert.equal(sortLabels("text").manual, undefined);
  assert.equal(sortLabels("number").manual, undefined);
  assert.equal(sortLabels("date").manual, undefined);
});

test("the direction is in the schema, so a stored view can hold it", () => {
  assert.equal(sortSchema.parse({ propertyId: "p1", direction: "manual" }).direction, "manual");
  assert.equal(sortSchema.parse({ propertyId: "p1" }).direction, "ascending", "unchanged default");
  assert.equal(sortSchema.safeParse({ propertyId: "p1", direction: "arranged" }).success, false);
});

/* ---------------------------------------------------------------------------
   Sorting
   --------------------------------------------------------------------------- */

test("manual is the order a person arranged, which is not alphabetical", () => {
  const manual = sortRows(database, rows, [{ propertyId: "p1", direction: "manual" }]);
  assert.deepEqual(order(manual), ["zebra", "apple", "mango", "blank"], "Zebra, Apple, Mango as arranged");
  /* The one that would pass on broken wiring, so it is asserted separately: alphabetical
     is a different answer for the same four rows. */
  const alpha = sortRows(database, rows, [{ propertyId: "p1", direction: "ascending" }]);
  assert.deepEqual(order(alpha), ["apple", "mango", "zebra", "blank"]);
});

test("a manual sort carries as a tie-break under another column", () => {
  /* The direction is a field on each key in a chain of comparators, and a new value has to
     work in the places a sort is *not* the first one. Two rows with the same title, told
     apart by the arrangement rather than by anything they contain. */
  const tied = [
    row("mango", 0, { p1: "o3" }, "same"),
    row("zebra", 1, { p1: "o1" }, "same"),
    row("apple", 2, { p1: "o2" }, "same"),
  ];
  const sorted = sortRows(database, tied, [
    { propertyId: "title", direction: "ascending" },
    { propertyId: "p1", direction: "manual" },
  ]);
  assert.deepEqual(sorted.map((item) => item.id), ["zebra", "apple", "mango"], "title ties, so the arrangement decides");
});

test("empties sort last in every direction, manual included", () => {
  for (const direction of ["ascending", "descending", "manual"] as const) {
    const sorted = sortRows(database, rows, [{ propertyId: "p1", direction }]);
    assert.equal(sorted.at(-1)?.title, "blank", `empty cell last for ${direction}`);
  }
});

test("a manual sort on a type with no arrangement falls back to its normal comparison", () => {
  /* Not a hypothetical: `manual` is a string in a JSON column. If a view asks a text
     column for an arrangement it does not have, the column must still sort. */
  const byTitle = sortRows(database, rows, [{ propertyId: "title", direction: "manual" }]);
  assert.deepEqual(order(byTitle), order(sortRows(database, rows, [{ propertyId: "title", direction: "ascending" }])));
});

test("a status sorts by its groups when asked for the arrangement", () => {
  const statuses = [
    row("done", 0, { p3: "s3" }),
    row("doing", 1, { p3: "s2" }),
    row("not-started", 2, { p3: "s1" }),
  ];
  assert.deepEqual(
    order(sortRows(database, statuses, [{ propertyId: "p3", direction: "manual" }])),
    ["not-started", "doing", "done"],
    "group order: To do, In progress, Complete",
  );
  assert.deepEqual(
    order(sortRows(database, statuses, [{ propertyId: "p3", direction: "ascending" }])),
    ["doing", "done", "not-started"],
    "and the alphabetical order is a different order, which is the whole point",
  );
});

test("a multi-select's alphabetical order is by tag, not by the order they were clicked", () => {
  /* Two cells holding the same two tags. `Apple, Mango` and `Mango, Apple` are one choice
     made twice, so they must compare equal — a cell stores its ids in pick order. */
  const picked = [
    row("forward", 0, { p2: ["o2", "o3"] }),
    row("backward", 1, { p2: ["o3", "o2"] }),
    row("apple", 2, { p2: ["o2"] }),
  ];
  const sorted = sortRows(database, picked, [{ propertyId: "p2", direction: "ascending" }]);
  assert.deepEqual(order(sorted), ["apple", "forward", "backward"], "single tag first, then the pair, tied on names");
});

test("a multi-select's arrangement keeps more tags after fewer", () => {
  const picked = [
    row("pair", 0, { p2: ["o1", "o2"] }),
    row("zebra", 1, { p2: ["o1"] }),
    row("apple", 2, { p2: ["o2"] }),
  ];
  assert.deepEqual(
    order(sortRows(database, picked, [{ propertyId: "p2", direction: "manual" }])),
    ["zebra", "apple", "pair"],
    "Zebra before Apple by arrangement, and one tag before two",
  );
});

/* ---------------------------------------------------------------------------
   The menu writes it
   --------------------------------------------------------------------------- */

test("choosing the manual order changes the direction but not the sort's rank", () => {
  const before: ViewConfig["sorts"] = [
    { propertyId: "title", direction: "ascending" },
    { propertyId: "p1", direction: "ascending" },
  ];
  const after = nextSorts(before, "p1", "manual");
  assert.deepEqual(after, [
    { propertyId: "title", direction: "ascending" },
    { propertyId: "p1", direction: "manual" },
  ]);
  assert.deepEqual(nextSorts(before, "p1", null).map((sort) => sort.propertyId), ["title"]);
  assert.equal(nextSorts(before, "p9", "manual").at(-1)?.propertyId, "p9", "a new column is appended");
});

/* ---------------------------------------------------------------------------
   What the cell reads — the label and the comparison come from the same place
   --------------------------------------------------------------------------- */

test("the arranged order is reachable from the registry, not from a second list", () => {
  const spec = resolveProperty({ type: "select" });
  assert.equal(typeof spec.order, "function");
  assert.ok(spec.order!("o1", "o2", tags) < 0, "Zebra was arranged before Apple");
  assert.ok(spec.compare("o1", "o2", tags) > 0, "and Zebra reads after Apple");
  assert.equal(formatCell({ type: "select", config: tags }, "o1"), "Zebra");
});
