"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "@/lib/api-client";
import { patchPageSchema, type Page } from "@/lib/document";
import { edited, hasUnsavedChanges, initialSync, recovered, runSaveLoop, selectDraft, type Draft, type SyncState } from "@/lib/draft-sync";
type Status = "saved" | "pending" | "saving" | "error" | "conflict";

export function usePageDraft(initial: Page, onSaved: (page: Page) => void) {
  const [draft, setDraft] = useState<Draft>(() => selectDraft(initial));
  const [status, setStatus] = useState<Status>("saved");
  const [message, setMessage] = useState("");
  const [contentVersion, setContentVersion] = useState(0);
  const sync = useRef<SyncState>(initialSync(initial)), persisted = useRef(initial);
  const blocked = useRef(false), running = useRef<Promise<boolean> | null>(null);
  const onSavedRef = useRef(onSaved); onSavedRef.current = onSaved;
  const storageKey = `raspberry:draft:${initial.id}`;

  const commit = useCallback((next: SyncState) => { sync.current = next; persisted.current = next.persisted; setDraft(next.latest); }, []);
  const keepDraft = useCallback(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ baseRevision: sync.current.persisted.revision, draft: sync.current.latest })); }
    catch { /* Server retry remains available if browser storage is full or disabled. */ }
  }, [storageKey]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const value = JSON.parse(raw);
      const restored = { ...selectDraft(initial), ...value.draft };
      if (!patchPageSchema.safeParse({ ...restored, expectedRevision: value.baseRevision, mutationId: crypto.randomUUID() }).success) return;
      commit(recovered(sync.current, restored)); setContentVersion((version) => version + 1);
      if (value.baseRevision !== initial.revision) { blocked.current = true; setStatus("conflict"); setMessage("A recovered draft differs from the saved version. Download it or load the saved page."); }
      else { setStatus("pending"); setMessage("Recovered your unsaved draft."); }
    } catch { /* An invalid local recovery record must not prevent opening a page. */ }
  }, [initial.revision, storageKey]);

  const update = useCallback((changes: Partial<Draft>) => {
    commit(edited(sync.current, changes)); keepDraft();
    if (!blocked.current) setStatus("pending");
  }, [commit, keepDraft]);

  const flush = useCallback((): Promise<boolean> => {
    if (running.current) return running.current;
    if (blocked.current) return Promise.resolve(false);
    const work = async () => {
      const before = sync.current.persisted;
      const { outcome, error } = await runSaveLoop(
        { get: () => sync.current, set: commit },
        async (payload) => {
          setStatus("saving");
          const { page } = await request<{ page: Page }>(`/api/pages/${initial.id}`, { method: "PATCH", body: JSON.stringify(payload) });
          return page;
        },
      );
      if (outcome === "saved") {
        if (sync.current.persisted !== before) onSavedRef.current(sync.current.persisted);
        try { localStorage.removeItem(storageKey); } catch { /* The confirmed draft is already in memory. */ }
        setStatus("saved"); setMessage(""); return true;
      }
      keepDraft();
      if (outcome === "conflict") { blocked.current = true; setStatus("conflict"); }
      else setStatus("error");
      // "stuck" means saving kept losing races with local edits. Say so rather than
      // leaving the indicator on "saving" while the loop retries indefinitely.
      setMessage(outcome === "stuck" ? "Saving keeps returning a different version of this page. Your draft is kept on this device."
        : error instanceof Error ? error.message : "Unable to save. Your draft is kept on this device.");
      return false;
    };
    running.current = work().finally(() => { running.current = null; });
    return running.current;
  }, [commit, initial.id, keepDraft, storageKey]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (hasUnsavedChanges(sync.current)) { keepDraft(); event.preventDefault(); } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [keepDraft]);
  useEffect(() => {
    if (status !== "pending") return;
    if (!hasUnsavedChanges(sync.current)) return;
    const timer = setTimeout(() => { void flush(); }, 700);
    return () => clearTimeout(timer);
  }, [draft, flush, status]);

  return { draft, status, message, update, flush, persisted, contentVersion,
    replaceDraft: (changes: Partial<Draft>) => { update(changes); setContentVersion((version) => version + 1); },
    clearRecovery: () => { try { localStorage.removeItem(storageKey); } catch { /* Nothing to clear. */ } } };
}
