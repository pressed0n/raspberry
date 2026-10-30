import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openMigrated } from "./schema";
import type { Database } from "../src/server/database";
import { DatabaseService } from "../src/server/databases";
import { RaspberryService, localActor, AppError } from "../src/server/service";
import { primaryPropertyId, type DatabasePayload } from "../src/lib/database/types";

/**
 * The write path — B40/B41.
 *
 * Everything here goes through the *service*, not through a route, because the routes
 * are three lines of parsing and the decisions worth testing live below them: what
 * `coerce` stores, what happens to a column whose type is changed while it holds
 * values, and whether a retried mutation adds a second column or returns the first.
 */
const owner = localActor();

async function fixture() {
  const db = await openMigrated();
  const pages = new RaspberryService(db);
  await pages.seed();
  return { db, pages, databases: new DatabaseService(db) };
}

async function fresh() {
  const value = await fixture();
  const database = await value.databases.create(owner, { title: "Tasks", mutationId: randomUUID() });
  return { ...value, database };
}

const propertyNamed = (payload: DatabasePayload, name: string) =>
  payload.properties.find((property) => property.name === name);

/* The service is the interface under test, so reaching past it is kept to one helper:
   some of these assertions are about what the *database* holds afterwards, and a test
   that can only see the payload cannot tell a deleted cell from a hidden one. */
async function firstRow<T extends Record<string, unknown>>(db: Database, text: string, values: unknown[] = []): Promise<T> {
  return db.transaction(async (sql) => {
    const [row] = await sql.query<T>(text, values);
    return row;
  });
}

/* ---------------------------------------------------------------------------
   Properties
   --------------------------------------------------------------------------- */

test("adding a property appends it and returns the whole payload", async () => {
  const value = await fresh();
  const next = await value.databases.addProperty(owner, value.database.id, { type: "number", name: "Effort", mutationId: randomUUID() });

  assert.equal(next.properties.length, 1);
  assert.equal(next.properties[0].name, "Effort");
  assert.equal(next.properties[0].type, "number");
  assert.equal(next.properties[0].position, 0);
  /* The primary property is not a row in `database_properties` — it is the page title
     — so a database with one real property has exactly one property row. */
  assert.equal(next.properties.some((property) => property.id === primaryPropertyId), false);
});

test("a second property lands to the right of the first", async () => {
  const value = await fresh();
  await value.databases.addProperty(owner, value.database.id, { type: "text", name: "First", mutationId: randomUUID() });
  const next = await value.databases.addProperty(owner, value.database.id, { type: "date", name: "Second", mutationId: randomUUID() });

  assert.deepEqual(next.properties.map((property) => property.name), ["First", "Second"]);
  assert.deepEqual(next.properties.map((property) => property.position), [0, 1]);
});

test("a config the type cannot read is refused once, at the door", async () => {
  const value = await fresh();
  await assert.rejects(
    () => value.databases.addProperty(owner, value.database.id, { type: "number", name: "Bad", config: { decimals: "many" }, mutationId: randomUUID() }),
    (error: unknown) => error instanceof AppError && error.code === "invalid_config",
  );
  const after = await value.databases.get(owner, value.database.id);
  assert.equal(after.properties.length, 0);
});

test("a retried add returns the first property instead of a second one", async () => {
  const value = await fresh();
  const mutationId = randomUUID();
  const first = await value.databases.addProperty(owner, value.database.id, { type: "select", name: "Status", mutationId });
  const retry = await value.databases.addProperty(owner, value.database.id, { type: "select", name: "Status", mutationId });

  assert.equal(retry.properties.length, 1);
  assert.equal(retry.properties[0].id, first.properties[0].id);
});

