"use client";
/* The editor's view onto one database.
   ---------------------------------------------------------------------------
   This is the only place that talks to `/api/databases/:id`, and it deliberately
   does not go through `draft-registry.ts`. A page's draft is a whole document with
   a revision and a fingerprint; a database is a schema plus rows that are edited
   one cell at a time. Routing cell writes through the page draft is exactly the
   collision the plan's decision D1 exists to avoid — every keystroke in a cell
   would rewrite the page and fight its own conflict check.

   `missing` is a state, not an error: a database block can outlive its database
   (a clone of a page that carried one, a restored revision from before it existed),
   and a block that renders "this database is gone" is recoverable, where a thrown
   error would take the whole page's editor down with it. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RequestError, request } from "@/lib/api-client";
import type { DatabasePayload, PropertyType } from "@/lib/database/types";
import { onLivePagesChanged } from "@/lib/page-changes";

export type DatabaseLoad =
  | { status: "loading" }
  | { status: "ready"; database: DatabasePayload }
  | { status: "missing" }
  | { status: "error"; message: string };

export function useDatabase(id: string, initial?: DatabasePayload) {
  const [load, setLoad] = useState<DatabaseLoad>(initial ? { status: "ready", database: initial } : { status: "loading" });
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const reload = useCallback(async () => {
    if (!id) { setLoad({ status: "missing" }); return; }
    try {
      const { database } = await request<{ database: DatabasePayload }>(`/api/databases/${encodeURIComponent(id)}`);
      if (alive.current) setLoad({ status: "ready", database });
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof RequestError && error.status === 404) { setLoad({ status: "missing" }); return; }
      setLoad({ status: "error", message: error instanceof Error ? error.message : "Unable to load this database." });
    }
  }, [id]);

  useEffect(() => { void reload(); }, [reload]);

  /* B40h — the rows can also change liveness without this hook seeing a write: Trash
     restores a page (or the sidebar deletes one) through `/api/pages`, and the snapshot
     this hook is holding was fetched before that happened. Without this, restoring an
     entry left the table showing the gap until the document was reloaded. */
  useEffect(() => onLivePagesChanged(() => { void reload(); }), [reload]);

  /* Applied optimistically by the block's own writes, so a rename or a cell edit
     lands in the same frame as the keystroke and is corrected by the next `reload`
     if the server disagrees. */
  const apply = useCallback((next: DatabasePayload) => setLoad({ status: "ready", database: next }), []);

  /* ---------------------------------------------------------------------------
     Writes.
     ---------------------------------------------------------------------------
     Every one of them is the same three lines: post, take the payload the server
     sends back, apply it. The server is the only thing that knows a new property's
     id or a new row's position, so there is no local guess to reconcile — the
     response *is* the next state. `mutationId` makes a double-click safe: the
     service remembers the id and replays its own result rather than adding a second
     column or a second row.
     --------------------------------------------------------------------------- */
  const [failure, setFailure] = useState<string | null>(null);
  const dismissFailure = useCallback(() => setFailure(null), []);

  const send = useCallback(async (path: string, method: string, body?: unknown): Promise<DatabasePayload | null> => {
    try {
      const { database } = await request<{ database: DatabasePayload }>(path, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (alive.current) setLoad({ status: "ready", database });
      /* Returned as well as applied, because one caller needs to know *which* row it
         just made in order to put the cursor in it. */
      return database;
    } catch (error) {
      if (!alive.current) return null;
      /* A failed write is not a failed load: the table is still on screen and still
         correct as of its last successful read, so the message rides alongside it
         instead of replacing it with an error page. */
      setFailure(error instanceof Error ? error.message : "That change could not be saved.");
      return null;
    }
  }, []);

  const base = `/api/databases/${encodeURIComponent(id)}`;
  const mutations = useMemo(() => ({
    addProperty: (type: PropertyType, name: string, extra?: { config?: unknown; icon?: string }) =>
      send(`${base}/properties`, "POST", { type, name, ...extra, mutationId: crypto.randomUUID() }),
    patchProperty: (propertyId: string, patch: { name?: string; config?: unknown; type?: PropertyType; icon?: string }) =>
      send(`${base}/properties/${encodeURIComponent(propertyId)}`, "PATCH", { ...patch, mutationId: crypto.randomUUID() }),
    deleteProperty: (propertyId: string) =>
      send(`${base}/properties/${encodeURIComponent(propertyId)}?mutationId=${crypto.randomUUID()}`, "DELETE"),
    /* Presentation only: widths, sorts, filters. Deliberately a different endpoint
       from `patchProperty`, because a view change must not bump the schema revision. */
    patchView: (viewId: string, patch: { name?: string; config?: Record<string, unknown> }) =>
      send(`${base}/views/${encodeURIComponent(viewId)}`, "PATCH", { ...patch, mutationId: crypto.randomUUID() }),
    /* `after` inserts a page directly below one instead of at the bottom — the
       per-row `+`. Order is a create-time property, so it travels with the create. */
    addRow: (title = "", after?: string) => send(`${base}/rows`, "POST", { title, ...(after ? { after } : {}), mutationId: crypto.randomUUID() }),
    reorderRows: (ids: string[]) => send(`${base}/rows/order`, "POST", { ids, mutationId: crypto.randomUUID() }),
    patchRow: (rowId: string, patch: { title?: string; cells?: Record<string, unknown>; icon?: string }) =>
      send(`${base}/rows/${encodeURIComponent(rowId)}`, "PATCH", { ...patch, mutationId: crypto.randomUUID() }),
    /* The grip menu's two verbs. Same `mutationId` convention as everything else: a
       double-press duplicates once, not twice. */
    duplicateRow: (rowId: string) =>
      send(`${base}/rows/${encodeURIComponent(rowId)}/duplicate`, "POST", { mutationId: crypto.randomUUID() }),
    trashRow: (rowId: string) =>
      send(`${base}/rows/${encodeURIComponent(rowId)}`, "DELETE", { mutationId: crypto.randomUUID() }),
  }), [base, send]);

  return { load, reload, apply, mutations, failure, dismissFailure };
}
