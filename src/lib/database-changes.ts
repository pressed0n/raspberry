/* Raspberry — "some database changed" (B56)
   ---------------------------------------------------------------------------
   The same shape as `page-changes.ts`, for the same reason: a database block is a
   subtree the workspace does not own, its snapshot is fetched when it mounts, and
   a write made anywhere else is invisible to it.

   One signal, one meaning, no payload. The digest cannot name *which* database
   moved (see `src/server/sync.ts`), so every open block re-reads; a table is one
   request and the alternative is teaching the digest about entities.

   Not a React context: the emitter is a poller in `workspace.tsx` and the
   subscriber is a block inside the editor document.
   --------------------------------------------------------------------------- */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Call when a poll reports the workspace's databases may have moved. */
export function databasesChanged(): void {
  for (const listener of [...listeners]) listener();
}

/** Returns its own unsubscribe, so it drops straight into a `useEffect`. */
export function onDatabasesChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