test("renaming a property keeps its values", async () => {
  const value = await fresh();
  const withProperty = await value.databases.addProperty(owner, value.database.id, { type: "text", name: "Owner", mutationId: randomUUID() });
  const propertyId = withProperty.properties[0].id;
  const withRow = await value.databases.addRow(owner, value.database.id, { title: "Write the plan", mutationId: randomUUID() });
  const rowId = withRow.rows[0].id;
  await value.databases.patchRow(owner, value.database.id, rowId, { cells: { [propertyId]: "Preston" }, mutationId: randomUUID() });

  const renamed = await value.databases.patchProperty(owner, value.database.id, propertyId, { name: "Assignee", mutationId: randomUUID() });
  assert.equal(renamed.properties[0].name, "Assignee");
  assert.equal(renamed.rows[0].cells[propertyId], "Preston");
});

test("re-typing a column with values in it is refused rather than obeyed", async () => {
  const value = await fresh();
  const withProperty = await value.databases.addProperty(owner, value.database.id, { type: "text", name: "Due", mutationId: randomUUID() });
  const propertyId = withProperty.properties[0].id;
  const withRow = await value.databases.addRow(owner, value.database.id, { title: "", mutationId: randomUUID() });
  await value.databases.patchRow(owner, value.database.id, withRow.rows[0].id, { cells: { [propertyId]: "tomorrow" }, mutationId: randomUUID() });

  await assert.rejects(
    () => value.databases.patchProperty(owner, value.database.id, propertyId, { type: "number", mutationId: randomUUID() }),
    (error: unknown) => error instanceof AppError && error.code === "property_in_use",
  );
  /* The refusal is the point: the value is still there, still readable as text. */
  const after = await value.databases.get(owner, value.database.id);
  assert.equal(after.properties[0].type, "text");
  assert.equal(after.rows[0].cells[propertyId], "tomorrow");
});

test("re-typing an empty column is allowed", async () => {
  const value = await fresh();
  const withProperty = await value.databases.addProperty(owner, value.database.id, { type: "text", name: "Due", mutationId: randomUUID() });
  const next = await value.databases.patchProperty(owner, value.database.id, withProperty.properties[0].id, { type: "date", mutationId: randomUUID() });
  assert.equal(next.properties[0].type, "date");
});

test("deleting a property takes its cells with it", async () => {
  const value = await fresh();
  const withProperty = await value.databases.addProperty(owner, value.database.id, { type: "text", name: "Notes", mutationId: randomUUID() });
  const propertyId = withProperty.properties[0].id;
  const withRow = await value.databases.addRow(owner, value.database.id, { title: "Row", mutationId: randomUUID() });
  await value.databases.patchRow(owner, value.database.id, withRow.rows[0].id, { cells: { [propertyId]: "kept?" }, mutationId: randomUUID() });

  const after = await value.databases.deleteProperty(owner, value.database.id, propertyId, randomUUID());
  assert.equal(after.properties.length, 0);
  assert.deepEqual(after.rows[0].cells, {});

  /* Not just hidden: the row is gone from the table, so a restored backup cannot bring
     a value back with no column to hold it. */
  const orphan = await firstRow(value.db, "SELECT COUNT(*) AS count FROM database_cells WHERE property_id=$1", [propertyId]);
  assert.equal(Number(orphan.count), 0);
});

test("a property cannot be edited through the wrong database", async () => {
  const value = await fresh();
  const other = await value.databases.create(owner, { title: "Other", mutationId: randomUUID() });
  const withProperty = await value.databases.addProperty(owner, other.id, { type: "text", name: "Theirs", mutationId: randomUUID() });

  await assert.rejects(
    () => value.databases.patchProperty(owner, value.database.id, withProperty.properties[0].id, { name: "Mine now", mutationId: randomUUID() }),
    (error: unknown) => error instanceof AppError && error.status === 404,
  );
});

