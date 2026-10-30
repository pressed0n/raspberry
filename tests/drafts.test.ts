import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPageLink, emptyDocument, type Page } from "../src/lib/document";
import { MAX_SAVE_ROUNDS, adoptedAppend, edited, hasUnsavedChanges, initialSync, runSaveLoop, type Draft, type Payload, type SyncState } from "../src/lib/draft-sync";

const pageOf = (overrides: Partial<Page> = {}): Page => ({ id: randomUUID(), parentId: null, title: "Untitled", icon: "file", favorite: false, revision: 1, position: 0, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), deletedAt: null, wordCount: 0, content: emptyDocument(), schemaVersion: 1, ...overrides });
const echo = (initial: Page, payload: Payload, overrides: Partial<Page> = {}): Page => ({ ...initial, title: payload.title, icon: payload.icon, content: payload.content, favorite: payload.favorite, revision: payload.expectedRevision + 1, ...overrides });
/** A live state holder standing in for the hook's ref. */
function host(page: Page) {
  let state: SyncState = initialSync(page);
  return {
    io: { get: () => state, set: (next: SyncState) => { state = next; } },
    edit: (changes: Partial<Draft>) => { state = edited(state, changes); },
    read: () => state,
  };
}

test("an unchanged page sends nothing", async () => {
  const initial = pageOf(), local = host(initial);
  let sends = 0;
  const result = await runSaveLoop(local.io, async (payload) => { sends++; return echo(initial, payload); });
  assert.equal(result.outcome, "saved");
  assert.equal(sends, 0);
});

test("a server that normalises a field settles after a single save", async () => {
  const initial = pageOf({ title: "Untitled" }), local = host(initial);
  local.edit({ title: "" });
  const sent: string[] = [];
  const result = await runSaveLoop(local.io, async (payload) => {
    sent.push(payload.title);
    // The server stores "Untitled" for an empty title; the old JSON equality check
    // could never confirm that against what the editor held.
    return echo(initial, payload, { title: "Untitled" });
  });
  assert.equal(result.outcome, "saved");
  assert.equal(sent.length, 1);
  assert.equal(local.read().latest.title, "Untitled");
  assert.equal(hasUnsavedChanges(local.read()), false);
});

test("a payload overtaken by a newer edit is rebuilt under a new identifier", async () => {
  const initial = pageOf(), local = host(initial);
  local.edit({ title: "one" });
  const identifiers: string[] = [];
  const result = await runSaveLoop(local.io, async (payload) => {
    identifiers.push(payload.mutationId);
    if (identifiers.length === 1) local.edit({ title: "two" });
    return echo(initial, payload);
  });
  assert.equal(result.outcome, "saved");
  assert.equal(identifiers.length, 2);
  assert.notEqual(identifiers[0], identifiers[1]);
  assert.equal(local.read().latest.title, "two");
});

test("a stale server copy never overwrites text typed during the request", async () => {
  const initial = pageOf(), local = host(initial);
  local.edit({ title: "one" });
  let raced = false;
  const result = await runSaveLoop(local.io, async (payload) => {
    if (!raced) { raced = true; local.edit({ title: "two" }); }
    return echo(initial, payload, { title: payload.title === "one" ? "Normalised" : payload.title });
  });
  assert.equal(result.outcome, "saved");
  assert.equal(local.read().latest.title, "two");
});

test("edits that keep racing a save stop at the round cap", async () => {
  const initial = pageOf(), local = host(initial);
  local.edit({ title: "start" });
  let sends = 0;
  const result = await runSaveLoop(local.io, async (payload) => {
    sends++;
    local.edit({ title: `typing ${sends}` });
    return echo(initial, payload);
  });
  assert.equal(result.outcome, "stuck");
  assert.equal(sends, MAX_SAVE_ROUNDS);
  assert.equal(hasUnsavedChanges(local.read()), true);
});

test("a failed save keeps its identifier so an identical retry stays idempotent", async () => {
  const initial = pageOf(), local = host(initial);
  local.edit({ title: "one" });
  const identifiers: string[] = [];
  const first = await runSaveLoop(local.io, async (payload) => { identifiers.push(payload.mutationId); throw new Error("offline"); });
  assert.equal(first.outcome, "error");
  assert.equal(hasUnsavedChanges(local.read()), true);
  const second = await runSaveLoop(local.io, async (payload) => { identifiers.push(payload.mutationId); return echo(initial, payload); });
  assert.equal(second.outcome, "saved");
  assert.equal(identifiers.length, 2);
  assert.equal(identifiers[0], identifiers[1], "the retry reuses the identifier of the same logical change");
});

