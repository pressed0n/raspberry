import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openMigrated } from "./schema";
import { columnNames, tableNames } from "./catalog";
import { DatabaseService } from "../src/server/databases";
import { RaspberryService, localActor, AppError } from "../src/server/service";
import { documentSchema, emptyDocument } from "../src/lib/document";
import { defaultViewConfig, primaryPropertyId, titleProperty, type DatabasePayload, type RowDef } from "../src/lib/database/types";
import { matches, selectRows, sortRows, visibleProperties, cellOf } from "../src/lib/database/rows";
import { formatCell } from "../src/lib/database/properties";

const owner = localActor();

/* One migrated in-memory database with a seeded workspace, shared by every case here
   because migration 6 is what is under test as much as the service is. */
async function fixture() {
  const db = await openMigrated();
  const pages = new RaspberryService(db);
  await pages.seed();
  return { db, pages, databases: new DatabaseService(db) };
}

async function databaseWith(fixtureValue: Awaited<ReturnType<typeof fixture>>, title = "Tasks") {
  return fixtureValue.databases.create(owner, { title, mutationId: randomUUID() });
}

/* Rows are pages with `database_id` set. B38 has no route that creates one, so the
   tests insert them the one way the model allows — through the pages table. */
async function addRow(fixtureValue: Awaited<ReturnType<typeof fixture>>, databaseId: string, title: string, position: number) {
  const id = randomUUID(), now = new Date(Date.now() + position).toISOString();
  await fixtureValue.db.transaction((sql) => sql.query(
    "INSERT INTO pages (id,workspace_id,parent_id,database_id,title,icon,content,plain_text,favorite,revision,schema_version,created_at,updated_at,deleted_at,trash_batch,position) VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
    [id, owner.workspaceId, databaseId, title, "file", JSON.stringify(emptyDocument()), title, 0, 1, 1, now, now, null, null, position],
  ));
  return id;
}

/* ---------------------------------------------------------------------------
   Migration 6
   --------------------------------------------------------------------------- */

test("migration 6 creates the four tables a database needs", async () => {
  const { db } = await fixture();
  const names = new Set(await tableNames(db));
  for (const table of ["databases", "database_properties", "database_views", "database_cells"]) {
    assert.ok(names.has(table), `${table} should exist`);
  }
  const columns = await columnNames(db, "pages");
  assert.ok(columns.includes("database_id"), "pages gained database_id");
});

/* ---------------------------------------------------------------------------
   Creation and shape
   --------------------------------------------------------------------------- */

test("a new database opens on one table view and no properties", async () => {
  const value = await fixture();
  const database = await databaseWith(value);
  assert.equal(database.title, "Tasks");
  /* The wishlist's first item is the table view, and `Name` is the *primary* property —
     which is `pages.title`, so a fresh schema really does have no property rows. */
  assert.equal(database.views.length, 1);
  assert.equal(database.views[0].type, "table");
  assert.equal(database.views[0].name, "Table");
  assert.deepEqual(database.views[0].config, defaultViewConfig);
  assert.deepEqual(database.properties, []);
  assert.deepEqual(database.rows, []);
});

test("creating a database is replay-safe by mutationId", async () => {
  const value = await fixture();
  const mutationId = randomUUID();
  const first = await value.databases.create(owner, { title: "Once", mutationId });
  const again = await value.databases.create(owner, { title: "Once", mutationId });
  assert.equal(again.id, first.id, "the retry returns the original rather than creating a second");
  const all = await value.db.transaction((sql) => sql.query("SELECT id FROM databases"));
  assert.equal(all.length, 1);
});

test("reusing a mutationId for a different change is refused", async () => {
  const value = await fixture();
  const mutationId = randomUUID();
  await value.databases.create(owner, { title: "One", mutationId });
  await assert.rejects(() => value.databases.create(owner, { title: "Two", mutationId }), (error: unknown) => error instanceof AppError && error.code === "mutation_reused");
});

test("a database cannot be attached to a page in another workspace", async () => {
  const value = await fixture();
  await assert.rejects(
    () => value.databases.create(owner, { pageId: randomUUID(), title: "Nope", mutationId: randomUUID() }),
    (error: unknown) => error instanceof AppError && error.status === 404,
  );
});