test("a structural change bumps the revision, a cell change does not", async () => {
  const value = await fresh();
  const before = value.database.revision;

  const added = await value.databases.addProperty(owner, value.database.id, { type: "text", name: "A", mutationId: randomUUID() });
  assert.ok(added.revision > before, "a new column changes the schema, so the revision moves");

  const withRow = await value.databases.addRow(owner, value.database.id, { title: "", mutationId: randomUUID() });
  const afterRow = withRow.revision;
  const written = await value.databases.patchRow(owner, value.database.id, withRow.rows[0].id, { cells: { [added.properties[0].id]: "x" }, mutationId: randomUUID() });
  assert.equal(written.revision, afterRow, "typing in a cell is not a structural edit");

  /* Which is exactly what keeps a rename in another tab from being refused because
     somebody typed a value. */
  const renamed = await value.databases.patch(owner, value.database.id, { title: "Tasks 2", expectedRevision: afterRow, mutationId: randomUUID() });
  assert.equal(renamed.title, "Tasks 2");
});

/* ---------------------------------------------------------------------------
   Rows
   --------------------------------------------------------------------------- */

test("a new row is a real page in this database", async () => {
  const value = await fresh();
  const next = await value.databases.addRow(owner, value.database.id, { mutationId: randomUUID() });

  assert.equal(next.rows.length, 1);
  assert.equal(next.rows[0].title, "");
  assert.equal(next.rows[0].position, 0);

  const page = await firstRow(value.db, "SELECT database_id,workspace_id,deleted_at FROM pages WHERE id=$1", [next.rows[0].id]);
  assert.equal(page.database_id, value.database.id);
  assert.equal(page.workspace_id, owner.workspaceId);
  assert.equal(page.deleted_at, null);
});

test("rows stack in creation order", async () => {
  const value = await fresh();
  await value.databases.addRow(owner, value.database.id, { title: "One", mutationId: randomUUID() });
  const next = await value.databases.addRow(owner, value.database.id, { title: "Two", mutationId: randomUUID() });
  assert.deepEqual(next.rows.map((row) => row.title), ["One", "Two"]);
  assert.deepEqual(next.rows.map((row) => row.position), [0, 1]);
});

test("a retried new page does not leave two empty rows behind", async () => {
  const value = await fresh();
  const mutationId = randomUUID();
  const first = await value.databases.addRow(owner, value.database.id, { title: "", mutationId });
  const retry = await value.databases.addRow(owner, value.database.id, { title: "", mutationId });

  assert.equal(retry.rows.length, 1);
  assert.equal(retry.rows[0].id, first.rows[0].id);
});

test("a row in a deleted page is not writable through the table", async () => {
  const value = await fresh();
  const next = await value.databases.addRow(owner, value.database.id, { title: "Trash me", mutationId: randomUUID() });
  const rowId = next.rows[0].id;
  await value.db.transaction((sql) => sql.query("UPDATE pages SET deleted_at=$1 WHERE id=$2", [new Date().toISOString(), rowId]));

  await assert.rejects(
    () => value.databases.patchRow(owner, value.database.id, rowId, { title: "Nope", mutationId: randomUUID() }),
    (error: unknown) => error instanceof AppError && error.status === 404,
  );
});

test("renaming a row bumps the page's revision, so an open draft cannot undo it", async () => {
  const value = await fresh();
  const next = await value.databases.addRow(owner, value.database.id, { title: "", mutationId: randomUUID() });
  const rowId = next.rows[0].id;
  const before = await firstRow(value.db, "SELECT revision FROM pages WHERE id=$1", [rowId]);

  await value.databases.patchRow(owner, value.database.id, rowId, { title: "Named in the table", mutationId: randomUUID() });
  const after = await firstRow(value.db, "SELECT revision,title FROM pages WHERE id=$1", [rowId]);

  assert.equal(after.title, "Named in the table");
  assert.ok(Number(after.revision) > Number(before.revision));
});

/* ---------------------------------------------------------------------------
   The grip menu's two verbs
   --------------------------------------------------------------------------- */

