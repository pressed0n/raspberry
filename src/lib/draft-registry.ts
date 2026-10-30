"use client";
/* Raspberry — per-page draft records (B22)
   ---------------------------------------------------------------------------
   A page's unsaved work used to live inside `usePageDraft`, which meant it died
   with the component. That was fine while one page was open at a time: switching
   pages remounted the editor and the draft came back from `localStorage`, with a
   "Recovered your unsaved draft." flash and the pending 700ms save timer thrown
   away.

   With tabs, switching is a constant operation, so that path has to be cheap and
   quiet. The state for each open page now lives in a record that outlives the
   editor mount. A record is created the first time a tab is activated, kept
   while the tab is open, and disposed when the tab closes.

   The save semantics are unchanged — `edited`, `runSaveLoop`, `selectDraft`,
   `recovered` and `initialSync` in `draft-sync.ts` are the same functions, called
   the same way. If you are tempted to "simplify" this back into the hook, the
   thing you would lose is the debounced save surviving a tab switch, and the
   recovery flash coming back on every switch.

   Deliberately NOT preserved across a tab switch: undo history (the editor
   genuinely unmounts). Scroll position is captured and restored by hand.
   --------------------------------------------------------------------------- */
import { request } from "./api-client";
import { patchPageSchema, type Page } from "./document";
import { adoptedAppend, edited, hasUnsavedChanges, initialSync, recovered, runSaveLoop, selectDraft, type Draft, type SyncState } from "./draft-sync";

export type DraftStatus = "saved" | "pending" | "saving" | "error" | "conflict";

export type DraftSnapshot = {
  draft: Draft;
  status: DraftStatus;
  message: string;
  contentVersion: number;
  scrollTop: number;
  /** Edits the server has not confirmed. Drives the dot on an inactive tab. */
  dirty: boolean;
};

export type DraftRecord = {
  id: string;
  sync: SyncState;
  status: DraftStatus;
  message: string;
  contentVersion: number;
  scrollTop: number;
  snapshot: DraftSnapshot;
  blocked: boolean;
  running: Promise<boolean> | null;
  timer: ReturnType<typeof setTimeout> | null;
  listeners: Set<() => void>;
};

const SAVE_DEBOUNCE_MS = 700;

/** Records for pages that currently have a tab. Keyed by page id. */
const records = new Map<string, DraftRecord>();

const storageKey = (id: string) => `raspberry:draft:${id}`;

function snapshotOf(record: DraftRecord): DraftSnapshot {
  return {
    draft: record.sync.latest,
    status: record.status,
    message: record.message,
    contentVersion: record.contentVersion,
    scrollTop: record.scrollTop,
    dirty: hasUnsavedChanges(record.sync),
  };
}

function publish(record: DraftRecord): void {
  record.snapshot = snapshotOf(record);
  record.listeners.forEach((listener) => listener());
}

/** Assigns then publishes, so a snapshot is never observably half-updated. */
function patch(record: DraftRecord, changes: Partial<Pick<DraftRecord, "status" | "message" | "contentVersion" | "scrollTop">>): void {
  Object.assign(record, changes);
  publish(record);
}

function keepDraft(record: DraftRecord): void {
  try {
    localStorage.setItem(storageKey(record.id), JSON.stringify({
      baseRevision: record.sync.persisted.revision,
      draft: record.sync.latest,
    }));
  } catch { /* Server retry remains available if browser storage is full or disabled. */ }
}

export function clearRecovery(id: string): void {
  try { localStorage.removeItem(storageKey(id)); } catch { /* Nothing to clear. */ }
}

/**
 * Restores an unsaved draft left behind by a previous session. Runs once, when
 * the record is created — the old hook re-ran this whenever the server revision
 * changed, which was always a no-op because a successful save clears the record.
 */
function recover(record: DraftRecord, initial: Page): void {
  let value: { baseRevision?: unknown; draft?: unknown };
  try {
    const raw = localStorage.getItem(storageKey(record.id));
    if (!raw) return;
    value = JSON.parse(raw);
  } catch { return; }

  const restored = { ...selectDraft(initial), ...(value.draft as object | undefined) };
  if (!patchPageSchema.safeParse({ ...restored, expectedRevision: value.baseRevision, mutationId: crypto.randomUUID() }).success) return;

  record.sync = recovered(record.sync, restored);
  record.contentVersion += 1;
  if (value.baseRevision !== initial.revision) {
    record.blocked = true;
    record.status = "conflict";
    record.message = "A recovered draft differs from the saved version. Download it or load the saved page.";
  } else {
    record.status = "pending";
    record.message = "Recovered your unsaved draft.";
  }
  publish(record);
}

let unloadGuardInstalled = false;

/** One listener for the whole app, warning if any open tab has unconfirmed edits. */
function installUnloadGuard(): void {
  if (unloadGuardInstalled || typeof window === "undefined") return;
  unloadGuardInstalled = true;
  window.addEventListener("beforeunload", (event) => {
    for (const record of records.values()) {
      if (!hasUnsavedChanges(record.sync)) continue;
      keepDraft(record);
      event.preventDefault();
      return;
    }
  });
}

