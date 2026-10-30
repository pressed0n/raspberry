import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openMigrated } from "./schema";
import { RaspberryService, localActor, AppError } from "../src/server/service";
const owner = localActor();
const mutationId = () => randomUUID();
async function fixture() { const db = await openMigrated(), service = new RaspberryService(db); await service.seed(); return { db, service }; }
/** A page at a known revision, so a patch does not have to count its own bumps. */
const fresh = async (service: RaspberryService, id: string) => service.get(owner, id);
const move = async (service: RaspberryService, id: string, parentId: string | null) => {
  const page = await fresh(service, id);
  return service.patch(owner, id, { expectedRevision: page.revision, mutationId: mutationId(), parentId });
};

test("a page can be moved under another page and back to the top level", async () => {
  const { db, service } = await fixture();
  try {
    const home = await service.create(owner, { title: "Home", mutationId: mutationId() });
    const stray = await service.create(owner, { title: "Stray", mutationId: mutationId() });
    assert.equal(stray.parentId, null);
    assert.equal((await move(service, stray.id, home.id)).parentId, home.id);
    assert.equal((await service.get(owner, stray.id)).parentId, home.id);
    /* null is not "no change" — it detaches. That distinction is the reason the
       field is nullable rather than merely optional. */
    assert.equal((await move(service, stray.id, null)).parentId, null);
    assert.equal((await service.get(owner, stray.id)).parentId, null);
  } finally { await db.close(); }
});

test("omitting parentId leaves the parent alone while other fields change", async () => {
  const { db, service } = await fixture();
  try {
    const home = await service.create(owner, { title: "Home", mutationId: mutationId() });
    const child = await service.create(owner, { title: "Child", parentId: home.id, linkInParent: false, mutationId: mutationId() });
    const page = await fresh(service, child.id);
    const patched = await service.patch(owner, child.id, { expectedRevision: page.revision, mutationId: mutationId(), title: "Renamed" });
    assert.equal(patched.title, "Renamed");
    assert.equal(patched.parentId, home.id, "a title change must not detach the page");
  } finally { await db.close(); }
});

test("a page cannot be moved inside itself", async () => {
  const { db, service } = await fixture();
  try {
    const page = await service.create(owner, { title: "Self", mutationId: mutationId() });
    await assert.rejects(move(service, page.id, page.id), (error: AppError) => error.code === "would_cycle");
    assert.equal((await service.get(owner, page.id)).parentId, null);
  } finally { await db.close(); }
});

test("a page cannot be moved inside its own descendant, however deep", async () => {
  const { db, service } = await fixture();
  try {
    const root = await service.create(owner, { title: "Root", mutationId: mutationId() });
    const middle = await service.create(owner, { title: "Middle", parentId: root.id, linkInParent: false, mutationId: mutationId() });
    const leaf = await service.create(owner, { title: "Leaf", parentId: middle.id, linkInParent: false, mutationId: mutationId() });
    await assert.rejects(move(service, root.id, middle.id), (error: AppError) => error.code === "would_cycle");
    await assert.rejects(move(service, root.id, leaf.id), (error: AppError) => error.code === "would_cycle");
    /* The subtree has to survive a refused move intact — a rejected request that
       still wrote half a cycle would be the worst of both. */
    assert.equal((await service.get(owner, root.id)).parentId, null);
    assert.equal((await service.get(owner, middle.id)).parentId, root.id);
    assert.equal((await service.get(owner, leaf.id)).parentId, middle.id);
  } finally { await db.close(); }
});

test("moving a page takes its own children with it", async () => {
  const { db, service } = await fixture();
  try {
    const destination = await service.create(owner, { title: "Destination", mutationId: mutationId() });
    const moving = await service.create(owner, { title: "Moving", mutationId: mutationId() });
    const child = await service.create(owner, { title: "Child of moving", parentId: moving.id, linkInParent: false, mutationId: mutationId() });
    await move(service, moving.id, destination.id);
    assert.equal((await service.get(owner, moving.id)).parentId, destination.id);
    /* The child's parent is still the page that moved, not the new grandparent:
       the subtree travels as a unit and nothing is reparented behind your back. */
    assert.equal((await service.get(owner, child.id)).parentId, moving.id);
  } finally { await db.close(); }
});

test("a trashed destination is refused with a recoverable code", async () => {
  const { db, service } = await fixture();
  try {
    const destination = await service.create(owner, { title: "Trashed destination", mutationId: mutationId() });
    const moving = await service.create(owner, { title: "Moving", mutationId: mutationId() });
    await service.trash(owner, destination.id, destination.revision);
    await assert.rejects(move(service, moving.id, destination.id), (error: AppError) => error.code === "parent_in_trash");
    assert.equal((await service.get(owner, moving.id)).parentId, null);
  } finally { await db.close(); }
});

test("a missing destination is a 404, not a silent detach", async () => {
  const { db, service } = await fixture();
  try {
    const moving = await service.create(owner, { title: "Moving", mutationId: mutationId() });
    await assert.rejects(move(service, moving.id, randomUUID()), (error: AppError) => error.status === 404);
    assert.equal((await service.get(owner, moving.id)).parentId, null);
  } finally { await db.close(); }
});

test("a move bumps the revision and appears in the page list with its new parent", async () => {
  const { db, service } = await fixture();
  try {
    const home = await service.create(owner, { title: "Home", mutationId: mutationId() });
    const stray = await service.create(owner, { title: "Stray", mutationId: mutationId() });
    const before = (await fresh(service, stray.id)).revision;
    const moved = await move(service, stray.id, home.id);
    assert.equal(moved.revision, before + 1);
    const listed = (await service.list(owner, {})).find((page) => page.id === stray.id);
    assert.equal(listed?.parentId, home.id);
  } finally { await db.close(); }
});

test("reusing a mutation id with a different destination is rejected", async () => {
  const { db, service } = await fixture();
  try {
    const one = await service.create(owner, { title: "One", mutationId: mutationId() });
    const two = await service.create(owner, { title: "Two", mutationId: mutationId() });
    const stray = await service.create(owner, { title: "Stray", mutationId: mutationId() });
    const id = mutationId();
    const page = await fresh(service, stray.id);
    await service.patch(owner, stray.id, { expectedRevision: page.revision, mutationId: id, parentId: one.id });
    const after = await fresh(service, stray.id);
    await assert.rejects(
      service.patch(owner, stray.id, { expectedRevision: after.revision, mutationId: id, parentId: two.id }),
      (error: AppError) => error.code === "mutation_reused",
    );
    assert.equal((await service.get(owner, stray.id)).parentId, one.id);
  } finally { await db.close(); }
});
