/* Raspberry — the live-sync loop (B56)
   ---------------------------------------------------------------------------
   Notion shows another device's edit in a second or two. Raspberry showed it on
   the next manual reload, i.e. never. This is the difference: one request a
   second, answered by `src/server/sync.ts`, and a re-read of the two things that
   can be stale — the open tabs and the page list.

   Why polling and not a socket: every process in the hosted shape is a
   serverless function, and a function cannot hold a connection open. An SSE
   endpoint would hold one instance per open tab for as long as the tab lives,
   and a `LISTEN`/`NOTIFY` feed would need a direct (unpooled) PostgreSQL
   connection per tab as well. At two people this is the cheaper, more reliable
   trade, and — the reason it is *this* trade — it is the only one that runs in
   `file::memory:` too, so the whole suite exercises the same code path the
   deployment uses instead of a branch that only exists in production.

   Everything here is injected rather than reached for: the clock, the timer, the
   visibility test and the request. A loop that sleeps a real second between
   steps cannot be tested for what it does *between* steps, and that is the only
   interesting part of it.

   Three rules it must not break:

     - A failed poll is not an error the user sees. Typing during a blip must not
       produce a banner; the next tick retries.
     - One request at a time. A slow answer must not stack a queue of them, which
       is what makes a slow connection double every second.
     - A hidden tab stops asking. It catches up on the first tick after it is
       visible again, because `poke` re-runs immediately rather than waiting out
       the interval.
   --------------------------------------------------------------------------- */
import type { PageSummary } from "./document";
import { diffStamp, type StampDiff, type SyncStamp } from "./sync-stamp";

/** One second: below the threshold where an edit feels like it "appeared". */
export const POLL_MS = 1000;

/**
 * How often the *list* may be re-read because of content changes alone.
 *
 * The digest cannot tell whose write moved it, so a client that is typing sees
 * its own saves arrive back. Re-reading a 200-page list once a second to learn
 * nothing would be the cost of not knowing; this floor keeps the sidebar's names
 * fresh within a few seconds while making the steady-state cost of typing zero.
 * A change to the page *set* ignores the floor — a tab for a page someone just
 * trashed has to close promptly.
 */
export const LIST_FLOOR_MS = 5000;

export type SyncAnswer = { stamp: SyncStamp; pages: PageSummary[] };

export type SyncDeps = {
  read: (watch: string[]) => Promise<SyncAnswer>;
  watch: () => string[];
  /** True while this client has a save in flight. Its own echo is not news. */
  busy: () => boolean;
  /** Summaries for the pages named by `watch`, in whatever state they are now. */
  onPages: (pages: PageSummary[], diff: StampDiff) => void;
  /** Re-read the page list (what the sidebar and the tab strip draw). */
  onCollection: () => Promise<unknown> | unknown;
  /** Re-read every open database block. */
  onDatabases: () => void;
  now: () => number;
  schedule: (work: () => void, ms: number) => unknown;
  cancel: (handle: unknown) => void;
  hidden: () => boolean;
  pollMs?: number;
  listFloorMs?: number;
};

export type LiveSync = { start: () => void; stop: () => void; poke: () => void; baseline: () => SyncStamp | null };

export function createLiveSync(deps: SyncDeps): LiveSync {
  const pollMs = deps.pollMs ?? POLL_MS;
  const listFloorMs = deps.listFloorMs ?? LIST_FLOOR_MS;

  let running = false;
  let timer: unknown = null;
  let reading = false;
  let listRefreshing = false;
  /* The digest this client has acted on. `null` means "nothing acted on yet", and
     that is deliberately not "assume current" — see `diffStamp`. */
  let seen: SyncStamp | null = null;
  let listDue = false;
  let listedAt = 0;

  function arm(): void {
    if (!running) return;
    if (timer !== null) deps.cancel(timer);
    timer = deps.schedule(() => { void tick(); }, pollMs);
  }

  async function refreshList(): Promise<void> {
    if (listRefreshing) return;
    listRefreshing = true;
    listDue = false;
    /* Stamped before the call: a list read that throws would otherwise leave the
       floor at zero and make every subsequent tick retry it, turning one failing
       endpoint into a request per second. */
    listedAt = deps.now();
    try { await deps.onCollection(); } catch { /* The next change re-reads it. */ }
    finally { listRefreshing = false; }
  }

  async function tick(): Promise<void> {
    timer = null;
    if (!running) return;
    /* Hidden means paused, so no timer is armed and nothing is asked. `poke` from
       the visibility listener is what restarts it. */
    if (deps.hidden()) return;
    if (reading) { arm(); return; }
    reading = true;
    try {
      const answer = await deps.read(deps.watch());
      const diff = diffStamp(seen, answer.stamp);
      if (diff.pages || diff.collection || diff.databases) {
        /* Recorded before the callbacks run: a callback that throws must not make
           the loop report the same change again on the next tick forever. */
        seen = answer.stamp;
        if (diff.pages) deps.onPages(answer.pages, diff);
        if (diff.databases) deps.onDatabases();
        if (diff.collection) void refreshList();
        else listDue = true;
      }
      if (listDue && !deps.busy() && deps.now() - listedAt >= listFloorMs) void refreshList();
    } catch {
      /* A poll that fails is not a save that failed. Nothing is surfaced, and the
         next tick asks again — `seen` is untouched, so a change that happened
         during the blip is still reported when the request succeeds. */
    } finally {
      reading = false;
      if (!deps.hidden()) arm();
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      void tick();
    },
    stop() {
      running = false;
      if (timer !== null) { deps.cancel(timer); timer = null; }
    },
    /* Asks now instead of at the next interval: after this client writes, and when
       a hidden tab becomes visible again. */
    poke() {
      if (!running || reading) return;
      if (deps.hidden()) return;
      if (timer !== null) { deps.cancel(timer); timer = null; }
      void tick();
    },
    baseline: () => seen,
  };
}

/* The real clock and timer, kept here so the loop's tests never touch them. */
export const browserScheduler = {
  now: () => Date.now(),
  schedule: (work: () => void, ms: number) => setTimeout(work, ms),
  cancel: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  hidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
};
