import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../src/server/database";
import { RaspberryService, localActor, AppError } from "../src/server/service";
import { emptyDocument } from "../src/lib/document";

const owner = localActor();
const base = Date.parse("2026-01-01T00:00:00.000Z");
const at = (offset: number) => new Date(base + offset).toISOString();
async function fixture() { const db = await openDatabase("file::memory:"), service = new RaspberryService(db); await service.seed(); return { db, service }; }

/** Insert a row directly so a test can exceed the service row cap without hundreds of mutations. */
function insert(db: Awaited<ReturnType<typeof openDatabase>>, row: { id: string; parentId: string | null; title: string; createdAt: string; deletedAt?: string | null; trashBatch?: string | null }) {
  return db.transaction((sql) => sql.query(
    "INSERT INTO pages (id,workspace_id,parent_id,title,icon,content,plain_text,favorite,revision,schema_version,created_at,updated_at,deleted_at,trash_batch) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
    [row.id, owner.workspaceId, row.parentId, row.title, "file", JSON.stringify(emptyDocument()), row.title, 0, 1, 1, row.createdAt, row.createdAt, row.deletedAt ?? null, row.trashBatch ?? null],
  ));
}

test("children are paginated across a workspace larger than the row cap", async () => {
  const { db, service } = await fixture();
  try {
    const parentId = randomUUID();
    await insert(db, { id: parentId, parentId: null, title: "Parent", createdAt: at(0) });
    // 210 children: the previous implementation filtered a 200-row listing, so the
    // last children were invisible and offset 200 returned nothing at all.
    await db.transaction(async (sql) => {
      for (let index = 0; index < 210; index++) {
        await sql.query(
          "INSERT INTO pages (id,workspace_id,parent_id,title,icon,content,plain_text,favorite,revision,schema_version,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
          [randomUUID(), owner.workspaceId, parentId, `Child ${index}`, "file", JSON.stringify(emptyDocument()), `Child ${index}`, 0, 1, 1, at(1000 + index * 1000), at(1000 + index * 1000)],
        );
      }
    });
    const batches: string[][] = [];
    for (let offset = 0; offset < 300; offset += 100) batches.push((await service.list(owner, { parentId, limit: 100, offset })).map((page) => page.title));
    assert.deepEqual(batches.map((batch) => batch.length), [100, 100, 10]);
    assert.deepEqual(batches[2], ["Child 200", "Child 201", "Child 202", "Child 203", "Child 204", "Child 205", "Child 206", "Child 207", "Child 208", "Child 209"]);
    assert.equal(new Set(batches.flat()).size, 210, "every child is returned exactly once");
  } finally { await db.close(); }
});

test("root listing returns only parentless pages", async () => {
  const { db, service } = await fixture();
  try {
    const parentId = randomUUID();
    await insert(db, { id: parentId, parentId: null, title: "Root", createdAt: at(0) });
    await insert(db, { id: randomUUID(), parentId, title: "Nested", createdAt: at(1000) });
    const roots = await service.list(owner, { parentId: null });
    assert.ok(roots.some((page) => page.id === parentId));
    assert.ok(roots.every((page) => page.parentId === null));
    assert.ok(!roots.some((page) => page.title === "Nested"));
  } finally { await db.close(); }
});

test("listing children of an unknown page is a 404, not an empty list", async () => {
  const { db, service } = await fixture();
  try {
    await assert.rejects(service.list(owner, { parentId: randomUUID() }), (error: AppError) => error.status === 404 && error.code === "not_found");
  } finally { await db.close(); }
});

test("a trashed page without a batch identifier can still be restored", async () => {
  const { db, service } = await fixture();
  try {
    // Legacy rows (and pages deleted by an older build) carry deleted_at but no
    // trash_batch. Matching on that null restored nothing and crashed on the missing row.
    const id = randomUUID();
    await insert(db, { id, parentId: null, title: "Legacy trash", createdAt: at(0), deletedAt: at(1000), trashBatch: null });
    const restored = await service.restore(owner, id);
    assert.equal(restored.id, id);
    assert.equal(restored.deletedAt, null);
    assert.equal((await service.get(owner, id)).revision, 2);
  } finally { await db.close(); }
});

test("restoring a batch still returns every page trashed with it", async () => {
  const { db, service } = await fixture();
  try {
    const parent = await service.create(owner, { title: "Parent", mutationId: randomUUID() });
    const child = await service.create(owner, { title: "Child", parentId: parent.id, mutationId: randomUUID() });
    await service.trash(owner, parent.id, (await service.get(owner, parent.id)).revision);
    // The batch is restored from its root; a child cannot be restored before its parent.
    const restored = await service.restore(owner, parent.id);
    assert.equal(restored.id, parent.id);
    assert.equal(restored.deletedAt, null);
    assert.equal((await service.get(owner, child.id)).deletedAt, null);
    assert.equal((await service.get(owner, child.id)).revision, 3);
  } finally { await db.close(); }
});
