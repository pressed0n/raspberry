import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, LOCAL_USER_ID, LOCAL_WORKSPACE_ID } from "../src/server/database";
import { RaspberryService, localActor, AppError } from "../src/server/service";
import { emptyDocument, documentSchema } from "../src/lib/document";
import { localAccessError } from "../src/server/local-access";
import { backupSqlite } from "../src/server/backup";
const owner = localActor();
const mutationId = () => randomUUID();
async function fixture() { const db = await openDatabase("file::memory:"), service = new RaspberryService(db); await service.seed(); return { db, service }; }

test("only one concurrent edit at a revision succeeds; both history and text stay consistent", async () => {
  const { db, service } = await fixture();
  try {
    const page = await service.create(owner, { title: "Shared idea", mutationId: mutationId() });
    const results = await Promise.allSettled([
      service.patch(owner, page.id, { expectedRevision: 1, title: "Browser edit", mutationId: mutationId() }),
      service.patch(localActor("mcp-local"), page.id, { expectedRevision: 1, title: "AI edit", mutationId: mutationId() }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.equal(rejected.reason.code, "revision_conflict");
    assert.equal((await service.get(owner, page.id)).revision, 2);
    assert.deepEqual((await service.history(owner, page.id)).map((r) => r.revision), [2, 1]);
    assert.equal((await service.revision(owner, page.id, 1)).title, "Shared idea");
  } finally { await db.close(); }
});
test("identical retries return the original result and reused mutation IDs reject different input", async () => {
  const { db, service } = await fixture();
  try {
    const input = { title: "Once", mutationId: mutationId() }, a = await service.create(owner, input), b = await service.create(owner, input);
    assert.equal(a.id, b.id);
    const patch = { title: "Changed once", expectedRevision: 1, mutationId: mutationId() };
    assert.deepEqual(await service.patch(owner, a.id, patch), await service.patch(owner, a.id, patch));
    await assert.rejects(service.patch(owner, a.id, { ...patch, title: "Different" }), (e: AppError) => e.code === "mutation_reused");
    assert.equal((await service.get(owner, a.id)).revision, 2);
  } finally { await db.close(); }
});
test("workspace isolation applies to get, search, history, trash, restore, and parent assignment; viewers cannot write", async () => {
  const { db, service } = await fixture(); const workspace = randomUUID(), user = randomUUID();
  try {
    await db.transaction(async (sql) => {
      await sql.query("INSERT INTO users(id,display_name) VALUES($1,$2)", [user, "Other user"]);
      await sql.query("INSERT INTO workspaces(id,name) VALUES($1,$2)", [workspace, "Other workspace"]);
      await sql.query("INSERT INTO memberships(user_id,workspace_id,role) VALUES($1,$2,$3)", [user, workspace, "owner"]);
      await sql.query("INSERT INTO memberships(user_id,workspace_id,role) VALUES($1,$2,$3)", [user, LOCAL_WORKSPACE_ID, "viewer"]);
    });
    const other = { userId: user, workspaceId: workspace, clientId: "test" };
    const page = await service.create(owner, { title: "Private strawberry", mutationId: mutationId() });
    assert.deepEqual(await service.list(other, { query: "strawberry" }), []);
    for (const work of [() => service.get(other, page.id), () => service.history(other, page.id), () => service.revision(other, page.id, 1), () => service.trash(other, page.id, 1), () => service.restore(other, page.id), () => service.create(other, { parentId: page.id, mutationId: mutationId() })]) {
      await assert.rejects(work(), (e: AppError) => e.status === 404);
    }
    await assert.rejects(service.patch({ userId: user, workspaceId: LOCAL_WORKSPACE_ID, clientId: "test" }, page.id, { title: "Oops", expectedRevision: 1, mutationId: mutationId() }), (e: AppError) => e.status === 403);
    await assert.rejects(service.list({ userId: LOCAL_USER_ID, workspaceId: workspace, clientId: "test" }), (e: AppError) => e.status === 403);
  } finally { await db.close(); }
});
test("trash/restore preserves a subtree without restoring independently trashed children", async () => {
  const { db, service } = await fixture();
  try {
    const root = await service.create(owner, { title: "Root", mutationId: mutationId() });
    const child = await service.create(owner, { title: "Child", parentId: root.id, mutationId: mutationId() });
    const prior = await service.create(owner, { title: "Already trashed", parentId: root.id, mutationId: mutationId() });
    await service.trash(owner, prior.id, 1); await service.trash(owner, root.id, (await service.get(owner, root.id)).revision);
    await assert.rejects(service.get(owner, child.id), (e: AppError) => e.status === 404);
    await assert.rejects(service.restore(owner, child.id), (e: AppError) => e.code === "parent_in_trash");
    await service.restore(owner, root.id);
    assert.equal((await service.get(owner, child.id)).parentId, root.id);
    await assert.rejects(service.get(owner, prior.id), (e: AppError) => e.status === 404);
  } finally { await db.close(); }
});
test("page data survives closing and reopening the database; reseeding does not recreate pages", async () => {
  const folder = await mkdtemp(join(tmpdir(), "raspberry-test-")), url = "file:" + join(folder, "pages.sqlite");
  try {
    const first = await openDatabase(url), one = new RaspberryService(first); await one.seed();
    const page = await one.create(owner, { title: "Persistent idea", mutationId: mutationId() }); await first.close();
    const second = await openDatabase(url), two = new RaspberryService(second); await two.seed();
    assert.equal((await two.get(owner, page.id)).title, "Persistent idea");
    assert.equal((await two.list(owner)).length, 4); await second.close();
  } finally { assert.ok(folder.startsWith(join(tmpdir(), "raspberry-test-"))); await rm(folder, { recursive: true, force: true }); }
});
test("document validation rejects executable links, unknown fields, duplicate IDs and oversized structures", () => {
  const doc = emptyDocument();
  assert.equal(documentSchema.safeParse(doc).success, true);
  assert.equal(documentSchema.safeParse([doc[0], doc[0]]).success, false);
  assert.equal(documentSchema.safeParse([{ ...doc[0], injected: "payload" }]).success, false);
  assert.equal(documentSchema.safeParse([{ ...doc[0], content: [{ type: "link", href: "javascript:alert(1)", content: [] }] }]).success, false);
  assert.equal(documentSchema.safeParse(Array.from({ length: 2001 }, () => ({ ...doc[0], id: randomUUID() }))).success, false);
});
test("a live database backup preserves WAL commits and opens as a recoverable workspace", async () => {
  const folder = await mkdtemp(join(tmpdir(), "raspberry-backup-"));
  const db = await openDatabase("file:" + join(folder, "source.sqlite")), service = new RaspberryService(db); await service.seed();
  try {
    const page = await service.create(owner, { title: "Recover me", mutationId: mutationId() });
    const path = await backupSqlite("file:" + join(folder, "source.sqlite"), join(folder, "backup.sqlite"));
    const restored = await openDatabase("file:" + path);
    try { assert.equal((await new RaspberryService(restored).get(owner, page.id)).title, "Recover me"); }
    finally { await restored.close(); }
    await assert.rejects(backupSqlite("file:" + join(folder, "source.sqlite"), path), /EEXIST/);
  } finally { await db.close(); assert.ok(folder.startsWith(join(tmpdir(), "raspberry-backup-"))); await rm(folder, { recursive: true, force: true }); }
});
test("local access fails closed, rejects DNS rebinding and cross-origin reads/writes", () => {
  const headers = new Headers({ host: "localhost:3000", origin: "http://localhost:3000" });
  assert.equal(localAccessError(headers, "POST", "1"), null);
  assert.notEqual(localAccessError(headers, "GET", "0"), null);
  assert.notEqual(localAccessError(new Headers({ host: "attacker.example:3000" }), "GET", "1"), null);
  assert.notEqual(localAccessError(new Headers({ host: "localhost:3000", origin: "https://attacker.example" }), "GET", "1"), null);
  assert.notEqual(localAccessError(new Headers({ host: "localhost:3000" }), "POST", "1"), null);
  assert.notEqual(localAccessError(headers, "GET", "1", "https://raspberry.example"), null);
});
