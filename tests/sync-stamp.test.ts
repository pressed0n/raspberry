/* B56 — reading a change digest. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { diffStamp, tokenOf, type SyncStamp } from "../src/lib/sync-stamp";

const stampOf = (overrides: Partial<SyncStamp> = {}): SyncStamp => ({
  pages: { total: 10, live: 8, revisions: 30 },
  databases: { total: 2, revisions: 5 },
  writes: 100,
  ...overrides,
});

test("the first answer of a session is acted on, not assumed current", () => {
  /* A tab that opens after a change happened elsewhere must not decide the tree it
     was handed is up to date. */
  assert.deepEqual(diffStamp(null, stampOf()), { pages: true, databases: true, collection: true });
});

test("an unchanged digest reports nothing at all", () => {
  assert.deepEqual(diffStamp(stampOf(), stampOf()), { pages: false, databases: false, collection: false });
});

test("an edit reconciles the tabs and leaves the list alone", () => {
  const diff = diffStamp(stampOf(), stampOf({ pages: { total: 10, live: 8, revisions: 31 } }));
  assert.equal(diff.pages, true);
  assert.equal(diff.collection, false, "the page set did not move, so re-reading the list would teach nothing");
  assert.equal(diff.databases, false);
});

test("trashing a page moves the live count, so the list is re-read", () => {
  const diff = diffStamp(stampOf(), stampOf({ pages: { total: 10, live: 7, revisions: 31 } }));
  assert.equal(diff.collection, true);
  assert.equal(diff.pages, true);
});

test("purging a page moves the total, so the list is re-read", () => {
  const diff = diffStamp(stampOf(), stampOf({ pages: { total: 9, live: 8, revisions: 30 } }));
  assert.equal(diff.collection, true);
});

test("a receipted write with no revision bump still re-reads open databases", () => {
  /* The cell path records a receipt and touches neither `databases.revision` nor
     `pages.revision`; this is the only wire the digest has to it. */
  assert.deepEqual(diffStamp(stampOf(), stampOf({ writes: 101 })), { pages: false, databases: true, collection: false });
});

test("adding a database re-reads the open ones", () => {
  const diff = diffStamp(stampOf(), stampOf({ databases: { total: 3, revisions: 5 } }));
  assert.equal(diff.databases, true);
});

test("the token separates fields that mean different things", () => {
  assert.notEqual(tokenOf(stampOf()), tokenOf(stampOf({ pages: { total: 10, live: 8, revisions: 31 } })));
  assert.notEqual(tokenOf(stampOf()), tokenOf(stampOf({ writes: 101 })));
  assert.equal(tokenOf(stampOf()), tokenOf(stampOf()), "equality is the only operation performed on it");
});
