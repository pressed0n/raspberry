import type { Page } from "./document";

/** The fields a draft can change, and the only thing a local edit touches. */
export type Draft = Pick<Page, "title" | "icon" | "content" | "favorite">;
export type Payload = Draft & { expectedRevision: number; mutationId: string };

/**
 * Upper bound on back-to-back saves in a single flush. Reaching it means every
 * save round was overtaken by a newer edit, which the caller reports instead of
 * retrying forever without backoff.
 */
export const MAX_SAVE_ROUNDS = 10;

export type SyncState = {
  /** What the editor currently holds, saved or not. */
  latest: Draft;
  /** The last version the server confirmed. */
  persisted: Page;
  /** Bumped on every local edit. A version counter, never a change count. */
  editSeq: number;
  /** The edit sequence covered by the last confirmed save. */
  savedSeq: number;
  /** Payload awaiting confirmation. Survives a failure so a retry stays idempotent. */
  inFlight: Payload | null;
  /** The edit sequence the in-flight payload was built from. */
  inFlightSeq: number;
};

export const selectDraft = ({ title, icon, content, favorite }: Page): Draft => ({ title, icon, content, favorite });

export function initialSync(page: Page): SyncState {
  return { latest: selectDraft(page), persisted: page, editSeq: 0, savedSeq: 0, inFlight: null, inFlightSeq: 0 };
}

/** True when the editor holds something the server has not confirmed. */
export const hasUnsavedChanges = (state: SyncState) => state.editSeq !== state.savedSeq || state.inFlight !== null;

export function edited(state: SyncState, changes: Partial<Draft>): SyncState {
  return { ...state, latest: { ...state.latest, ...changes }, editSeq: state.editSeq + 1 };
}

/** A draft recovered from local storage is an unsaved local edit, not a saved one. */
export const recovered = (state: SyncState, draft: Draft): SyncState => ({ ...state, latest: draft, editSeq: state.editSeq + 1 });

/**
 * Adopts a write this draft did not make: the server appended blocks to the page
 * underneath an open editor. Today that is the pageLink a new sub-page leaves inside
 * its parent — nesting is stored twice, as `parent_id` (what the tree draws) and as a
 * block in the parent's content (what the page shows) — and an open parent never hears
 * about the second half.
 *
 * The append is the *only* change, so the server's copy has to be the document this
 * record already treats as saved, plus a tail. When it is anything else the page moved
 * on for another reason and this returns null: the record keeps its own revision, its
 * next save is refused as a conflict, and whatever the server holds now stays put.
 *
 * The tail is appended to the local draft too, so a half-finished page gains the new
 * child without losing a keystroke, and the base revision moves to the adopted copy so
 * the save after this writes the appended blocks back instead of deleting them.
 */
export function adoptedAppend(state: SyncState, fresh: Page): SyncState | null {
  const base = state.persisted.content;
  if (fresh.content.length <= base.length) return null;
  if (!base.every((block, index) => fresh.content[index]?.id === block.id)) return null;
  /* An unsaved draft stays unsaved, but the payload sent for it carries the pre-append
     document under the pre-append revision; it is dropped rather than retried, and the
     next save is rebuilt on the revision this adoption brings in. */
  const editSeq = state.editSeq + 1;
  return {
    ...state,
    persisted: fresh,
    latest: { ...state.latest, content: [...state.latest.content, ...fresh.content.slice(base.length)] },
    editSeq,
    savedSeq: hasUnsavedChanges(state) ? state.savedSeq : editSeq,
    inFlight: null,
    inFlightSeq: 0,
  };
}

/**
 * Adopts a page the server changed underneath a tab that is not being edited (B56).
 *
 * `adoptedAppend` answers "the server appended to my document"; this answers "the
 * server has a whole new document". They are different questions and only one of
 * them may ever run: an append keeps the local draft, and adopting a whole
 * document replaces it, so this returns null whenever `hasUnsavedChanges` — the
 * keystrokes on this device are not the server's to discard.
 *
 * Returning null is not a failure the caller swallows. A draft that is behind the
 * server cannot be saved (`expectedRevision` is stale), so the caller marks the
 * record stale and says so *before* the user hits a 409 they did not cause.
 *
 * An equal or older revision is also null: the poller re-reports the same page for
 * as long as anything in the workspace moves, and re-adopting an identical
 * document would remount the editor under the reader for no reason.
 */
export function adoptedRemote(state: SyncState, fresh: Page): SyncState | null {
  if (fresh.revision <= state.persisted.revision) return null;
  if (hasUnsavedChanges(state)) return null;
  /* A fresh `SyncState`, not a patch of the old one: `latest` must become the
     server's copy, and both counters start level so the record is clean. Anything
     carried over here would be a local edit surviving an adoption it should not
     have survived. */
  return initialSync(fresh);
}

export type SaveOutcome = "saved" | "error" | "conflict" | "stuck";
/**
 * Reads and writes the live state. It is an accessor pair rather than a value
 * because the user keeps typing while a request is in flight: the loop has to
 * see those edits, otherwise confirming a save would overwrite newer text.
 */
export type SyncIO = { get: () => SyncState; set: (state: SyncState) => void };

export type SaveResult = { outcome: SaveOutcome; error?: unknown };

/**
 * Decides what this round sends. A retained payload is reused only while it still
 * describes the current draft; once the user has edited past it, reusing it would
 * revert their text, so it is replaced under a new identifier.
 */
function planSave(state: SyncState): { state: SyncState; payload: Payload; sentSeq: number } | null {
  if (state.inFlight && state.inFlightSeq === state.editSeq) return { state, payload: state.inFlight, sentSeq: state.inFlightSeq };
  if (state.editSeq === state.savedSeq) return null;
  const payload: Payload = { ...state.latest, expectedRevision: state.persisted.revision, mutationId: crypto.randomUUID() };
  return { state: { ...state, inFlight: payload, inFlightSeq: state.editSeq }, payload, sentSeq: state.editSeq };
}

export async function runSaveLoop(io: SyncIO, send: (payload: Payload) => Promise<Page>, rounds = MAX_SAVE_ROUNDS): Promise<SaveResult> {
  for (let round = 0; round < rounds; round++) {
    const plan = planSave(io.get());
    if (!plan) return { outcome: "saved" };
    io.set(plan.state);
    try {
      const page = await send(plan.payload);
      // Re-read: edits made during the request decide whether the server's copy wins.
      const live = io.get();
      /* A round answered after a rebase (`adoptedAppend`) confirms a version the record
         has already moved past. Writing it back would un-adopt the appended blocks and
         hand the next save a stale base to overwrite them with. */
      if (page.revision < live.persisted.revision) { io.set({ ...live, inFlight: null, inFlightSeq: 0 }); continue; }
      const confirmed: SyncState = { ...live, persisted: page, inFlight: null, savedSeq: plan.sentSeq };
      // Adopt the server's canonical draft only when nothing raced this save. This
      // replaces whole-document JSON comparison, which could never settle once the
      // server normalised a field the client kept sending back.
      io.set(live.editSeq === plan.sentSeq ? { ...confirmed, latest: selectDraft(page) } : confirmed);
      const settled = io.get();
      if (settled.editSeq === settled.savedSeq && !settled.inFlight) return { outcome: "saved" };
    } catch (error) {
      const status = (error as { status?: unknown } | null)?.status;
      return { outcome: status === 409 ? "conflict" : "error", error };
    }
  }
  const final = io.get();
  return final.editSeq === final.savedSeq && !final.inFlight ? { outcome: "saved" } : { outcome: "stuck" };
}
