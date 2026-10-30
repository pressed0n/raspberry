"use client";
/* The editor's view onto a page's draft record.
   ---------------------------------------------------------------------------
   This used to own the draft state. It now subscribes to the record in
   `draft-registry.ts` instead, so unsaved work and the pending save timer
   survive the editor unmounting — which is what a tab switch does. See the note
   at the top of that file before changing anything here.

   The returned shape is unchanged apart from two additions: `dirty`, for the
   dot on an inactive tab, and `rememberScroll`/`restoreScroll`, since scroll
   position is the one piece of view state a remount cannot recover by itself.
   --------------------------------------------------------------------------- */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { Page } from "@/lib/document";
import type { Draft } from "@/lib/draft-sync";
import {
  acquireRecord, clearRecordRecovery, flushRecord, getSnapshot, replaceRecord,
  setSavedHandler, setScroll, subscribe, updateRecord,
} from "@/lib/draft-registry";

export function usePageDraft(initial: Page, onSaved: (page: Page) => void) {
  // One record per page id for as long as its tab is open. The parent keys this
  // component by page id, so `initial.id` never changes for a given instance.
  const [record] = useState(() => acquireRecord(initial));

  const snapshot = useSyncExternalStore(
    useCallback((listener: () => void) => subscribe(record, listener), [record]),
    useCallback(() => getSnapshot(record), [record]),
    useCallback(() => getSnapshot(record), [record]),
  );

  // Registered without a cleanup on purpose: a debounced save can land after the
  // tab was switched away, and the sidebar still needs the new title. The handler
  // is dropped when the tab closes (`releaseRecord`).
  useEffect(() => { setSavedHandler(record.id, onSaved); }, [record.id, onSaved]);

  const update = useCallback((changes: Partial<Draft>) => updateRecord(record, changes), [record]);
  const flush = useCallback(() => flushRecord(record), [record]);
  const replaceDraft = useCallback((changes: Partial<Draft>) => replaceRecord(record, changes), [record]);
  const clearRecovery = useCallback(() => clearRecordRecovery(record), [record]);
  const rememberScroll = useCallback((scrollTop: number) => setScroll(record, scrollTop), [record]);

  return {
    draft: snapshot.draft,
    status: snapshot.status,
    message: snapshot.message,
    contentVersion: snapshot.contentVersion,
    persisted: record.sync.persisted,
    dirty: snapshot.dirty,
    update, flush, replaceDraft, clearRecovery, rememberScroll,
    // Read live rather than from the snapshot: scroll updates are deliberately
    // not published, so the snapshot copy would lag behind.
    scrollTop: record.scrollTop,
  };
}
