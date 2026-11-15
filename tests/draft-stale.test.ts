/* B56 — the "changed elsewhere" notice.
   ---------------------------------------------------------------------------
   The bug this file pins was not found by a unit test. It was found by
   `scripts/verify-live-sync.mjs`, which sampled the save indicator every 200 ms while
   the second client typed, and never once saw it: the notice had been set as a
   `status`, and the person's next keystroke set that status back to `pending` a fifth
   of a second later. A warning that only exists between two keystrokes has not been
   shown to anybody — and a user typing continuously would have met only the `409`.

   So it is a flag (`behind`), and this file asserts the two things a status could not
   promise: it survives an edit, and it is cleared by the only two events that make it
   untrue — an adoption, and a save that succeeds.
   --------------------------------------------------------------------------- */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyDocument, type Page } from "../src/lib/document";

/* `draft-registry` keeps records in a module map only in a browser: during SSR it hands
   back a detached record so two requests cannot share one. These three globals are the
   whole of that requirement, plus a `fetch` that never settles so a scheduled save
   cannot land in the middle of an assertion. */
const scope = globalThis as unknown as { window?: unknown; localStorage?: unknown; addEventListener?: unknown; fetch?: unknown };
scope.window = globalThis;
scope.localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
scope.addEventListener = () => undefined;
scope.fetch = () => new Promise(() => undefined);

const { acquireRecord, adoptRemote, getSnapshot, markStale, updateRecord } = await import("../src/lib/draft-registry");

const pageOf = (overrides: Partial<Page> = {}): Page => ({
  id: randomUUID(), parentId: null, title: "Untitled", icon: "file", favorite: false, revision: 1, position: 0,
  createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), deletedAt: null, wordCount: 0,
  content: emptyDocument(), schemaVersion: 1, ...overrides,
});

const NOTICE = "This page was changed on another device. Your unsaved edits are kept.";

test("the notice survives the next keystroke", () => {
  const record = acquireRecord(pageOf());
  markStale(record.id, NOTICE);
  assert.equal(getSnapshot(record).status, "stale");

  updateRecord(record, { title: "still typing" });
  assert.equal(getSnapshot(record).status, "stale", "an edit must not clear the warning about a version this tab does not have");
  assert.equal(getSnapshot(record).message, NOTICE);
  assert.equal(getSnapshot(record).draft.title, "still typing", "and the local edit is still the draft");
});

test("adopting the server's copy clears it", () => {
  const page = pageOf();
  const record = acquireRecord(page);
  markStale(record.id, NOTICE);
  assert.equal(getSnapshot(record).status, "stale");

  assert.equal(adoptRemote(record.id, { ...page, revision: 5, title: "theirs" }), true);
  const snapshot = getSnapshot(record);
  assert.equal(snapshot.status, "saved");
  assert.equal(snapshot.message, "", "the notice leaves with the condition that raised it");
  assert.equal(snapshot.draft.title, "theirs");
});

test("a dirty record is refused, so the keystrokes stay", () => {
  const page = pageOf();
  const record = acquireRecord(page);
  updateRecord(record, { title: "mine" });

  assert.equal(adoptRemote(record.id, { ...page, revision: 9, title: "theirs" }), false);
  assert.equal(getSnapshot(record).draft.title, "mine");
  assert.equal(getSnapshot(record).status, "pending");
});

test("a stale notice on a page that was never opened is a no-op", () => {
  assert.doesNotThrow(() => markStale(randomUUID(), NOTICE));
  assert.equal(adoptRemote(randomUUID(), pageOf({ revision: 9 })), false);
});
