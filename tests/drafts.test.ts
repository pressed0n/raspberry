import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyDocument, type Page } from "../src/lib/document";
import { MAX_SAVE_ROUNDS, edited, hasUnsavedChanges, initialSync, runSaveLoop, type Draft, type Payload, type SyncState } from "../src/lib/draft-sync";

const pageOf = (overrides: Partial<Page> = {}): Page => ({ id: randomUUID(), parentId: null, title: "Untitled", icon: "file", favorite: false, revision: 1, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), deletedAt: null, wordCount: 0, content: emptyDocument(), schemaVersion: 1, ...overrides });
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