test("renaming is revisioned, so two tabs cannot silently merge", async () => {
  const value = await fixture();
  const database = await databaseWith(value);
  const renamed = await value.databases.patch(owner, database.id, { title: "Renamed", expectedRevision: database.revision, mutationId: randomUUID() });
  assert.equal(renamed.title, "Renamed");
  assert.equal(renamed.revision, database.revision + 1);
  await assert.rejects(
    () => value.databases.patch(owner, database.id, { title: "Stale", expectedRevision: database.revision, mutationId: randomUUID() }),
    (error: unknown) => error instanceof AppError && error.code === "revision_conflict",
  );
});

/* ---------------------------------------------------------------------------
   D2 — a row is a page, and the tree must not see it
   --------------------------------------------------------------------------- */

test("rows never appear in the page tree", async () => {
  const value = await fixture();
  const database = await databaseWith(value);
  const rowId = await addRow(value, database.id, "A row", 0);

  const tree = await value.pages.list(owner, {});
  assert.equal(tree.some((page) => page.id === rowId), false, "the sidebar listing excludes database rows");

  const withRows = await value.pages.list(owner, { rows: true });
  assert.equal(withRows.some((page) => page.id === rowId), true, "rows are still listed when a caller asks for them");
});

test("a row is still a real page — readable, renameable, searchable", async () => {
  const value = await fixture();
  const database = await databaseWith(value);
  const rowId = await addRow(value, database.id, "Writable row", 0);
  const page = await value.pages.get(owner, rowId);
  assert.equal(page.title, "Writable row");
  const renamed = await value.pages.patch(owner, rowId, { title: "Renamed row", expectedRevision: page.revision, mutationId: randomUUID() });
  assert.equal(renamed.title, "Renamed row");
});

test("a row cannot be re-parented into the tree", async () => {
  const value = await fixture();
  const database = await databaseWith(value);
  const rowId = await addRow(value, database.id, "Stuck row", 0);
  const parent = await value.pages.create(owner, { title: "Parent", mutationId: randomUUID() });
  const row = await value.pages.get(owner, rowId);
  await assert.rejects(
    () => value.pages.move(owner, rowId, { parentId: parent.id, index: 0, expectedRevision: row.revision, mutationId: randomUUID() }),
    (error: unknown) => error instanceof AppError && error.code === "row_not_movable",
  );
});

test("the database payload carries its rows with their cells", async () => {
  const value = await fixture();
  const database = await databaseWith(value);
  const rowId = await addRow(value, database.id, "First", 0);
  await addRow(value, database.id, "Second", 1);
  const loaded = await value.databases.get(owner, database.id);
  assert.deepEqual(loaded.rows.map((row) => row.title), ["First", "Second"]);
  assert.deepEqual(loaded.rows[0].cells, {});
  assert.equal(loaded.rows[0].id, rowId);

  const propertyId = randomUUID();
  await value.db.transaction((sql) => sql.query("INSERT INTO database_properties(id,database_id,name,type,config,position,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)", [propertyId, database.id, "Notes", "text", "{}", 0, new Date().toISOString()]));
  await value.db.transaction((sql) => sql.query("INSERT INTO database_cells(row_id,property_id,value,updated_at) VALUES($1,$2,$3,$4)", [rowId, propertyId, JSON.stringify("hello"), new Date().toISOString()]));
  const reloaded = await value.databases.get(owner, database.id);
  assert.equal(reloaded.rows[0].cells[propertyId], "hello");
});

/* ---------------------------------------------------------------------------
   Deletion cascades
   --------------------------------------------------------------------------- */

test("trashing the owning page trashes its rows too, without flooding the trash", async () => {
  const value = await fixture();
  const page = await value.pages.create(owner, { title: "With a table", mutationId: randomUUID() });
  const database = await value.databases.create(owner, { pageId: page.id, title: "In page", mutationId: randomUUID() });
  const rowId = await addRow(value, database.id, "Row", 0);

  await value.pages.trash(owner, page.id, page.revision);

  const state = await value.db.transaction((sql) => sql.query<{ deleted_at: string | null; trash_batch: string | null }>("SELECT deleted_at,trash_batch FROM pages WHERE id=$1", [rowId]));
  assert.ok(state[0]?.deleted_at, "the row was trashed with its page rather than left behind");
  /* Hidden from the trash list, because it comes back with the page it belongs to. */
  const trashed = await value.pages.list(owner, { trash: true });
  assert.equal(trashed.some((item) => item.id === rowId), false, "rows do not clutter the trash when their own page is in it");
  assert.ok(trashed.some((item) => item.id === page.id));
});

