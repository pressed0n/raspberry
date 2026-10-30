import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openMigrated } from "./schema";
import { RaspberryService, localActor, AppError } from "../src/server/service";

const owner = localActor();
const mutationId = () => randomUUID();

async function fixture() {
  const db = await openMigrated();
  const service = new RaspberryService(db);
  await service.seed();
  const home = await service.create(owner, { title: "Purge fixture", mutationId: mutationId() });
  return { db, service, home };
}

const child = (service: RaspberryService, title: string, parentId: string) =>
  service.create(owner, { title, parentId, linkInParent: false, mutationId: mutationId() });

const toTrash = async (service: RaspberryService, id: string) => {
  const page = await service.get(owner, id);
  return service.trash(owner, id, page.revision);
};

const trashCount = async (service: RaspberryService) => (await service.list(owner, { trash: true })).length;
const liveIds = async (service: RaspberryService) => (await service.list(owner)).map((page) => page.id);

test("a trashed page can be deleted for good", async () => {
  const { db, service, home } = await fixture();
  try {
    await toTrash(service, home.id);
    const result = await service.purge(owner, home.id);
    assert.deepEqual(result.ids, [home.id]);
    assert.equal(await trashCount(service), 0);
    assert.equal((await liveIds(service)).includes(home.id), false);
    await assert.rejects(service.get(owner, home.id), (error) => error instanceof AppError && error.status === 404);
  } finally { await db.close(); }
});

test("purging refuses a page that is not in the trash", async () => {
  const { db, service, home } = await fixture();
  try {
    /* The button that calls this is not the guard. "Permanently delete" must never be
       reachable for live work, even from a request that asks for it directly. */
    await assert.rejects(service.purge(owner, home.id), (error) => error instanceof AppError && error.code === "not_trashed");
    const still = await service.get(owner, home.id);
    assert.equal(still.deletedAt, null);
  } finally { await db.close(); }
});

test("purging a trashed parent takes its trashed subpages with it", async () => {
  const { db, service, home } = await fixture();
  try {
    const note = await child(service, "Note", home.id);
    await toTrash(service, home.id);
    assert.equal(await trashCount(service), 2);
    const result = await service.purge(owner, home.id);
    assert.deepEqual(result.ids.sort(), [home.id, note.id].sort());
    assert.equal(await trashCount(service), 0);
    await assert.rejects(service.get(owner, note.id), (error) => error instanceof AppError && error.status === 404);
  } finally { await db.close(); }
});

test("purging detaches a live page left under a trashed parent", async () => {
  const { db, service, home } = await fixture();
  try {
    /* No API path can produce a live child of a trashed page — `create` and `patch`
       both refuse a trashed destination — but `parent_id` is a foreign key, so if one
       ever existed the parent could not be deleted. Purge detaches instead of
       failing. Written straight to the database because that is the only way to
       reach the state. */
    await toTrash(service, home.id);
    const stray = randomUUID();
    const block = { id: randomUUID(), type: "paragraph", props: { textColor: "default", backgroundColor: "default", textAlignment: "left" }, content: [{ type: "text", text: "still here", styles: {} }], children: [] };
    await db.transaction(async (sql) => {
      await sql.query(
        "INSERT INTO pages(id,workspace_id,parent_id,title,icon,content,plain_text,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)",
        [stray, owner.workspaceId, home.id, "Stray", "file", JSON.stringify([block]), "still here", new Date().toISOString()],
      );
    });
    const result = await service.purge(owner, home.id);
    assert.deepEqual(result.ids, [home.id]);
    const kept = await service.get(owner, stray);
    assert.equal(kept.deletedAt, null, "a live page must survive its parent being purged");
    assert.equal(kept.parentId, null, "it is detached, not left pointing at a row that is gone");
  } finally { await db.close(); }
});

test("emptying an empty trash is a no-op", async () => {
  const { db, service } = await fixture();
  try {
    assert.deepEqual((await service.emptyTrash(owner)).ids, []);
    assert.deepEqual((await service.emptyTrash(owner)).ids, []);
    assert.equal(await trashCount(service), 0);
  } finally { await db.close(); }
});

test("emptying the trash removes every trashed page and only those", async () => {
  const { db, service, home } = await fixture();
  try {
    const kept = await child(service, "Kept", home.id);
    const gone = await child(service, "Gone", home.id);
    await toTrash(service, gone.id);
    const result = await service.emptyTrash(owner);
    assert.deepEqual(result.ids, [gone.id]);
    assert.equal(await trashCount(service), 0);
    const live = await liveIds(service);
    assert.equal(live.includes(home.id), true);
    assert.equal(live.includes(kept.id), true);
    assert.equal(live.includes(gone.id), false);
  } finally { await db.close(); }
});

test("a purged page's history goes with it", async () => {
  const { db, service, home } = await fixture();
  try {
    await service.patch(owner, home.id, {
      expectedRevision: (await service.get(owner, home.id)).revision,
      mutationId: mutationId(),
      title: "Renamed before deletion",
    });
    await toTrash(service, home.id);
    await service.purge(owner, home.id);
    /* The snapshots hold the page's full text. Leaving them behind after a
       "permanent" delete would keep it readable on disk, and `revisions.page_id` is a
       foreign key, so a purge that skipped them could not have deleted the page. */
    const snapshots = await db.transaction(async (sql) => sql.query("SELECT revision FROM revisions WHERE page_id=$1", [home.id]));
    assert.equal(snapshots.length, 0, "history must go with the page");
    await assert.rejects(service.history(owner, home.id), (error) => error instanceof AppError && error.status === 404);
  } finally { await db.close(); }
});