/**
 * Returns the record for a page, creating it on first use. Records are only
 * created for pages that have an open tab, so a long session does not accumulate
 * state for every page ever visited.
 */
export function acquireRecord(initial: Page): DraftRecord {
  const existing = records.get(initial.id);
  if (existing) return existing;

  const record: DraftRecord = {
    id: initial.id,
    sync: initialSync(initial),
    status: "saved",
    message: "",
    contentVersion: 0,
    scrollTop: 0,
    snapshot: null as unknown as DraftSnapshot, // replaced by publish() below
    blocked: false,
    running: null,
    timer: null,
    listeners: new Set(),
  };
  record.snapshot = snapshotOf(record);

  // `usePageDraft` is called from a server-rendered client component, so this
  // runs during SSR too. A detached record keeps a server render from writing
  // into — and leaking between requests through — the module-level map.
  if (typeof window === "undefined") return record;

  records.set(initial.id, record);
  installUnloadGuard();
  recover(record, initial);
  return record;
}

export const getRecord = (id: string): DraftRecord | undefined => records.get(id);

export function subscribe(record: DraftRecord, listener: () => void): () => void {
  record.listeners.add(listener);
  return () => { record.listeners.delete(listener); };
}

export const getSnapshot = (record: DraftRecord): DraftSnapshot => record.snapshot;

function schedule(record: DraftRecord): void {
  if (record.timer) clearTimeout(record.timer);
  record.timer = setTimeout(() => {
    record.timer = null;
    void flushRecord(record);
  }, SAVE_DEBOUNCE_MS);
}

export function updateRecord(record: DraftRecord, changes: Partial<Draft>): void {
  record.sync = edited(record.sync, changes);
  keepDraft(record);
  if (record.blocked) {
    // Nothing can be sent while a conflict is unresolved (the user has to load
    // the saved page or take the draft). Keep the edits, stop pretending to save.
    publish(record);
    return;
  }
  record.status = "pending";
  publish(record);
  schedule(record);
}

export function setScroll(record: DraftRecord, scrollTop: number): void {
  // Not published: nothing renders from scrollTop, and publishing on every
  // scroll event would notify every subscriber of this record's tab.
  record.scrollTop = scrollTop;
}

export function replaceRecord(record: DraftRecord, changes: Partial<Draft>): void {
  updateRecord(record, changes);
  patch(record, { contentVersion: record.contentVersion + 1 });
}

export function clearRecordRecovery(record: DraftRecord): void {
  clearRecovery(record.id);
}

/** Saves now. Concurrent callers share the in-flight promise. */
export function flushRecord(record: DraftRecord): Promise<boolean> {
  if (record.timer) { clearTimeout(record.timer); record.timer = null; }
  if (record.running) return record.running;
  if (record.blocked) return Promise.resolve(false);

  const work = async (): Promise<boolean> => {
    const before = record.sync.persisted;
    const { outcome, error } = await runSaveLoop(
      { get: () => record.sync, set: (next) => { record.sync = next; publish(record); } },
      async (payload) => {
        patch(record, { status: "saving" });
        const { page } = await request<{ page: Page }>(`/api/pages/${record.id}`, { method: "PATCH", body: JSON.stringify(payload) });
        return page;
      },
    );

    /* Notify on the success path too. This call used to exist only after the
       failure branch below, so a save could succeed — status flips to "Saved",
       the server has the new title — while the sidebar, the tab strip and the
       breadcrumb kept the old one. That is the whole bug behind "the page name
       and the page title are not linked any more": nothing was propagating a
       successful save back into the workspace's page list. */
    const announce = () => {
      if (record.sync.persisted !== before) notifySaved(record);
    };

    if (outcome === "saved") {
      clearRecovery(record.id);
      patch(record, { status: "saved", message: "" });
      announce();
      return true;
    }

    keepDraft(record);
    patch(record, {
      status: outcome === "conflict" ? "conflict" : "error",
      // "stuck" means saving kept losing races with local edits. Say so rather
      // than leaving the indicator on "saving" while the loop retries forever.
      message: outcome === "stuck" ? "Saving keeps returning a different version of this page. Your draft is kept on this device."
        : error instanceof Error ? error.message : "Unable to save. Your draft is kept on this device.",
    });
    if (outcome === "conflict") record.blocked = true;
    announce();
    return false;
  };

  record.running = work().finally(() => { record.running = null; });
  return record.running;
}

/* `onSaved` lives on the record rather than being passed to flushRecord so that
   a save finishing after the tab was switched away still updates the sidebar. */
const savedHandlers = new Map<string, (page: Page) => void>();

export function setSavedHandler(id: string, handler: ((page: Page) => void) | null): void {
  if (handler) savedHandlers.set(id, handler); else savedHandlers.delete(id);
}

function notifySaved(record: DraftRecord): void {
  savedHandlers.get(record.id)?.(record.sync.persisted);
}

