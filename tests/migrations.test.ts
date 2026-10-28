import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase, type Database } from "../src/server/database";
import { migrate, migrations, type Migration } from "../src/server/migrations";
import { RaspberryService, localActor } from "../src/server/service";
import { documentSchema, pageReferences } from "../src/lib/document";

const owner = localActor();

async function versionRows(database: Database): Promise<number[]> {
  const rows = await database.transaction((sql) => sql.query<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version"));
  return rows.map((row) => Number(row.version));
}

async function tableExists(database: Database, name: string): Promise<boolean> {
  const rows = await database.transaction((sql) => sql.query("SELECT name FROM sqlite_master WHERE type='table' AND name=$1", [name]));
  return rows.length > 0;
}

test("a fresh database records every migration once", async () => {
  const database = await openDatabase("file::memory:");
  assert.deepEqual(await versionRows(database), [], "the baseline DDL no longer writes a version row on its own");
  const first = await migrate(database);
  assert.deepEqual(first.applied, [1, 2]);
  assert.equal(first.version, 2);
  assert.deepEqual(await versionRows(database), [1, 2]);
});

test("migrating again applies nothing", async () => {
  const database = await openDatabase("file::memory:");
  await migrate(database);
  const second = await migrate(database);
  assert.deepEqual(second.applied, []);
  assert.equal(second.version, 2);
});

test("pending migrations run in version order, not declaration order", async () => {
  const database = await openDatabase("file::memory:");
  const plan: Migration[] = [
    { version: 3, name: "third", async up(sql) { await sql.query("INSERT INTO order_probe(value) VALUES($1)", ["third"]); } },
    {
      version: 1,
      name: "first",
      async up(sql) {
        await sql.query("CREATE TABLE IF NOT EXISTS order_probe (value TEXT NOT NULL)");
      },
    },
    { version: 2, name: "second", async up(sql) { await sql.query("INSERT INTO order_probe(value) VALUES($1)", ["second"]); } },
  ];
  const result = await migrate(database, plan);
  assert.deepEqual(result.applied, [1, 2, 3]);
  const rows = await database.transaction((sql) => sql.query<{ value: string }>("SELECT value FROM order_probe"));
  assert.deepEqual(rows.map((row) => String(row.value)), ["second", "third"]);
});

test("a failing migration leaves neither its change nor its version row", async () => {
  const database = await openDatabase("file::memory:");
  const broken: Migration[] = [
    {
      version: 1,
      name: "creates a table then fails",
      async up(sql) {
        await sql.query("CREATE TABLE IF NOT EXISTS rollback_probe (id TEXT NOT NULL)");
        throw new Error("intentional failure");
      },
    },
  ];
  await assert.rejects(() => migrate(database, broken), /intentional failure/);
  assert.deepEqual(await versionRows(database), []);
  assert.equal(await tableExists(database, "rollback_probe"), false, "DDL rolled back with the transaction");

  // The same database must still accept a corrected migration afterwards.
  const fixed: Migration[] = [{ version: 1, name: "creates a table", async up(sql) { await sql.query("CREATE TABLE IF NOT EXISTS rollback_probe (id TEXT NOT NULL)"); } }];
  assert.deepEqual((await migrate(database, fixed)).applied, [1]);
  assert.equal(await tableExists(database, "rollback_probe"), true);
});

test("a database newer than the build is refused", async () => {
  const database = await openDatabase("file::memory:");
  await migrate(database);
  await database.transaction((sql) => sql.query("INSERT INTO schema_migrations(version) VALUES(99)"));
  await assert.rejects(() => migrate(database), /newer schema/);
});

test("duplicate versions are rejected before anything runs", async () => {
  const database = await openDatabase("file::memory:");
  const plan: Migration[] = [
    { version: 1, name: "one", async up() {} },
    { version: 1, name: "one again", async up() {} },
  ];
  await assert.rejects(() => migrate(database, plan), /Duplicate migration version 1/);
  assert.deepEqual(await versionRows(database), []);
});

test("migration 2 appends a missing child link, and only once", async () => {
  const database = await openDatabase("file::memory:");
  await migrate(database);
  const service = new RaspberryService(database);
  await service.seed();
  const parent = await service.create(owner, { title: "Parent", mutationId: randomUUID() });
  const child = await service.create(owner, { title: "Child", mutationId: randomUUID() });
  // Simulate a page tree that predates inline link rendering.
  await database.transaction((sql) => sql.query("UPDATE pages SET parent_id=$1 WHERE id=$2", [parent.id, child.id]));
  await database.transaction((sql) => sql.query("DELETE FROM schema_migrations WHERE version=2"));

  const childLinkPlan = migrations;
  assert.deepEqual((await migrate(database, childLinkPlan)).applied, [2]);
  const linked = await service.get(owner, parent.id);
  assert.ok(pageReferences(linked.content).includes(child.id), "the parent now references the child");

  const revision = linked.revision;
  await database.transaction((sql) => sql.query("DELETE FROM schema_migrations WHERE version=2"));
  await migrate(database, childLinkPlan);
  const relinked = await service.get(owner, parent.id);
  assert.equal(relinked.revision, revision, "a second run sees the link already present and writes nothing");
  assert.equal(pageReferences(relinked.content).filter((id) => id === child.id).length, 1);
});

test("migration 2 leaves an unparseable document alone instead of blocking startup", async () => {
  const database = await openDatabase("file::memory:");
  await migrate(database);
  const service = new RaspberryService(database);
  await service.seed();
  const parent = await service.create(owner, { title: "Legacy", mutationId: randomUUID() });
  const child = await service.create(owner, { title: "Orphan", mutationId: randomUUID() });
  await database.transaction(async (sql) => {
    await sql.query("UPDATE pages SET parent_id=$1 WHERE id=$2", [parent.id, child.id]);
    await sql.query("UPDATE pages SET content=$1 WHERE id=$2", ['{"not":"a document"}', parent.id]);
    await sql.query("DELETE FROM schema_migrations WHERE version=2");
  });

  await migrate(database, migrations);
  const rows = await database.transaction((sql) => sql.query<{ content: string }>("SELECT content FROM pages WHERE id=$1", [parent.id]));
  assert.equal(String(rows[0].content), '{"not":"a document"}', "content that cannot be parsed is left byte-for-byte intact");
});

test("page content survived by migration 2 still matches the document schema", async () => {
  const database = await openDatabase("file::memory:");
  await migrate(database);
  const service = new RaspberryService(database);
  await service.seed();
  const parent = await service.create(owner, { title: "Parent", mutationId: randomUUID() });
  const child = await service.create(owner, { title: "Child", mutationId: randomUUID() });
  await database.transaction(async (sql) => {
    await sql.query("UPDATE pages SET parent_id=$1 WHERE id=$2", [parent.id, child.id]);
    await sql.query("DELETE FROM schema_migrations WHERE version=2");
  });
  await migrate(database, migrations);
  const page = await service.get(owner, parent.id);
  assert.equal(documentSchema.safeParse(page.content).success, true);
});
