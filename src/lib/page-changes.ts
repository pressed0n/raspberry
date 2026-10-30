/* Raspberry — "the set of live pages changed" (B40h)
   ---------------------------------------------------------------------------
   Two views of the same rows.

   A database block holds one snapshot of its rows, fetched from
   `GET /api/databases/:id` when it mounts; every write *through the block* returns the
   next snapshot, so the two never disagree. Trash is the third caller and it is not the
   block: `POST /api/pages/:id/restore` puts a row back, the sidebar re-reads `/api/pages`,
   and the table — which only ever asked once — kept showing the gap until the document
   was reloaded. The row existed on the server and nowhere on screen.

   So: one signal, one meaning, no payload. Anything that changes which pages are live
   says so, and anything that renders live pages re-reads if it is showing something the
   signal could have changed. A GET per trash/restore action is cheaper than the bug, and
   far cheaper than teaching every block which rows it might own.

   Not a React context: the emitter is in `workspace.tsx` and the subscriber is inside the
   *editor document*, which is a BlockNote-rendered subtree the workspace never owns. A
   module-level subscription is the honest shape for that boundary.
   --------------------------------------------------------------------------- */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Call after any write that adds a page to, or removes one from, the live set. */
export function livePagesChanged(): void {
  /* Copied first: a listener that subscribes or unsubscribes while being told would
     otherwise mutate the set under the iterator. */
  for (const listener of [...listeners]) listener();
}

/** Returns its own unsubscribe, so it drops straight into a `useEffect`. */
export function onLivePagesChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
