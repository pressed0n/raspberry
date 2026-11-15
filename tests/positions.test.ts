import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { RaspberryService, localActor, AppError } from "../src/server/service";
import { openMigrated } from "./schema";

const owner = localActor();
const mutationId = () => randomUUID();

/* Migrated, because `position` arrives in migration 4 rather than in the baseline DDL —
   a fixture that skipped `migrate()` would be testing a schema no running server has. */
async function fixture() {
  const db = await openMigrated();
  const service = new RaspberryService(db);
  await service.seed();
  return { db, service };
}
const make = (service: RaspberryService, title: string, parentId: string | null = null) =>
  service.create(owner, { title, parentId, mutationId: mutationId() });
const order = async (service: RaspberryService, parentId: string | null) =>
  (await service.list(owner, { parentId })).map((page) => page.id);
const slots = async (service: RaspberryService, parentId: string | null) =>
  (await service.list(owner, { parentId })).map((page) => page.position);

async function move(service: RaspberryService, id: string, parentId: string | null, index: number) {
  const page = await service.get(owner, id);
  return service.move(owner, id, { parentId, index, expectedRevision: page.revision, mutationId: mutationId() });
}

test("a new page appends to the end of its parent", async () => {
  const { service } = await fixture();
  const first = await make(service, "First"), second = await make(service, "Second");
  const root = await order(service, null);
  assert.deepEqual(root.slice(-2), [first.id, second.id]);
  assert.equal(second.position, first.position + 1);
});

test("a new subpage appends inside its parent, not into the root list", async () => {
  const { service } = await fixture();
  const parent = await make(service, "Parent");
  const one = await make(service, "One", parent.id), two = await make(service, "Two", parent.id);
  assert.deepEqual(await order(service, parent.id), [one.id, two.id]);
  assert.deepEqual(await slots(service, parent.id), [0, 1]);
});

test("moving to index 0 puts the page first and leaves positions dense", async () => {
  const { service } = await fixture();
  const parent = await make(service, "Parent");
  const one = await make(service, "One", parent.id), two = await make(service, "Two", parent.id), three = await make(service, "Three", parent.id);
  await move(service, three.id, parent.id, 0);
  assert.deepEqual(await order(service, parent.id), [three.id, one.id, two.id]);
  /* Dense 0..n-1: gaps are what turn "insert at 2" into "insert at 7" after a few moves. */
  assert.deepEqual(await slots(service, parent.id), [0, 1, 2]);
});

test("an index past the end lands the page last instead of failing", async () => {
  const { service } = await fixture();
  const parent = await make(service, "Parent");
  const one = await make(service, "One", parent.id), two = await make(service, "Two", parent.id);
  /* The client derives the index from measured geometry; a row that vanished mid-drag
     should not turn the drop into an error after the user already let go. */
  await move(service, one.id, parent.id, 99);
  assert.deepEqual(await order(service, parent.id), [two.id, one.id]);
});

test("moving into another page reparents it, appends it, and renumbers both lists", async () => {
  const { service } = await fixture();
  const host = await make(service, "Host"), guest = await make(service, "Guest");
  const child = await make(service, "Child", host.id);
  await move(service, guest.id, host.id, 1);
  assert.equal((await service.get(owner, guest.id)).parentId, host.id);
  assert.deepEqual(await order(service, host.id), [child.id, guest.id]);
  assert.deepEqual(await slots(service, host.id), [0, 1]);
  /* The old list closes its gap: the remaining root pages are still dense from 0. */
  const rootSlots = await slots(service, null);
  assert.deepEqual(rootSlots, rootSlots.map((_slot, index) => index));
});

test("only the moved page's revision advances", async () => {
  const { service } = await fixture();
  const parent = await make(service, "Parent");
  const stays = await make(service, "Stays", parent.id), moves = await make(service, "Moves", parent.id);
  const before = await service.get(owner, stays.id);
  await move(service, moves.id, parent.id, 0);
  const after = await service.get(owner, stays.id);
  /* A dragged neighbour is renumbered, not edited. Bumping its revision would 409 any
     editor open on it — a drag must not be able to break an unrelated page's autosave. */
  assert.equal(after.revision, before.revision);
  assert.equal((await service.get(owner, moves.id)).revision, moves.revision + 1);
});

test("a move into a page's own descendant is refused and writes nothing", async () => {
  const { service } = await fixture();
  const parent = await make(service, "Parent"), child = await make(service, "Child", parent.id);
  const before = await service.get(owner, parent.id);
  await assert.rejects(
    () => service.move(owner, parent.id, { parentId: child.id, index: 0, expectedRevision: before.revision, mutationId: mutationId() }),
    (error: unknown) => error instanceof AppError && error.code === "would_cycle",
  );
  const after = await service.get(owner, parent.id);
  assert.equal(after.parentId, null);
  assert.equal(after.revision, before.revision);
});

test("a stale expectedRevision is refused rather than guessed", async () => {
  const { service } = await fixture();
  const parent = await make(service, "Parent"), page = await make(service, "Page", parent.id);
  /* Move it once so its revision is genuinely behind, then try to move it again with the
     revision from before the first move — the exact state a second tab would be in. */
  const stale = page.revision;
  await move(service, page.id, null, 0);
  await assert.rejects(
    () => service.move(owner, page.id, { parentId: parent.id, index: 0, expectedRevision: stale, mutationId: mutationId() }),
    (error: unknown) => error instanceof AppError && error.status === 409,
  );
  assert.equal((await service.get(owner, page.id)).parentId, null);
});

test("replaying the same mutation returns the first result without bumping twice", async () => {
  const { service } = await fixture();
  const parent = await make(service, "Parent"), page = await make(service, "Page", parent.id);
  const replay = mutationId(), expectedRevision = page.revision;
  const first = await service.move(owner, page.id, { parentId: null, index: 0, expectedRevision, mutationId: replay });
  const second = await service.move(owner, page.id, { parentId: null, index: 0, expectedRevision, mutationId: replay });
  assert.equal(second.revision, first.revision);
  assert.deepEqual(await order(service, null).then((ids) => ids[0]), page.id);
});

test("reparenting through PATCH appends instead of inheriting the old slot", async () => {
  const { service } = await fixture();
  const host = await make(service, "Host"), other = await make(service, "Other");
  const child = await make(service, "Child", host.id);
  const current = await service.get(owner, other.id);
  await service.patch(owner, other.id, { parentId: host.id, expectedRevision: current.revision, mutationId: mutationId() });
  const moved = await service.get(owner, other.id);
  assert.equal(moved.parentId, host.id);
  /* Two siblings holding the same position would be ordered by `created_at` — an ordering
     nobody can see and nobody can change. Newcomers go to the end. */
  assert.equal(moved.position, child.position + 1);
});