test("duplicating an entry puts the copy directly below it, cells and all", async () => {
  const value = await fresh();
  const text = await value.databases.addProperty(owner, value.database.id, { type: "text", name: "Notes", mutationId: randomUUID() });
  const notesId = propertyNamed(text, "Notes")!.id;

  await value.databases.addRow(owner, value.database.id, { title: "First", mutationId: randomUUID() });
  const withTwo = await value.databases.addRow(owner, value.database.id, { title: "Second", mutationId: randomUUID() });
  const source = withTwo.rows[1].id;
  /* Cells are written through `patchRow`: a new row has no values to set, which is the
     same rule the table follows — the cell editor is the only thing that writes one. */
  await value.databases.patchRow(owner, value.database.id, source, { cells: { [notesId]: "keep me" }, mutationId: randomUUID() });

  const next = await value.databases.duplicateRow(owner, value.database.id, source, { mutationId: randomUUID() });

  assert.deepEqual(next.rows.map((row) => row.title), ["First", "Second", "Second"]);
  assert.notEqual(next.rows[2].id, source, "a copy is its own page, not a second reference to one");
  assert.equal(next.rows[2].cells[notesId], "keep me", "a copy that lost its values is not a copy");
  assert.deepEqual(next.rows.map((row) => row.position), [0, 1, 2], "positions stay contiguous");
});

test("a duplicated entry's cells are copies, not the original's", async () => {
  const value = await fresh();
  const text = await value.databases.addProperty(owner, value.database.id, { type: "text", name: "Notes", mutationId: randomUUID() });
  const notesId = propertyNamed(text, "Notes")!.id;
  const created = await value.databases.addRow(owner, value.database.id, { title: "One", mutationId: randomUUID() });
  const source = created.rows[0].id;
  await value.databases.patchRow(owner, value.database.id, source, { cells: { [notesId]: "original" }, mutationId: randomUUID() });

  const next = await value.databases.duplicateRow(owner, value.database.id, source, { mutationId: randomUUID() });
  const copy = next.rows[1].id;

  await value.databases.patchRow(owner, value.database.id, copy, { cells: { [notesId]: "edited" }, mutationId: randomUUID() });
  const after = await value.databases.get(owner, value.database.id);

  assert.equal(after.rows[0].cells[notesId], "original");
  assert.equal(after.rows[1].cells[notesId], "edited");
});

test("a retried duplicate copies the entry once", async () => {
  const value = await fresh();
  const created = await value.databases.addRow(owner, value.database.id, { title: "One", mutationId: randomUUID() });
  const mutationId = randomUUID();

  const first = await value.databases.duplicateRow(owner, value.database.id, created.rows[0].id, { mutationId });
  const retry = await value.databases.duplicateRow(owner, value.database.id, created.rows[0].id, { mutationId });

  assert.equal(first.rows.length, 2);
  assert.equal(retry.rows.length, 2);
  assert.equal(retry.rows[1].id, first.rows[1].id);
});

test("moving an entry to trash soft-deletes its page and drops it from the table", async () => {
  const value = await fresh();
  await value.databases.addRow(owner, value.database.id, { title: "Keep", mutationId: randomUUID() });
  const created = await value.databases.addRow(owner, value.database.id, { title: "Trash me", mutationId: randomUUID() });
  const rowId = created.rows[1].id;

  const next = await value.databases.trashRow(owner, value.database.id, rowId, { mutationId: randomUUID() });

  assert.deepEqual(next.rows.map((row) => row.title), ["Keep"]);
  const page = await firstRow(value.db, "SELECT deleted_at,trash_batch,content FROM pages WHERE id=$1", [rowId]);
  assert.ok(page.deleted_at, "trash is a soft delete, never a DELETE");
  assert.ok(page.trash_batch, "one batch id is what makes Trash restore the entry as one thing");
  /* The page keeps its body: restore puts the entry back with the content it had. */
  assert.equal(typeof page.content, "string");
});

