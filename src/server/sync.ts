/* Raspberry — the change digest a second device polls (B56)
   ---------------------------------------------------------------------------
   The sidebar and the open tab are read once and never again, so a change made
   anywhere else is invisible until the page is reloaded. Notion's answer is a
   socket; ours is a question asked once a second, because every process here is
   a serverless function that cannot hold a connection open.

   The question is "has this workspace changed at all", and the answer has to be
   a value the *database* produces. Three candidate designs were rejected first,
   and the reasons are the reason this file is three aggregates and no migration:

   1. `WHERE updated_at > $cursor` — `updated_at` is written by the application
      (`new Date().toISOString()`), and a hosted deployment is several lambda
      instances with several clocks. A writer whose clock lags produces a row the
      reader's cursor has already passed, so the change is never reported. That
      failure is permanent and silent, which is the worst kind available.

   2. A new `changes` table with an auto-increment column — sound, but the DDL
      differs per dialect (`INTEGER PRIMARY KEY AUTOINCREMENT` vs `BIGSERIAL`),
      and every write path would have to remember to append to it. A write path
      that forgets is a change nobody is ever told about.

   3. A per-database tick bumped by every write — the cell path
      (`databases.ts` patchRow) deliberately does *not* bump `revision`, because
      `revision` is the structural-conflict token checked at line 169: a checkbox
      tick bumping it would make every structural edit answer "This database
      changed. Reload before editing its structure." So that column cannot carry
      liveness.

   What is left is arithmetic over columns that already exist, chosen because
   *every* write path in the service moves at least one of them:

     pages.revision      bumped by create, patch, move, trash, restore
                         (trash/restore bump it — they are `revision=revision+1`
                         writes of `deleted_at`), so content and liveness are
                         both covered.
     pages COUNT         drops on purge and empty-trash, which are the only
                         writes that remove rows.
     pages live count    moves on trash/restore, which keep the row and so keep
                         the count — the sidebar draws this set.
     databases.revision  bumped by every structural write and by row reordering.
     mutations COUNT     bumped by every *receipted* write, which is what catches
                         what the revisions miss: cell writes (`patchRow` records
                         a receipt and touches no revision) and row duplication.

   The comparison is therefore **equality of aggregates, never ordering**, so no
   clock is involved and no write can be "before" the cursor. The cost is that
   the digest can only say *that* something moved, not what: the caller re-reads
   the open tabs and, when the page set moved, the list. That is a deliberate
   trade — one small read on a change beats a schema, a migration and a rule
   every future write path has to obey.
   --------------------------------------------------------------------------- */
import type { SyncStamp } from "../lib/sync-stamp";
import type { Sql } from "./database";

/* The type is declared in `src/lib/sync-stamp.ts` because the browser also needs
   it, and a client component must not import a server module to get one. */
export type { SyncStamp };

/* PostgreSQL returns `COUNT` and `SUM` as `int8`, which `pg` hands over as a
   string because JavaScript cannot hold every int8 exactly. SQLite returns a
   number. `Number()` is what makes one digest out of two dialects; the guard
   keeps a `NaN` out of the token, where it would compare unequal to itself on
   every poll and turn the loop into a hot loop. */
function count(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function stamp(sql: Sql, workspaceId: string): Promise<SyncStamp> {
  const [pages] = await sql.query(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) AS live, COALESCE(SUM(revision),0) AS revisions FROM pages WHERE workspace_id=$1",
    [workspaceId],
  );
  const [databases] = await sql.query(
    "SELECT COUNT(*) AS total, COALESCE(SUM(revision),0) AS revisions FROM databases WHERE workspace_id=$1",
    [workspaceId],
  );
  const [writes] = await sql.query("SELECT COUNT(*) AS total FROM mutations WHERE workspace_id=$1", [workspaceId]);
  return {
    pages: { total: count(pages?.total), live: count(pages?.live), revisions: count(pages?.revisions) },
    databases: { total: count(databases?.total), revisions: count(databases?.revisions) },
    writes: count(writes?.total),
  };
}
