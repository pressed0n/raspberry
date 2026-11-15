/* B56 — the change digest.
   ---------------------------------------------------------------------------
   The interesting assertion in this file is the *cell* one. A digest built on
   revisions alone looks perfectly healthy in every other test here: create, save,
   trash, restore and purge all move a revision or a count. The one write path that
   moves neither is `databases.ts` `patchRow`, which deliberately leaves
   `databases.revision` alone because that column is the structural-conflict token.
   Without the receipt count, ticking a checkbox on one device would never reach the
   other one — the "it works in every column except this one" failure that a suite
   full of revision assertions cannot see.
   --------------------------------------------------------------------------- */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openMigrated } from "./schema";
import { RaspberryService, localActor } from "../src/server/service";
import { DatabaseService } from "../src/server/databases";
import { stamp } from "../src/server/sync";

const owner = localActor();

async function fixture() {
  const db = await openMigrated();
  const pages = new RaspberryService(db);
  await pages.seed();
  return {
    db,
    pages,
    databases: new DatabaseService(db),
    digest: () => db.transaction((sql) => stamp(sql, owner.workspaceId)),
  };
}

test("the digest is stable while nothing is written", async () => {
  const value = await fixture();
  assert.deepEqual(await value.digest(), await value.digest());
});

test("creating a page moves the total and the live count", async () => {
  const value = await fixture();
  const before = await value.digest();
  await value.pages.create(owner, { title: "New page", mutationId: randomUUID() });
  const after = await value.digest();
  assert.equal(after.pages.total, before.pages.total + 1);
  assert.equal(after.pages.live, before.pages.live + 1);
});

test("saving a page moves its revision sum and nothing else", async () => {
  const value = await fixture();
  const page = await value.pages.create(owner, { title: "Typed in", mutationId: randomUUID() });
  const before = await value.digest();
  await value.pages.patch(owner, page.id, { expectedRevision: page.revision, mutationId: randomUUID(), title: "Renamed" });
  const after = await value.digest();
  assert.equal(after.pages.revisions, before.pages.revisions + 1);
  assert.equal(after.pages.total, before.pages.total, "an edit is not a new page");
  assert.equal(after.pages.live, before.pages.live);
});

test("trashing a page moves the live count, and restoring moves it back", async () => {
  const value = await fixture();
  const page = await value.pages.create(owner, { title: "Doomed", mutationId: randomUUID() });
  const before = await value.digest();
  await value.pages.trash(owner, page.id, page.revision);
  const trashed = await value.digest();
  assert.equal(trashed.pages.live, before.pages.live - 1, "the sidebar's set changed");
  assert.equal(trashed.pages.total, before.pages.total, "the row is still there");
  assert.ok(trashed.pages.revisions > before.pages.revisions, "trash is a revision write");
  await value.pages.restore(owner, page.id);
  const restored = await value.digest();
  assert.equal(restored.pages.live, before.pages.live);
  assert.notDeepEqual(restored, trashed);
});

test("purging a page moves the total, which is the only write that removes a row", async () => {
  const value = await fixture();
  const page = await value.pages.create(owner, { title: "Gone", mutationId: randomUUID() });
  await value.pages.trash(owner, page.id, page.revision);
  const before = await value.digest();
  await value.pages.purge(owner, page.id);
  const after = await value.digest();
  assert.equal(after.pages.total, before.pages.total - 1);
});

test("a database cell write moves the digest even though no revision does", async () => {
  const value = await fixture();
  const database = await value.databases.create(owner, { title: "Tasks", mutationId: randomUUID() });
  const withProperty = await value.databases.addProperty(owner, database.id, { type: "text", name: "Owner", mutationId: randomUUID() });
  const propertyId = withProperty.properties.find((entry) => entry.name === "Owner")?.id;
  assert.ok(propertyId);
  const withRow = await value.databases.addRow(owner, database.id, { title: "A row", mutationId: randomUUID() });
  const rowId = withRow.rows[0]?.id;
  assert.ok(rowId);

  const before = await value.digest();
  await value.databases.patchRow(owner, database.id, rowId, { cells: { [propertyId]: "Preston" }, mutationId: randomUUID() });
  const after = await value.digest();

  assert.equal(after.databases.revisions, before.databases.revisions, "the structural revision is deliberately untouched by a cell write");
  assert.equal(after.pages.revisions, before.pages.revisions, "and no page is rewritten either");
  assert.equal(after.writes, before.writes + 1, "the receipt is the only evidence, so the digest has to read it");
  assert.notDeepEqual(after, before);
});

test("a structural database write moves the database revision", async () => {
  const value = await fixture();
  const database = await value.databases.create(owner, { title: "Tasks", mutationId: randomUUID() });
  const before = await value.digest();
  await value.databases.addProperty(owner, database.id, { type: "number", name: "Effort", mutationId: randomUUID() });
  const after = await value.digest();
  assert.equal(after.databases.revisions, before.databases.revisions + 1);
  assert.equal(after.databases.total, before.databases.total);
});

test("another workspace's writes never move this workspace's digest", async () => {
  const value = await fixture();
  const other = randomUUID();
  const empty = { pages: { total: 0, live: 0, revisions: 0 }, databases: { total: 0, revisions: 0 }, writes: 0 };
  assert.deepEqual(await value.db.transaction((sql) => stamp(sql, other)), empty);
  const page = await value.pages.create(owner, { title: "Mine", mutationId: randomUUID() });
  await value.pages.patch(owner, page.id, { expectedRevision: page.revision, mutationId: randomUUID(), title: "Still mine" });
  assert.deepEqual(await value.db.transaction((sql) => stamp(sql, other)), empty, "the digest is scoped, not global");
});

test("sync answers with the watched tabs, including one that was trashed elsewhere", async () => {
  const value = await fixture();
  const page = await value.pages.create(owner, { title: "Watched", mutationId: randomUUID() });
  const first = await value.pages.sync(owner, [page.id]);
  assert.equal(first.pages.length, 1);
  assert.equal(first.pages[0]?.revision, page.revision);
  assert.equal(first.pages[0]?.deletedAt, null);
  assert.deepEqual(first.stamp, await value.digest(), "the digest and the summaries come from one transaction");

  await value.pages.trash(owner, page.id, page.revision);
  const afterTrash = await value.pages.sync(owner, [page.id]);
  assert.equal(afterTrash.pages.length, 1, "a trashed page is still reported: its tab has to be told");
  assert.notEqual(afterTrash.pages[0]?.deletedAt, null);
});

test("sync ignores ids this workspace does not hold", async () => {
  const value = await fixture();
  const result = await value.pages.sync(owner, [randomUUID(), randomUUID()]);
  assert.deepEqual(result.pages, []);
});