test("a conflict is reported without discarding the draft", async () => {
  const initial = pageOf(), local = host(initial);
  local.edit({ title: "one" });
  const result = await runSaveLoop(local.io, async () => { throw Object.assign(new Error("This page changed."), { status: 409 }); });
  assert.equal(result.outcome, "conflict");
  assert.equal(hasUnsavedChanges(local.read()), true);
  assert.equal(local.read().latest.title, "one");
});

/* Nesting a page writes two things: `parent_id` for the tree, and a pageLink block
   appended to the parent's content for the page itself. The block is the half an open
   parent never hears about, so these four are about the parent's record, not the child. */

const withChild = (parent: Page, title = "Child"): Page => ({
  ...parent,
  revision: parent.revision + 1,
  content: [...parent.content, createPageLink({ id: randomUUID(), title }, "child")],
});

test("a child linked into a clean parent is adopted, and nothing is written back", async () => {
  const parent = pageOf(), local = host(parent);
  const fresh = withChild(parent);
  const adopted = adoptedAppend(local.read(), fresh);
  assert.ok(adopted);
  local.io.set(adopted);
  assert.equal(local.read().latest.content.length, 2, "the page now holds the child");
  assert.equal(local.read().persisted.revision, 2, "the base revision moves with it");
  assert.equal(hasUnsavedChanges(local.read()), false);
  let sends = 0;
  const result = await runSaveLoop(local.io, async (payload) => { sends++; return echo(parent, payload); });
  assert.equal(result.outcome, "saved");
  assert.equal(sends, 0, "an adoption is not an edit");
});

test("a child linked into a parent being edited arrives without the edit being lost", async () => {
  const parent = pageOf(), local = host(parent);
  local.edit({ content: [...parent.content, { ...parent.content[0], id: randomUUID(), content: [{ type: "text", text: "half a sentence", styles: {} }] }] as Page["content"] });
  const adopted = adoptedAppend(local.read(), withChild(parent));
  assert.ok(adopted);
  local.io.set(adopted);
  const sent: Payload[] = [];
  const result = await runSaveLoop(local.io, async (payload) => { sent.push(payload); return echo(parent, payload, { revision: 3 }); });
  assert.equal(result.outcome, "saved");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].expectedRevision, 2, "the save is rebased on the appended copy, not the one before it");
  assert.equal(sent[0].content.length, 3, "the sentence and the child are both written");
  assert.equal(sent[0].content.at(-1)?.type, "pageLink");
});

test("a page that changed some other way is left to the conflict path", async () => {
  const parent = pageOf(), local = host(parent);
  const rewritten = { ...parent, revision: 2, content: [{ ...parent.content[0], id: randomUUID() }] };
  assert.equal(adoptedAppend(local.read(), rewritten), null, "an append is a tail on the document already saved, not a rewrite of it");
  assert.equal(adoptedAppend(local.read(), { ...parent, revision: 2 }), null, "an unchanged document is not an append");
});

test("a save answered after an adoption does not roll the base revision back", async () => {
  const parent = pageOf(), local = host(parent);
  local.edit({ title: "typing" });
  const expected: number[] = [];
  let rounds = 0;
  const result = await runSaveLoop(local.io, async (payload) => {
    expected.push(payload.expectedRevision);
    if (rounds++ > 0) return echo(parent, payload, { revision: payload.expectedRevision + 1 });
    // This round committed at revision 2, and the child's link was appended on top of
    // it (revision 3) before the answer arrived. That answer is now behind the record.
    const committed = echo(parent, payload);
    const adopted = adoptedAppend(local.read(), withChild(committed));
    assert.ok(adopted);
    local.io.set(adopted);
    return committed;
  });
  assert.equal(result.outcome, "saved");
  assert.deepEqual(expected, [1, 3], "the stale answer is dropped and the save is rebuilt on the adopted revision");
  assert.equal(local.read().persisted.revision, 4);
  assert.equal(local.read().latest.content.length, 2, "and the child is still on the page");
});
