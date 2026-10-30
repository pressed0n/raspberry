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
import { propertyById, selectRows, titlePropertyOf, visibleProperties } from "../src/lib/database/rows";

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