test("an entry in another database cannot be duplicated or trashed through this one", async () => {
  const value = await fresh();
  const other = await value.databases.create(owner, { title: "Other", mutationId: randomUUID() });
  const foreign = await value.databases.addRow(owner, other.id, { title: "Not yours", mutationId: randomUUID() });
  const rowId = foreign.rows[0].id;

  for (const call of [
    () => value.databases.duplicateRow(owner, value.database.id, rowId, { mutationId: randomUUID() }),
    () => value.databases.trashRow(owner, value.database.id, rowId, { mutationId: randomUUID() }),
  ]) {
    await assert.rejects(call, (error: unknown) => error instanceof AppError && error.status === 404);
  }
  const page = await firstRow(value.db, "SELECT deleted_at FROM pages WHERE id=$1", [rowId]);
  assert.equal(page.deleted_at, null, "the refusal happened before anything was written");
});

/* ---------------------------------------------------------------------------
   Cells
   --------------------------------------------------------------------------- */

test("a value is stored as the number a number column means", async () => {
  const value = await fresh();
  const withProperty = await value.databases.addProperty(owner, value.database.id, { type: "number", name: "Points", mutationId: randomUUID() });
  const propertyId = withProperty.properties[0].id;
  const withRow = await value.databases.addRow(owner, value.database.id, { title: "", mutationId: randomUUID() });

  const next = await value.databases.patchRow(owner, value.database.id, withRow.rows[0].id, { cells: { [propertyId]: "1 234" }, mutationId: randomUUID() });
  assert.equal(next.rows[0].cells[propertyId], 1234, "spacing is formatting, not a value");
});

test("an unreadable value is stored as empty rather than as garbage", async () => {
  const value = await fresh();
  const withProperty = await value.databases.addProperty(owner, value.database.id, { type: "number", name: "Points", mutationId: randomUUID() });
  const propertyId = withProperty.properties[0].id;
  const withRow = await value.databases.addRow(owner, value.database.id, { title: "", mutationId: randomUUID() });

  const next = await value.databases.patchRow(owner, value.database.id, withRow.rows[0].id, { cells: { [propertyId]: "not a number" }, mutationId: randomUUID() });
  assert.equal(next.rows[0].cells[propertyId], undefined);
});

test("clearing a cell removes the row instead of storing a null", async () => {
  const value = await fresh();
  const withProperty = await value.databases.addProperty(owner, value.database.id, { type: "text", name: "Note", mutationId: randomUUID() });
  const propertyId = withProperty.properties[0].id;
  const withRow = await value.databases.addRow(owner, value.database.id, { title: "", mutationId: randomUUID() });
  const rowId = withRow.rows[0].id;
  await value.databases.patchRow(owner, value.database.id, rowId, { cells: { [propertyId]: "something" }, mutationId: randomUUID() });

  const cleared = await value.databases.patchRow(owner, value.database.id, rowId, { cells: { [propertyId]: null }, mutationId: randomUUID() });
  assert.deepEqual(cleared.rows[0].cells, {});

  /* One representation of "nothing": if empty were stored as `null` as well as
     absent, `isEmpty` filters would have to know about both. */
  const count = await firstRow(value.db, "SELECT COUNT(*) AS count FROM database_cells WHERE row_id=$1", [rowId]);
  assert.equal(Number(count.count), 0);
});

test("writing one cell leaves the others alone", async () => {
  const value = await fresh();
  const first = await value.databases.addProperty(owner, value.database.id, { type: "text", name: "A", mutationId: randomUUID() });
  const second = await value.databases.addProperty(owner, value.database.id, { type: "text", name: "B", mutationId: randomUUID() });
  const withRow = await value.databases.addRow(owner, value.database.id, { title: "", mutationId: randomUUID() });
  const rowId = withRow.rows[0].id;
  const a = first.properties[0].id;
  /* `second.properties` is the full list, so pick by name — the id of the property that
     was just added is the last one, in position order. */
  const b = propertyNamed(second, "B")!.id;

  await value.databases.patchRow(owner, value.database.id, rowId, { cells: { [a]: "alpha" }, mutationId: randomUUID() });
  const next = await value.databases.patchRow(owner, value.database.id, rowId, { cells: { [b]: "beta" }, mutationId: randomUUID() });

  assert.equal(next.rows[0].cells[a], "alpha");
  assert.equal(next.rows[0].cells[b], "beta");
});