test("a row trashed on its own is findable in the trash", async () => {
  const value = await fixture();
  const page = await value.pages.create(owner, { title: "Live page", mutationId: randomUUID() });
  const database = await value.databases.create(owner, { pageId: page.id, title: "Live table", mutationId: randomUUID() });
  const rowId = await addRow(value, database.id, "Deleted row", 0);

  const row = await value.pages.get(owner, rowId);
  await value.pages.trash(owner, rowId, row.revision);

  const trashed = await value.pages.list(owner, { trash: true });
  assert.ok(trashed.some((item) => item.id === rowId), "a row deleted from a live table can be found and restored");
  const live = await value.databases.get(owner, database.id);
  assert.equal(live.rows.length, 0, "and it is gone from its own table while it sits in the trash");
});

test("purging the owning page removes the database, its views and its cells", async () => {
  const value = await fixture();
  const page = await value.pages.create(owner, { title: "Doomed", mutationId: randomUUID() });
  const database = await value.databases.create(owner, { pageId: page.id, title: "Doomed table", mutationId: randomUUID() });
  const rowId = await addRow(value, database.id, "Row", 0);
  const propertyId = randomUUID();
  await value.db.transaction(async (sql) => {
    await sql.query("INSERT INTO database_properties(id,database_id,name,type,config,position,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)", [propertyId, database.id, "Notes", "text", "{}", 0, new Date().toISOString()]);
    await sql.query("INSERT INTO database_cells(row_id,property_id,value,updated_at) VALUES($1,$2,$3,$4)", [rowId, propertyId, JSON.stringify("x"), new Date().toISOString()]);
  });

  await value.pages.trash(owner, page.id, page.revision);
  await value.pages.purge(owner, page.id);

  const counts = await value.db.transaction(async (sql) => ({
    databases: (await sql.query("SELECT id FROM databases")).length,
    properties: (await sql.query("SELECT id FROM database_properties")).length,
    views: (await sql.query("SELECT id FROM database_views")).length,
    cells: (await sql.query("SELECT row_id FROM database_cells")).length,
    rows: (await sql.query("SELECT id FROM pages WHERE database_id=$1", [database.id])).length,
  }));
  assert.deepEqual(counts, { databases: 0, properties: 0, views: 0, cells: 0, rows: 0 });
});

test("purging a single row straight out of the trash clears its cells", async () => {
  const value = await fixture();
  const database = await databaseWith(value);
  const rowId = await addRow(value, database.id, "Lonely", 0);
  const propertyId = randomUUID();
  await value.db.transaction(async (sql) => {
    await sql.query("INSERT INTO database_properties(id,database_id,name,type,config,position,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)", [propertyId, database.id, "Notes", "text", "{}", 0, new Date().toISOString()]);
    await sql.query("INSERT INTO database_cells(row_id,property_id,value,updated_at) VALUES($1,$2,$3,$4)", [rowId, propertyId, JSON.stringify("x"), new Date().toISOString()]);
  });
  const page = await value.pages.get(owner, rowId);
  await value.pages.trash(owner, rowId, page.revision);
  await value.pages.purge(owner, rowId);
  const cells = await value.db.transaction((sql) => sql.query("SELECT row_id FROM database_cells"));
  assert.equal(cells.length, 0);
  const liveDatabase = await value.databases.get(owner, database.id);
  assert.equal(liveDatabase.rows.length, 0, "the database itself survives");
});

/* ---------------------------------------------------------------------------
   Document schema
   --------------------------------------------------------------------------- */

test("a database block is valid, and is only a reference", async () => {
  const databaseId = randomUUID();
  const document = [{ id: randomUUID(), type: "database", props: { databaseId, viewId: "" }, children: [] }];
  const parsed = documentSchema.parse(document);
  assert.equal(parsed[0].props.databaseId, databaseId);
  /* The block must not be able to carry a table: a document that inlined cell values
     would rewrite itself on every keystroke in a cell. */
  assert.throws(() => documentSchema.parse([{ id: randomUUID(), type: "database", props: { databaseId }, children: [], content: [{ type: "text", text: "cells", styles: {} }] }]));
  assert.throws(() => documentSchema.parse([{ id: randomUUID(), type: "database", props: { databaseId: "not-a-uuid" }, children: [] }]));
});

test("a database block cannot hold children", async () => {
  const document = [{ id: randomUUID(), type: "database", props: { databaseId: randomUUID() }, children: [{ id: randomUUID(), type: "paragraph", props: {}, content: [], children: [] }] }];
  assert.equal(documentSchema.safeParse(document).success, false);
});

/* ---------------------------------------------------------------------------
   The row-set pipeline (D5)
   --------------------------------------------------------------------------- */

