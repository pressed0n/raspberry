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
