/* B56 — the live-sync loop.
   ---------------------------------------------------------------------------
   Every dependency is injected, so this file tests the things that are impossible
   to see from the outside: that a hidden tab arms no timer, that a poke during a
   request does not start a second one, that a failed poll does not advance the
   baseline (or the change it missed would be lost for good), and that an edit and a
   new page are treated differently because they cost different reads.
   --------------------------------------------------------------------------- */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLiveSync, type SyncAnswer, type SyncDeps } from "../src/lib/live-sync";
import type { SyncStamp } from "../src/lib/sync-stamp";

const stampOf = (overrides: Partial<SyncStamp> = {}): SyncStamp => ({
  pages: { total: 10, live: 8, revisions: 30 },
  databases: { total: 2, revisions: 5 },
  writes: 100,
  ...overrides,
});

const answer = (overrides: Partial<SyncStamp> = {}): SyncAnswer => ({ stamp: stampOf(overrides), pages: [] });

/** Runs pending microtasks and one macrotask: how an async `tick` completes without
    a test waiting a real second for it. */
const settle = () => new Promise<void>((resolve) => { setImmediate(resolve); });

function rig(answers: SyncAnswer[] = [answer()], overrides: Partial<SyncDeps> = {}) {
  let clock = 0;
  let index = 0;
  let next = 1;
  const queue = new Map<number, () => void>();
  const log = { reads: [] as string[][], pages: 0, lists: 0, databases: 0 };
  const deps: SyncDeps = {
    read: async (watch) => {
      log.reads.push(watch);
      const value = answers[Math.min(index, answers.length - 1)];
      index += 1;
      return value ?? answer();
    },
    watch: () => ["tab-1"],
    busy: () => false,
    onPages: () => { log.pages += 1; },
    onCollection: () => { log.lists += 1; },
    onDatabases: () => { log.databases += 1; },
    now: () => clock,
    schedule: (work) => { const id = next++; queue.set(id, work); return id; },
    cancel: (handle) => { queue.delete(handle as number); },
    hidden: () => false,
    pollMs: 1000,
    listFloorMs: 5000,
    ...overrides,
  };
  return {
    deps,
    log,
    /** How many polls are armed. Zero means the loop is asleep or stopped. */
    pending: () => queue.size,
    setClock: (value: number) => { clock = value; },
    /** Fires the armed poll, the way one interval elapsing would. */
    async fire() {
      const entry = [...queue.entries()][0];
      if (!entry) return false;
      queue.delete(entry[0]);
      entry[1]();
      await settle(); await settle();
      return true;
    },
  };
}

test("the first answer is acted on, and the next poll is armed", async () => {
  const r = rig();
  const sync = createLiveSync(r.deps);
  sync.start();
  await settle(); await settle();

  assert.deepEqual(r.log.reads, [["tab-1"]], "the open tabs are named so their summaries come back");
  assert.equal(r.log.pages, 1);
  assert.equal(r.log.lists, 1, "a session's first answer is never assumed to be current");
  assert.equal(r.log.databases, 1);
  assert.equal(r.pending(), 1);
  sync.stop();
});

test("stop cancels the armed poll", async () => {
  const r = rig();
  const sync = createLiveSync(r.deps);
  sync.start();
  await settle(); await settle();
  assert.equal(r.pending(), 1);
  sync.stop();
  assert.equal(r.pending(), 0);
  assert.equal(await r.fire(), false, "nothing is left to fire");
});

test("an unchanged digest keeps asking without reporting anything", async () => {
  const r = rig([answer(), answer()]);
  const sync = createLiveSync(r.deps);
  sync.start();
  await settle(); await settle();
  const before = { pages: r.log.pages, lists: r.log.lists, databases: r.log.databases };

  assert.equal(await r.fire(), true);
  assert.deepEqual(
    { pages: r.log.pages, lists: r.log.lists, databases: r.log.databases },
    before,
    "an unchanged workspace causes no reads at all",
  );
  assert.equal(r.log.reads.length, 2, "but it is still polling");
  sync.stop();
});

test("a hidden tab costs nothing, and a visible one catches up immediately", async () => {
  let hidden = true;
  const r = rig([answer()], { hidden: () => hidden });
  const sync = createLiveSync(r.deps);
  sync.start();
  await settle(); await settle();

  assert.equal(r.log.reads.length, 0, "a hidden tab asks nothing");
  assert.equal(r.pending(), 0, "and arms nothing, so it cannot wake itself up");

  hidden = false;
  sync.poke();
  await settle(); await settle();
  assert.equal(r.log.reads.length, 1, "becoming visible polls at once rather than waiting out the interval");
  assert.equal(r.pending(), 1);
  sync.stop();
});

test("a slow request is not stacked into a second one", async () => {
  const r = rig();
  let reads = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const deps: SyncDeps = { ...r.deps, read: async () => { reads += 1; await gate; return answer(); } };
  const sync = createLiveSync(deps);
  sync.start();
  await settle();
  assert.equal(reads, 1);

  sync.poke();
  await settle();
  assert.equal(reads, 1, "a poke during a request is dropped, not queued behind it");

  release?.();
  await settle(); await settle();
  assert.equal(r.pending(), 1, "the loop is armed again once the answer lands");
  sync.stop();
});

test("a failed poll is silent, and the change it missed is reported next time", async () => {
  const r = rig();
  let attempt = 0;
  const deps: SyncDeps = {
    ...r.deps,
    read: async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("offline");
      return answer({ pages: { total: 10, live: 8, revisions: 31 } });
    },
  };
  const sync = createLiveSync(deps);
  sync.start();
  await settle(); await settle();

  assert.equal(r.log.pages, 0, "a blip is not surfaced to the person typing");
  assert.equal(r.pending(), 1, "and polling continues");
  await r.fire();
  assert.equal(attempt, 2);
  assert.equal(r.log.pages, 1, "the baseline was never advanced past the failed poll, so nothing was lost");
  sync.stop();
});

test("an edit holds the list back until the floor passes; a new page does not", async () => {
  const r = rig([
    answer(),
    answer({ pages: { total: 10, live: 8, revisions: 31 } }),
    answer({ pages: { total: 10, live: 8, revisions: 31 } }),
    answer({ pages: { total: 11, live: 9, revisions: 32 } }),
  ]);
  const sync = createLiveSync(r.deps);
  sync.start();
  await settle(); await settle();
  assert.equal(r.log.lists, 1);

  await r.fire();
  assert.equal(r.log.pages, 2, "an edit reconciles the open tabs");
  assert.equal(r.log.lists, 1, "but does not re-read the list on every keystroke's save");

  r.setClock(6000);
  await r.fire();
  assert.equal(r.log.lists, 2, "the deferred list read happens once the floor has passed");

  await r.fire();
  assert.equal(r.log.lists, 3, "a page added elsewhere ignores the floor: its row has to appear");
  sync.stop();
});

test("a save in flight holds the deferred list read back", async () => {
  let busy = false;
  const r = rig([
    answer(),
    answer({ pages: { total: 10, live: 8, revisions: 31 } }),
    answer({ pages: { total: 10, live: 8, revisions: 31 } }),
  ], { busy: () => busy });
  const sync = createLiveSync(r.deps);
  sync.start();
  await settle(); await settle();

  busy = true;
  r.setClock(9000);
  await r.fire();
  assert.equal(r.log.lists, 1, "this client's own save is not worth a list read");

  busy = false;
  r.setClock(12000);
  await r.fire();
  assert.equal(r.log.lists, 2, "the deferred read is not forgotten, it is postponed");
  sync.stop();
});
