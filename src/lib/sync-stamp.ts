/* Raspberry — reading a change digest (B56)
   ---------------------------------------------------------------------------
   The digest itself is computed in `src/server/sync.ts`; this file is the part
   that runs in the browser, so it is the part that can be tested without a
   database. It answers one question three ways: *what kind* of change happened,
   because the three kinds cost very different reads.

     collection  a page appeared, was purged or was trashed/restored. The sidebar
                 draws this set, so the list has to be re-read.
     pages       some page's revision moved. The open tabs have to be reconciled;
                 the list does not, which is what keeps typing from re-reading it
                 once a second.
     databases   a database block's revision or a receipted write moved. Open
                 database blocks re-read themselves.

   `databases` is deliberately conservative: the receipt count moves for writes
   that have nothing to do with a database (a page save), so it will occasionally
   make an open block re-read when nothing in it changed. Re-reading one open
   table is cheap and always correct; the alternative is a digest that can name
   the entity, which is the schema those reasons in `src/server/sync.ts` exist to
   avoid.
   --------------------------------------------------------------------------- */

export type SyncStamp = {
  /** Every page in the workspace, live and trashed. */
  pages: { total: number; live: number; revisions: number };
  /** Every database block's structural revision. */
  databases: { total: number; revisions: number };
  /** Receipts, i.e. writes that were applied rather than replayed. */
  writes: number;
};

export type StampDiff = { pages: boolean; databases: boolean; collection: boolean };

/** One comparable string, so equality is the only operation performed on it. */
export function tokenOf(stamp: SyncStamp): string {
  return `${stamp.pages.total}/${stamp.pages.live}/${stamp.pages.revisions}|${stamp.databases.total}/${stamp.databases.revisions}|${stamp.writes}`;
}

/**
 * What changed between two digests. `previous === null` is the first answer of a
 * session, and it is treated as "everything": a poller that opened a tab after a
 * change happened elsewhere must not decide the tree is current.
 */
export function diffStamp(previous: SyncStamp | null, next: SyncStamp): StampDiff {
  if (!previous) return { pages: true, databases: true, collection: true };
  const collection = previous.pages.total !== next.pages.total || previous.pages.live !== next.pages.live;
  return {
    /* A trash/restore bumps `revision` as well as moving the live count, so the
       collection flag is folded in rather than tested separately. */
    pages: collection || previous.pages.revisions !== next.pages.revisions,
    collection,
    databases:
      previous.databases.total !== next.databases.total ||
      previous.databases.revisions !== next.databases.revisions ||
      previous.writes !== next.writes,
  };
}