test("a cell cannot be written through a property of another database", async () => {
  const value = await fresh();
  const other = await value.databases.create(owner, { title: "Other", mutationId: randomUUID() });
  const theirs = await value.databases.addProperty(owner, other.id, { type: "text", name: "Theirs", mutationId: randomUUID() });
  const withRow = await value.databases.addRow(owner, value.database.id, { title: "", mutationId: randomUUID() });

  await assert.rejects(
    () => value.databases.patchRow(owner, value.database.id, withRow.rows[0].id, { cells: { [theirs.properties[0].id]: "x" }, mutationId: randomUUID() }),
    (error: unknown) => error instanceof AppError && error.status === 404,
  );
});

test("the table reads back what was written, through the same pipeline the view uses", async () => {
  const value = await fresh();
  const withProperty = await value.databases.addProperty(owner, value.database.id, { type: "checkbox", name: "Done", mutationId: randomUUID() });
  const propertyId = withProperty.properties[0].id;
  const withRow = await value.databases.addRow(owner, value.database.id, { title: "Ship it", mutationId: randomUUID() });

  const next = await value.databases.patchRow(owner, value.database.id, withRow.rows[0].id, { cells: { [propertyId]: true }, mutationId: randomUUID() });
  assert.equal(next.rows[0].cells[propertyId], true);
  assert.equal(next.rows[0].title, "Ship it");
});

/* ---------------------------------------------------------------------------
   Order — the per-row `+` and the grip
   ---------------------------------------------------------------------------
   A row's position is not a field of the row the way a title is: it only means anything
   relative to its siblings, so every write here renumbers a list rather than setting one
   number. That is exactly the kind of thing that looks right in the payload and is wrong
   in the table, so these assert the *order*, not the positions. */

const titlesOf = (payload: DatabasePayload) => payload.rows.map((row) => row.title);

/* A write that returns no rows, for the one assertion that has to *make* the messy
   state the bug lived in rather than find it. */
async function run(db: Database, text: string, values: unknown[] = []): Promise<void> {
  await db.transaction(async (sql) => {
    await sql.query(text, values);
  });
}

async function threeRows(value: Awaited<ReturnType<typeof fresh>>) {
  for (const title of ["one", "two", "three"]) {
    await value.databases.addRow(owner, value.database.id, { title, mutationId: randomUUID() });
  }
  const payload = await value.databases.get(owner, value.database.id);
  assert.deepEqual(titlesOf(payload), ["one", "two", "three"]);
  return payload;
}

test("`+` on a row inserts the new page directly below it, not at the bottom", async () => {
  const value = await fresh();
  const rows = await threeRows(value);

  const next = await value.databases.addRow(owner, value.database.id, { title: "between", after: rows.rows[0].id, mutationId: randomUUID() });

  assert.deepEqual(titlesOf(next), ["one", "between", "two", "three"]);
});

test("`after` a row whose siblings share a position still lands in the right slot", async () => {
  const value = await fresh();
  await threeRows(value);

  /* Rows created before `after` existed all sit at `MAX(position) + 1`, and a
     renumbered list is 0..n-1 — the two conventions coexisted in this table for a day.
     Forcing every row onto position 0 reproduces the messiest case of it, and
     `after.position + 1` would then put the new page at the very end.
     
     Shared positions mean order falls through to `created_at` and then the id, so the
     anchor has to be taken from the order the server *reports* — three rows made in the
     same millisecond do not come back in the order they were created. */
  await run(value.db, "UPDATE pages SET position = 0 WHERE database_id = $1", [value.database.id]);
  const before = await value.databases.get(owner, value.database.id);
  const anchor = before.rows[1];

  const next = await value.databases.addRow(owner, value.database.id, { title: "middle", after: anchor.id, mutationId: randomUUID() });

  assert.deepEqual(titlesOf(next), [before.rows[0].title, anchor.title, "middle", before.rows[2].title]);
});

