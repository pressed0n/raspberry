"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { request, RequestError } from "@/lib/api-client";
import { patchPageSchema, type Page, type PatchPageInput } from "@/lib/document";
type Draft = Pick<Page, "title" | "icon" | "content" | "favorite">;
type Status = "saved" | "pending" | "saving" | "error" | "conflict";
const selectDraft = ({ title, icon, content, favorite }: Page): Draft => ({ title, icon, content, favorite });

export function usePageDraft(initial: Page, onSaved: (page: Page) => void) {
  const [draft, setDraft] = useState<Draft>(() => selectDraft(initial));
  const [status, setStatus] = useState<Status>("saved");
  const [message, setMessage] = useState("");
  const [contentVersion, setContentVersion] = useState(0);
  const latest = useRef(draft), persisted = useRef(initial), acknowledged = useRef(JSON.stringify(draft));
  const blocked = useRef(false), inFlight = useRef<PatchPageInput | null>(null), running = useRef<Promise<boolean> | null>(null);
  const onSavedRef = useRef(onSaved); onSavedRef.current = onSaved;
  const storageKey = `raspberry:draft:${initial.id}`;

  const keepDraft = useCallback(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ baseRevision: persisted.current.revision, draft: latest.current })); }
    catch { /* Server retry remains available if browser storage is full or disabled. */ }
  }, [storageKey]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const value = JSON.parse(raw);
      const restored = { ...selectDraft(initial), ...value.draft };
      if (!patchPageSchema.safeParse({ ...restored, expectedRevision: value.baseRevision, mutationId: crypto.randomUUID() }).success) return;
      latest.current = restored; setDraft(restored); setContentVersion((version) => version + 1);
      if (value.baseRevision !== initial.revision) { blocked.current = true; setStatus("conflict"); setMessage("A recovered draft differs from the saved version. Download it or load the saved page."); }
      else { setStatus("pending"); setMessage("Recovered your unsaved draft."); }
    } catch { /* An invalid local recovery record must not prevent opening a page. */ }
  }, [initial.revision, storageKey]);

  const update = useCallback((changes: Partial<Draft>) => {
    latest.current = { ...latest.current, ...changes }; setDraft(latest.current); keepDraft();
    if (!blocked.current) setStatus("pending");
  }, [keepDraft]);

  const flush = useCallback((): Promise<boolean> => {
    if (running.current) return running.current;
    if (blocked.current) return Promise.resolve(false);
    const work = async () => {
      while (inFlight.current || JSON.stringify(latest.current) !== acknowledged.current) {
        inFlight.current ??= { ...latest.current, expectedRevision: persisted.current.revision, mutationId: crypto.randomUUID() };
        const payload = inFlight.current;
        setStatus("saving");
        try {
          const { page } = await request<{ page: Page }>(`/api/pages/${initial.id}`, { method: "PATCH", body: JSON.stringify(payload) });
          persisted.current = page;
          acknowledged.current = JSON.stringify(selectDraft(page));
          // Empty titles are normalized on the server; avoid an endless resave loop.
          if (JSON.stringify(latest.current) === JSON.stringify({ title: payload.title, icon: payload.icon, content: payload.content, favorite: payload.favorite })) {
            latest.current = selectDraft(page); setDraft(latest.current);
          }
          inFlight.current = null; onSavedRef.current(page);
          if (JSON.stringify(latest.current) === acknowledged.current) { try { localStorage.removeItem(storageKey); } catch {} }
          else keepDraft();
        } catch (error) {
          keepDraft();
          if (error instanceof RequestError && error.status === 409) { blocked.current = true; setStatus("conflict"); }
          else setStatus("error");
          setMessage(error instanceof Error ? error.message : "Unable to save. Your draft is kept on this device.");
          return false;
        }
      }
      setStatus("saved"); setMessage(""); return true;
    };
    running.current = work().finally(() => { running.current = null; });
    return running.current;
  }, [initial.id, storageKey, keepDraft]);

  useEffect(() => {
    if (status !== "pending") return;
    const timeout = setTimeout(() => void flush(), 700);
    return () => clearTimeout(timeout);
  }, [draft, status, flush]);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (JSON.stringify(latest.current) !== acknowledged.current || inFlight.current) { keepDraft(); event.preventDefault(); }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [keepDraft]);
  return { draft, status, message, update, flush, persisted, contentVersion,
    replaceDraft: (changes: Partial<Draft>) => { update(changes); setContentVersion((version) => version + 1); },
    clearRecovery: () => { try { localStorage.removeItem(storageKey); } catch {} } };
}
