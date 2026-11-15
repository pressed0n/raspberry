"use client";
/* Raspberry — mounts the live-sync loop (B56)
   ---------------------------------------------------------------------------
   The loop itself is in `src/lib/live-sync.ts` and knows nothing about React; this
   is only the wiring: the browser's clock, the session-aware `request` (so a 401
   sends the tab to `/login` like every other read), and the two window events that
   matter.

   `focus`/`visibilitychange` are both handled, because a tab can become visible
   without being focused (another window in front of it is closed) and focused
   without becoming visible. `poke` is idempotent, so the duplicate event costs one
   extra request at most, which is cheaper than the alternative — a tab that looks
   current and is not.

   The callbacks are read through a ref on every call rather than captured: they
   close over the current page list, the current tabs and the current records, and
   an effect that re-ran on every one of those would start and stop the loop
   constantly. Re-reading them at call time is what keeps `[]` deps honest here.
   --------------------------------------------------------------------------- */
import { useEffect, useRef } from "react";
import { request } from "@/lib/api-client";
import { browserScheduler, createLiveSync, type SyncDeps } from "@/lib/live-sync";
import { type SyncStamp } from "@/lib/sync-stamp";
import type { PageSummary } from "@/lib/document";

/** What `GET /api/sync` answers: the digest plus the tabs' current summaries. */
type SyncResponse = { stamp: SyncStamp; pages: PageSummary[] };

export type LiveSyncWiring = Pick<SyncDeps, "watch" | "busy" | "onPages" | "onCollection" | "onDatabases">;

export function useLiveSync(wiring: LiveSyncWiring): void {
  const latest = useRef(wiring);
  latest.current = wiring;

  useEffect(() => {
    const sync = createLiveSync({
      ...browserScheduler,
      read: async (watch) => request<SyncResponse>(
        `/api/sync${watch.length ? `?watch=${encodeURIComponent(watch.join(","))}` : ""}`,
      ),
      watch: () => latest.current.watch(),
      busy: () => latest.current.busy(),
      onPages: (pages, diff) => latest.current.onPages(pages, diff),
      onCollection: () => latest.current.onCollection(),
      onDatabases: () => latest.current.onDatabases(),
    });
    sync.start();
    const poke = () => sync.poke();
    const onVisibility = () => { if (document.visibilityState === "visible") sync.poke(); };
    window.addEventListener("focus", poke);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", poke);
      document.removeEventListener("visibilitychange", onVisibility);
      sync.stop();
    };
  }, []);
}