test("`after` an unknown row is a 404 and adds nothing", async () => {
  const value = await fresh();
  const rows = await threeRows(value);

  await assert.rejects(
    () => value.databases.addRow(owner, value.database.id, { title: "ghost", after: randomUUID(), mutationId: randomUUID() }),
    (error: unknown) => error instanceof AppError && error.status === 404,
  );
  assert.deepEqual(titlesOf(await value.databases.get(owner, value.database.id)), titlesOf(rows));
});

test("dragging a row renumbers the list and the payload comes back in the new order", async () => {
  const value = await fresh();
  const rows = await threeRows(value);
  const [one, two, three] = rows.rows.map((row) => row.id);

  const next = await value.databases.reorderRows(owner, value.database.id, { ids: [three, one, two], mutationId: randomUUID() });

  assert.deepEqual(titlesOf(next), ["three", "one", "two"]);
  /* Not just a sorted read: the stored positions are the order, so a view that adds a
     row later appends after the last one rather than into the middle. */
  assert.deepEqual(next.rows.map((row) => row.position), [0, 1, 2]);
});

test("reordering a subset keeps the rows it did not name behind the ones it did", async () => {
  const value = await fresh();
  const rows = await threeRows(value);
  const [one, two, three] = rows.rows.map((row) => row.id);

  /* A filtered or windowed table only knows the rows it can see. The unnamed one must
     not vanish into a tie — it keeps its relative place after the named ones. */
  const next = await value.databases.reorderRows(owner, value.database.id, { ids: [three, one], mutationId: randomUUID() });

  assert.deepEqual(titlesOf(next), ["three", "one", "two"]);
});

test("a reorder that names a row twice is refused rather than guessed at", async () => {
  const value = await fresh();
  const rows = await threeRows(value);
  const one = rows.rows[0].id;

  await assert.rejects(
    () => value.databases.reorderRows(owner, value.database.id, { ids: [one, one], mutationId: randomUUID() }),
    (error: unknown) => error instanceof AppError && error.status === 400,
  );
  assert.deepEqual(titlesOf(await value.databases.get(owner, value.database.id)), ["one", "two", "three"]);
});

test("a reorder cannot reach a row of another database", async () => {
  const value = await fresh();
  await threeRows(value);
  const other = await value.databases.create(owner, { title: "Other", mutationId: randomUUID() });
  const theirs = await value.databases.addRow(owner, other.id, { title: "theirs", mutationId: randomUUID() });

  await assert.rejects(
    () => value.databases.reorderRows(owner, value.database.id, { ids: [theirs.rows[0].id], mutationId: randomUUID() }),
    (error: unknown) => error instanceof AppError && error.status === 404,
  );
});

test("a reorder replays by mutationId instead of moving rows twice", async () => {
  const value = await fresh();
  const rows = await threeRows(value);
  const [one, two, three] = rows.rows.map((row) => row.id);
  const mutationId = randomUUID();

  const first = await value.databases.reorderRows(owner, value.database.id, { ids: [two, three, one], mutationId });
  /* The retry sends a *different* order with the same id — which is the case a receipt
     has to reject rather than apply. Same order, replayed: same answer, no second write. */
  const replay = await value.databases.reorderRows(owner, value.database.id, { ids: [two, three, one], mutationId });

  assert.deepEqual(titlesOf(first), ["two", "three", "one"]);
  assert.deepEqual(titlesOf(replay), titlesOf(first));
  assert.deepEqual(titlesOf(await value.databases.get(owner, value.database.id)), ["two", "three", "one"]);
});
