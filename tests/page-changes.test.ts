import assert from "node:assert/strict";
import { test } from "node:test";
import { livePagesChanged, onLivePagesChanged } from "../src/lib/page-changes";

/* The browser suite `scripts/cdp-db-restore.mjs` is the guard that matters for this module
   — it restores a trashed entry and asserts the table updates without a reload, and it
   fails when `livePagesChanged` goes quiet. These pin the plumbing underneath it. */

test("every subscriber hears it", () => {
  let a = 0;
  let b = 0;
  const offA = onLivePagesChanged(() => { a += 1; });
  const offB = onLivePagesChanged(() => { b += 1; });
  livePagesChanged();
  offA();
  offB();
  assert.equal(a, 1);
  assert.equal(b, 1);
});

test("the unsubscribe that comes back is the one that works", () => {
  let heard = 0;
  const off = onLivePagesChanged(() => { heard += 1; });
  livePagesChanged();
  off();
  livePagesChanged();
  assert.equal(heard, 1, "a removed listener must not be called again");
});

test("a listener that unsubscribes while being told does not break the others", () => {
  /* The emitter iterates a copy for exactly this: a component unmounting inside a handler
     would otherwise mutate the set under the loop and skip a sibling. */
  const order: string[] = [];
  const offFirst = onLivePagesChanged(() => { order.push("first"); offFirst(); });
  const offSecond = onLivePagesChanged(() => { order.push("second"); });
  livePagesChanged();
  livePagesChanged();
  offSecond();
  assert.deepEqual(order, ["first", "second", "second"]);
});