/** Flushes and drops a record. `discard` skips the save for an explicit user choice. */
export async function releaseRecord(id: string, { discard = false } = {}): Promise<boolean> {
  const record = records.get(id);
  if (!record) return true;
  if (!discard) {
    const saved = await flushRecord(record);
    if (!saved) return false;
  }
  if (record.timer) clearTimeout(record.timer);
  record.listeners.clear();
  records.delete(id);
  savedHandlers.delete(id);
  return true;
}

/** Flushes every open page that has unconfirmed edits. Used before unload. */
export async function flushAll(): Promise<void> {
  await Promise.all([...records.values()].filter((record) => hasUnsavedChanges(record.sync)).map((record) => flushRecord(record)));
}

/**
 * Saves one page and reports whether it is safe to act on it.
 *
 * Sidebar actions (B25) rename, move and trash pages the user may also be
 * editing, and all three carry `expectedRevision`. Acting on the revision the
 * sidebar last listed would 409 on any page with a pending edit — the action
 * would fail not because it was wrong but because the user typed a second ago.
 * Flushing first, and refusing to continue when the save fails, means the verbs
 * act on the page as it exists rather than on a version of it we made up.
 */
export async function settleRecord(id: string): Promise<{ ok: boolean; revision?: number }> {
  const record = records.get(id);
  if (!record) return { ok: true };
  const ok = await flushRecord(record);
  return { ok, revision: record.sync.persisted.revision };
}

/**
 * Renames a page from outside its editor — the sidebar `⋯ → Rename` (B25).
 *
 * Order matters. Renaming an open page with a PATCH would be undone by the editor
 * itself: its draft still holds the old title, so the next debounced save writes
 * the old name straight back over the new one. Going through the record means the
 * title the sidebar just set is the title that gets saved.
 *
 * Returns false when the page has no draft record, which is the caller's signal to
 * PATCH the title directly.
 */
export async function renameRecord(id: string, title: string): Promise<boolean> {
  const record = records.get(id);
  if (!record) return false;
  updateRecord(record, { title });
  await flushRecord(record);
  return true;
}

/**
 * Sets a page's favourite flag from outside its editor — the sidebar `⋯` (B25).
 *
 * Same rule as `renameRecord`, for the same two reasons, and the second one is the
 * bug this replaced:
 *
 *   - A direct PATCH is invisible to the draft record, so the record keeps the
 *     revision it last saw. The server is now one ahead, and the *next* save the
 *     record sends — the editor's autosave, or any other verb — is a guaranteed
 *     409 on the page the user is reading. That conflict is sticky (`blocked`), so
 *     from then on the page cannot be saved at all until reloaded. Favouriting the
 *     page you were on was enough to break it.
 *   - A direct PATCH would also be overwritten by the editor's next save, because
 *     the draft still holds the old flag.
 *
 * Returns `null` when the page has no draft record, which is the caller's signal
 * to write it directly against a freshly read revision.
 */
export async function favoriteRecord(id: string, favorite: boolean): Promise<boolean | null> {
  const record = records.get(id);
  if (!record) return null;
  updateRecord(record, { favorite });
  return flushRecord(record);
}

/**
 * Adopts a move the draft did not perform (B28).
 *
 * A sidebar drag bumps the server's revision for the moved page, and its record still
 * holds the revision it last saw. Leaving it behind is precisely the favourites bug from
 * B25: the next autosave sends a stale `expectedRevision`, takes a 409, and `blocked`
 * then makes the page unsaveable for the rest of the session — silently, because the
 * banner only appears on the *next* action.
 *
 * A move does not touch content, so only the bookkeeping fields are adopted. `latest` is
 * the user's draft and is never overwritten here.
 */
export function adoptMove(id: string, moved: Page): void {
  const record = records.get(id);
  if (!record) return;
  record.sync = { ...record.sync, persisted: { ...record.sync.persisted, parentId: moved.parentId, position: moved.position, revision: moved.revision, updatedAt: moved.updatedAt } };
  publish(record);
}

/**
 * Adopts the pageLink a new sub-page just left inside its parent's content.
 *
 * The "add a subpage" button nests the new page twice over: `parent_id`, which the
 * sidebar tree draws, and a block appended to the parent's content, which is what the
 * parent page itself shows. Only the second half is news to the browser, and a parent
 * whose tab is open has a record built from the document as it stood *before* the child
 * existed. It keeps showing a page with nothing in it, and its next debounced save
 * writes that document back — deleting the block the server just added. That is the
 * whole of "I nested a page inside another and it is not inside it".
 *
 * `adoptedAppend` decides whether the server's copy is this record's copy plus a tail,
 * and does nothing at all when the page moved on some other way.
 */
export function adoptChildPage(id: string, fresh: Page): void {
  const record = records.get(id);
  // A conflict is the user's to resolve; adoption must not quietly unblock it.
  if (!record || record.blocked) return;
  const next = adoptedAppend(record.sync, fresh);
  if (!next) return;
  record.sync = next;
  if (hasUnsavedChanges(next)) { keepDraft(record); schedule(record); } else clearRecovery(record.id);
  // The mounted editor was handed its blocks once and never reads the record again, so
  // the child only appears if the editor remounts on the content that now holds it.
  patch(record, { contentVersion: record.contentVersion + 1 });
}