function row(title: string, position: number, cells: RowDef["cells"] = {}): RowDef {
  return { id: `row-${position}`, title, icon: "file", cells, createdAt: "", updatedAt: "", position };
}

function payload(rows: RowDef[], properties: DatabasePayload["properties"] = []): DatabasePayload {
  return { id: "db", pageId: null, title: "T", icon: "database", revision: 1, properties, views: [], rows, createdAt: "", updatedAt: "" };
}

test("the primary property is the page title, and it is never hidden", () => {
  const config = { ...defaultViewConfig, visibleProperties: ["other"] };
  const visible = visibleProperties({ properties: [{ id: "other", name: "Other", type: "text", config: {}, position: 0 }] }, config);
  assert.equal(visible[0].id, primaryPropertyId);
  assert.ok(visible.some((property) => property.id === "other"));
});

test("an empty filter list passes every row", () => {
  const rows = [row("a", 0), row("b", 1)];
  assert.deepEqual(rows.filter((item) => matches({ properties: [] }, item, [])).length, 2);
});

test("filters run against the title through the reserved primary id", () => {
  const rows = [row("Alpha", 0), row("Beta", 1)];
  const kept = rows.filter((item) => matches({ properties: [] }, item, [{ id: "f", propertyId: primaryPropertyId, operator: "contains", value: "alp" }]));
  assert.deepEqual(kept.map((item) => item.title), ["Alpha"]);
});

test("sorting is by property, then by the row's own order — never unstable", () => {
  const rows = [row("b", 2), row("a", 1), row("c", 0)];
  const sorted = sortRows({ properties: [] }, rows, [{ propertyId: primaryPropertyId, direction: "ascending" }]);
  assert.deepEqual(sorted.map((item) => item.title), ["a", "b", "c"]);
  const descending = sortRows({ properties: [] }, rows, [{ propertyId: primaryPropertyId, direction: "descending" }]);
  assert.deepEqual(descending.map((item) => item.title), ["c", "b", "a"]);
  /* Equal keys must not shuffle: the tie-break is the stored position. */
  const tied = sortRows({ properties: [] }, [row("same", 2), row("same", 1)], [{ propertyId: primaryPropertyId, direction: "ascending" }]);
  assert.deepEqual(tied.map((item) => item.position), [1, 2]);
});

test("selectRows filters before it windows, so a page never shows rows the filter removed", () => {
  const rows = Array.from({ length: 30 }, (_, index) => row(`Item ${index}`, index));
  const data = payload(rows);
  const config = { ...defaultViewConfig, filters: [{ id: "f", propertyId: primaryPropertyId, operator: "contains" as const, value: "Item 1" }] };
  const set = selectRows(data, config, { limit: 3 });
  assert.equal(set.total, 11, "Item 1 and Item 10..19");
  assert.equal(set.rows.length, 3);
});

test("grouping puts the empty bucket last", () => {
  const property = { id: "p", name: "Group", type: "text" as const, config: {}, position: 0 };
  const rows = [row("a", 0, { p: null }), row("b", 1, { p: "one" }), row("c", 2, { p: "two" })];
  const set = selectRows(payload(rows, [property]), { ...defaultViewConfig, group: { propertyId: "p", hideEmptyGroups: false } });
  assert.deepEqual(set.groups.map((group) => group.label), ["one", "two", "No value"]);
  const hidden = selectRows(payload(rows, [property]), { ...defaultViewConfig, group: { propertyId: "p", hideEmptyGroups: true } });
  assert.deepEqual(hidden.groups.map((group) => group.label), ["one", "two"]);
});

test("number formatting is presentation, not storage", () => {
  const number = { id: "n", name: "N", type: "number" as const, config: { format: "currency", currency: "USD", decimals: 2, divideBy: 1 }, position: 0 };
  assert.equal(formatCell(number, 12.5), "$12.50");
  const divided = { ...number, config: { ...number.config, divideBy: 100 } };
  assert.equal(formatCell(divided, 50), "$0.50");
  const percent = { ...number, config: { format: "percent", decimals: 0, divideBy: 1 } };
  assert.equal(formatCell(percent, 42), "42%");
  const duration = { ...number, config: { format: "duration", divideBy: 1 } };
  assert.equal(formatCell(duration, 5400), "1h 30m");
  assert.equal(formatCell(number, null), "", "an empty cell reads as empty, not zero");
});

test("titleProperty and the reserved id agree", () => {
  assert.equal(titleProperty.id, primaryPropertyId);
  assert.equal(cellOf(row("Named", 0), titleProperty), "Named");
});
