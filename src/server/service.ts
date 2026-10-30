import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { createPageSchema, patchPageSchema, movePageSchema, documentSchema, emptyDocument, createPageLink, pageReferences, plainText, wordCount, type PatchPageInput, type Page, type PageSummary, type Revision } from "../lib/document";
import { type Database, type Sql, LOCAL_USER_ID, LOCAL_WORKSPACE_ID } from "./database";

export type Actor = { userId: string; workspaceId: string; clientId: string };
export const localActor = (clientId = "browser"): Actor => ({ userId: LOCAL_USER_ID, workspaceId: LOCAL_WORKSPACE_ID, clientId });
export class AppError extends Error {
  /* `details` is the error's *argument*, not its decoration: a refusal that says "3
     cells hold values this type cannot read" has to hand the client the 3, or the
     client can only print a sentence and hope. It travels in the envelope beside code
     and message; nothing else in the service reads it, so adding it later to another
     error costs no refactor. */
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
type Row = Record<string, unknown>;
function page(row: Row): Page {
  const content = JSON.parse(String(row.content)) as Page["content"];
  return { id: String(row.id), parentId: row.parent_id ? String(row.parent_id) : null, title: String(row.title), icon: row.icon as Page["icon"], content,
    favorite: Number(row.favorite) === 1, revision: Number(row.revision), schemaVersion: 1, createdAt: String(row.created_at), updatedAt: String(row.updated_at), deletedAt: row.deleted_at ? String(row.deleted_at) : null, wordCount: wordCount(content),
    position: Number(row.position ?? 0) };
}
function summary(row: Row): PageSummary { const { content: _content, schemaVersion: _schema, ...value } = page(row); return value; }
export async function access(sql: Sql, actor: Actor, write = false) {
  const [membership] = await sql.query("SELECT role FROM memberships WHERE user_id=$1 AND workspace_id=$2", [actor.userId, actor.workspaceId]);
  if (!membership || (write && membership.role === "viewer")) throw new AppError(403, "forbidden", "You do not have permission for this workspace.");
}
async function find(sql: Sql, actor: Actor, id: string, includeTrash = false): Promise<Row> {
  const [row] = await sql.query("SELECT * FROM pages WHERE id=$1 AND workspace_id=$2", [id, actor.workspaceId]);
  if (!row || (!includeTrash && row.deleted_at)) throw new AppError(404, "not_found", "This page is unavailable.");
  return row;
}
async function snapshot(sql: Sql, row: Row, actor: Actor) {
  await sql.query("INSERT INTO revisions(page_id,revision,snapshot,created_at,client_id) VALUES($1,$2,$3,$4,$5)", [row.id, row.revision, JSON.stringify(page(row)), row.updated_at, actor.clientId]);
}
export function fingerprint(operation: string, value: unknown) { return createHash("sha256").update(JSON.stringify({ operation, value })).digest("hex"); }
/* Generic over the result now: page saves store a Page, database writes store a
   database payload or a row. The table itself only ever held JSON, so nothing
   about the replay check changes — a retried mutation still returns the stored
   answer instead of applying twice. */
export async function receipt<T = Page>(sql: Sql, actor: Actor, id: string, hash: string): Promise<T | undefined> {
  const [row] = await sql.query("SELECT * FROM mutations WHERE workspace_id=$1 AND user_id=$2 AND client_id=$3 AND mutation_id=$4", [actor.workspaceId, actor.userId, actor.clientId, id]);
  if (!row) return;
  if (row.fingerprint !== hash) throw new AppError(409, "mutation_reused", "That retry identifier belongs to a different change.");
  return JSON.parse(String(row.result)) as T;
}
export async function remember(sql: Sql, actor: Actor, id: string, hash: string, result: unknown) {
  await sql.query("INSERT INTO mutations(workspace_id,user_id,client_id,mutation_id,fingerprint,result) VALUES($1,$2,$3,$4,$5,$6)", [actor.workspaceId, actor.userId, actor.clientId, id, hash, JSON.stringify(result)]);
}
async function validatePageReferences(sql: Sql, actor: Actor, content: Page["content"]) {
  // Retain links to trashed pages so unrelated edits and history restoration
  // continue to work, but never permit a reference across workspace boundaries.
  for (const id of new Set(pageReferences(content))) await find(sql, actor, id, true);
}
/* Where a page should land when it is *appended* to `parentId`: one past the highest
   position currently in use there. Deliberately MAX+1 rather than COUNT: a gap left by
   a deleted sibling must not let a new page jump ahead of one that exists. */
async function nextSiblingPosition(sql: Sql, actor: Actor, parentId: string | null): Promise<number> {
  const [row] = parentId
    ? await sql.query("SELECT MAX(position) AS top FROM pages WHERE workspace_id=$1 AND parent_id=$2 AND deleted_at IS NULL", [actor.workspaceId, parentId])
    : await sql.query("SELECT MAX(position) AS top FROM pages WHERE workspace_id=$1 AND parent_id IS NULL AND deleted_at IS NULL", [actor.workspaceId]);
  const top = row?.top === null || row?.top === undefined ? -1 : Number(row.top);
  return top + 1;
}
async function updatePage(sql: Sql, actor: Actor, id: string, data: PatchPageInput, hash: string) {
  await access(sql, actor, true);
  const previous = await receipt(sql, actor, data.mutationId, hash); if (previous) return previous;
  const current = await find(sql, actor, id);
  const content = data.content ?? JSON.parse(String(current.content));
  await validatePageReferences(sql, actor, content);
  const previousParent = current.parent_id ? String(current.parent_id) : null;
  const parentId = data.parentId === undefined ? previousParent : data.parentId;
  /* A reparent through a plain patch appends to the end of its new siblings. Without
     this the page would keep the position it held among its *old* siblings and could
     tie with one already there — two pages claiming slot 3, separated only by
     created_at, which is the invisible ordering this change exists to remove. */
  const position = parentId === previousParent ? Number(current.position ?? 0) : await nextSiblingPosition(sql, actor, parentId);
  if (parentId !== previousParent) await assertMovable(sql, actor, id, parentId);
  const [row] = await sql.query("UPDATE pages SET title=$1,icon=$2,content=$3,plain_text=$4,favorite=$5,parent_id=$6,revision=revision+1,updated_at=$7,position=$11 WHERE id=$8 AND workspace_id=$9 AND revision=$10 AND deleted_at IS NULL RETURNING *", [data.title === undefined ? current.title : data.title || "Untitled", data.icon ?? current.icon, JSON.stringify(content), plainText(content), data.favorite === undefined ? current.favorite : data.favorite ? 1 : 0, parentId, new Date().toISOString(), id, actor.workspaceId, data.expectedRevision, position]);
  if (!row) throw new AppError(409, "revision_conflict", "This page changed elsewhere. Your draft is preserved; reload the saved version before trying again.");
  await snapshot(sql, row, actor); const result = page(row);
  await remember(sql, actor, data.mutationId, hash, result); return result;
}
/* ---------------------------------------------------------------------------
   Database scope, for delete and restore.
   ---------------------------------------------------------------------------
   A database row is a real page with `database_id` set and `parent_id` NULL, so the
   `parent_id` recursion that walks a subtree for trash/purge cannot reach it. This is
   the second population that "a row is a page" buys us, and forgetting it means
   invisible orphans: rows still loaded by their view after their page was deleted, and
   property/view/cell rows pointing at a database nobody can open again.

   Resolving in two steps rather than one clever CTE is deliberate — SQLite allows a
   single recursive reference, so a UNION of "children by parent" and "rows by database"
   is not expressible as one recursive SELECT on either engine.
   --------------------------------------------------------------------------- */
export async function databaseScope(sql: Sql, pageIds: string[]): Promise<{ databaseIds: string[]; rowIds: string[] }> {
  if (!pageIds.length) return { databaseIds: [], rowIds: [] };
  const slots = pageIds.map((_, index) => `$${index + 1}`).join(",");
  const databaseIds = (await sql.query(`SELECT id FROM databases WHERE page_id IN (${slots})`, pageIds)).map((row) => String(row.id));
  if (!databaseIds.length) return { databaseIds, rowIds: [] };
  const databaseSlots = databaseIds.map((_, index) => `$${index + 1}`).join(",");
  const rowIds = (await sql.query(`SELECT id FROM pages WHERE database_id IN (${databaseSlots})`, databaseIds)).map((row) => String(row.id));
  return { databaseIds, rowIds };
}

/* Removes a database's schema, views and cells. Cells are deleted by row so a purged
   row leaves nothing behind, and cells whose property has gone are deleted by property
   so deleting a property in the UI frees them too. */
async function forgetDatabases(sql: Sql, databaseIds: string[], rowIds: string[]) {
  if (rowIds.length) {
    const slots = rowIds.map((_, index) => `$${index + 1}`).join(",");
    await sql.query(`DELETE FROM database_cells WHERE row_id IN (${slots})`, rowIds);
  }
  if (!databaseIds.length) return;
  const slots = databaseIds.map((_, index) => `$${index + 1}`).join(",");
  await sql.query(`DELETE FROM database_properties WHERE database_id IN (${slots})`, databaseIds);
  await sql.query(`DELETE FROM database_views WHERE database_id IN (${slots})`, databaseIds);
  await sql.query(`DELETE FROM databases WHERE id IN (${slots})`, databaseIds);
}

/* Re-parenting has exactly one way to destroy data: move a page beneath itself
   or beneath one of its own descendants. The subtree keeps its parent_id chain
   pointing back inside itself, so it stops being reachable from the root of the
   tree — the rows survive, and the sidebar simply never draws them again. There
   is no undo for that from the UI, so the check lives here, in the transaction
   that performs the move. Walking up from the proposed parent costs one query
   per level; only a genuinely deep tree makes that noticeable, and a page is
   reparented a handful of times in its life. */
async function assertMovable(sql: Sql, actor: Actor, id: string, parentId: string | null) {
  /* A database row is a page, but it lives in its database, not in the tree.
     Re-parenting one would put it outside the table that owns it — invisible in the
     sidebar (which excludes rows) and unreachable from the view it belongs to. */
  const [moving] = await sql.query("SELECT database_id FROM pages WHERE id=$1 AND workspace_id=$2", [id, actor.workspaceId]);
  if (moving?.database_id) throw new AppError(409, "row_not_movable", "A database row lives in its database, not in the page tree.");
  if (parentId === null) return;
  if (parentId === id) throw new AppError(409, "would_cycle", "A page cannot be moved inside itself.");
  const [destination] = await sql.query("SELECT parent_id, deleted_at FROM pages WHERE id=$1 AND workspace_id=$2", [parentId, actor.workspaceId]);
  if (!destination) throw new AppError(404, "not_found", "That destination page is unavailable.");
  if (destination.deleted_at) throw new AppError(409, "parent_in_trash", "Restore the destination page first.");
  const seen = new Set<string>([parentId]);
  let cursor = destination.parent_id ? String(destination.parent_id) : null;
  while (cursor) {
    if (cursor === id) throw new AppError(409, "would_cycle", "A page cannot be moved inside one of its own subpages.");
    /* A loop that already exists would otherwise spin here forever. It should be
       impossible, which is precisely why it is worth one guard rather than 30
       seconds of a hung request. */
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const [ancestor] = await sql.query("SELECT parent_id FROM pages WHERE id=$1 AND workspace_id=$2", [cursor, actor.workspaceId]);
    if (!ancestor) break;
    cursor = ancestor.parent_id ? String(ancestor.parent_id) : null;
  }
}
const blockChangeSchema = z.object({ expectedRevision: z.number().int().positive(), mutationId: z.string().uuid(), blocks: documentSchema }).strict();

async function linkChildPage(sql: Sql, actor: Actor, parentId: string, child: Page) {
  const parent = page(await find(sql, actor, parentId));
  if (pageReferences(parent.content).includes(child.id)) return;
  await updatePage(sql, actor, parentId, { expectedRevision: parent.revision, mutationId: randomUUID(), content: documentSchema.parse([...parent.content, createPageLink(child, "child")]) }, fingerprint("child-link", child.id));
}

export class RaspberryService {
  constructor(private readonly database: Database) {}
  async seed() {
    await this.database.transaction(async (sql) => {
      await sql.query("INSERT INTO users(id,display_name) VALUES($1,$2) ON CONFLICT DO NOTHING", [LOCAL_USER_ID, "You"]);
      await sql.query("INSERT INTO workspaces(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING", [LOCAL_WORKSPACE_ID, "Personal workspace"]);
      await sql.query("INSERT INTO memberships(user_id,workspace_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [LOCAL_USER_ID, LOCAL_WORKSPACE_ID, "owner"]);
      const [{ count }] = await sql.query("SELECT COUNT(*) AS count FROM pages WHERE workspace_id=$1", [LOCAL_WORKSPACE_ID]);
      if (Number(count)) return;
      const block = (type: Page["content"][number]["type"], text: string, props = {}) => ({ id: randomUUID(), type, props, content: [{ type: "text" as const, text, styles: {} }], children: [] });
      /* Seeded pages get dense positions, so a fresh install opens with the sidebar in the
         order it was written — not three pages sharing slot 0 and separated only by
         `created_at`, which is what the column default would produce. */
      const seeded = [
        { id: "00000000-0000-4000-8000-000000000010", title: "A little space for big ideas", icon: "sparkles", content: [
          block("paragraph", "Welcome to Raspberry. A quiet home for your thoughts, plans, and everything you want to make happen."),
          block("heading", "Make room for what matters", { level: 2 }),
          block("paragraph", "Start a note, untangle an idea, or sketch out your next project. Your pages are saved as you write, ready when you come back."),
          block("checkListItem", "Give your next idea a page", { checked: false }),
          block("checkListItem", "Try typing / to explore your writing tools", { checked: false }),
          block("checkListItem", "Keep the important things close with favorites", { checked: false }),
          block("heading", "Small beginnings, endless possibilities", { level: 2 }),
          block("paragraph", "This is your space. There is no right way to use it. Start with a sentence and see where it goes."),
          block("quote", "Great things start with a little room to think."),
          block("paragraph", ""),
        ] },
        { id: "00000000-0000-4000-8000-000000000011", title: "Quick notes", icon: "notebook", content: [block("paragraph", "A place for the things you don't want to forget."), block("bulletListItem", "")] },
        { id: "00000000-0000-4000-8000-000000000012", title: "Something to explore", icon: "compass", content: [block("paragraph", "What are you curious about today?"), block("paragraph", "")] },
      ];
      for (const [position, entry] of seeded.entries()) {
        const now = new Date().toISOString();
        const [row] = await sql.query("INSERT INTO pages(id,workspace_id,title,icon,content,plain_text,created_at,updated_at,favorite,position) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING *", [entry.id, LOCAL_WORKSPACE_ID, entry.title, entry.icon, JSON.stringify(entry.content), plainText(entry.content), now, entry.icon === "sparkles" ? 1 : 0, position]);
        if (row) await snapshot(sql, row, localActor("setup"));
      }
    });
  }
  /** Liveness probe for the health endpoint. Reads nothing, reveals nothing. */
  ping() {
    return this.database.transaction(async (sql) => {
      const [row] = await sql.query("SELECT 1 AS ok");
      return Number(row?.ok ?? 0) === 1;
    });
  }
  list(actor: Actor, options: { trash?: boolean; query?: string; parentId?: string | null; limit?: number; offset?: number; rows?: boolean } = {}) {
    return this.database.transaction(async (sql) => {
      await access(sql, actor);
      // Scoping by parent must happen in SQL. Filtering an already-capped result set
      // silently lost children once a workspace passed the row limit, while still
      // advertising pagination over that truncated set.
      if (options.parentId) await find(sql, actor, options.parentId);
      const query = (options.query ?? "").trim().slice(0, 200).toLowerCase().replace(/[\\%_]/g, "\\$&");
      // Placeholder numbers follow the order values are pushed: the SQLite adapter
      // rewrites $N positionally, so a hole in the numbering binds the wrong value.
      const values: (string | number | null)[] = [actor.workspaceId, `%${query}%`];
      const where = ["workspace_id=$1", `deleted_at IS ${options.trash ? "NOT " : ""}NULL`, "(LOWER(title) LIKE $2 ESCAPE '\\' OR LOWER(plain_text) LIKE $2 ESCAPE '\\')"];
      /* A database row is a real page, but it is *not* a page in the tree: it belongs
         to its database's table, not to the sidebar, and showing it would put every
         row of every database in the tree — and let a drag reassign its parent, which
         would strand it outside its own table. Callers that genuinely want rows (the
         database view, a future "search everything") pass `rows: true`.

         The trash is different, and needs a different rule rather than an exception.
         A row you deleted from a table must be findable, or it is in limbo — but the
         three hundred rows that came along when you trashed the page holding their
         database must not be, because they come back with it. So: a row shows in the
         trash only when the table that owns it is *not* in the trash itself. */
      if (options.trash) {
        where.push("NOT EXISTS (SELECT 1 FROM databases d JOIN pages owner ON owner.id=d.page_id WHERE d.id=pages.database_id AND owner.deleted_at IS NOT NULL)");
      } else if (!options.rows) {
        where.push("database_id IS NULL");
      }
      if (options.parentId !== undefined) {
        if (options.parentId === null) where.push("parent_id IS NULL");
        else { values.push(options.parentId); where.push(`parent_id=$${values.length}`); }
      }
      values.push(Math.min(200, Math.max(1, options.limit ?? 200)), Math.max(0, options.offset ?? 0));
      /* Live pages read in their stored sibling order — this is the only place the
         sidebar's order comes from, so a drag that is not reflected here did not happen.
         `created_at`/`id` remain as tie-breakers: two rows can share a position after a
         concurrent move, and a list that reorders itself between two identical requests
         is worse than a list that is slightly stale. The trash keeps the old ordering
         because it is a recency list — "what did I just delete" — not a tree. */
      const order = options.trash ? "created_at,id" : "position,created_at,id";
      const rows = await sql.query(`SELECT * FROM pages WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
      return rows.map(summary);
    });
  }
  get(actor: Actor, id: string) { return this.database.transaction(async (sql) => { await access(sql, actor); return page(await find(sql, actor, id)); }); }
  create(actor: Actor, input: unknown) {
    const data = createPageSchema.parse(input);
    const hash = fingerprint("create", data);
    return this.database.transaction(async (sql) => {
      await access(sql, actor, true);
      const previous = await receipt(sql, actor, data.mutationId, hash); if (previous) return previous;
      if (data.parentId) await find(sql, actor, data.parentId);
      const now = new Date().toISOString(), content = data.content ?? emptyDocument();
      await validatePageReferences(sql, actor, content);
      /* A new page appends to its siblings. The column default of 0 would have put every
         new page at the top of its parent, which reads as "the sidebar just jumped". */
      const position = await nextSiblingPosition(sql, actor, data.parentId ?? null);
      const [row] = await sql.query("INSERT INTO pages(id,workspace_id,parent_id,title,icon,content,plain_text,created_at,updated_at,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9) RETURNING *", [randomUUID(), actor.workspaceId, data.parentId, data.title || "Untitled", data.icon, JSON.stringify(content), plainText(content), now, position]);
      await snapshot(sql, row, actor); const result = page(row);
      if (data.parentId && data.linkInParent) await linkChildPage(sql, actor, data.parentId, result);
      await remember(sql, actor, data.mutationId, hash, result); return result;
    });
  }
  patch(actor: Actor, id: string, input: unknown) {
    const data = patchPageSchema.parse(input), hash = fingerprint(`patch:${id}`, data);
    return this.database.transaction((sql) => updatePage(sql, actor, id, data, hash));
  }
  mutateBlocks(actor: Actor, id: string, operation: "append" | "update", input: unknown) {
    const data = blockChangeSchema.parse(input), hash = fingerprint(`${operation}:${id}`, data);
    return this.database.transaction(async (sql) => {
      await access(sql, actor, true);
      const previous = await receipt(sql, actor, data.mutationId, hash); if (previous) return previous;
      const current = page(await find(sql, actor, id));
      let content: Page["content"];
      if (operation === "append") content = [...current.content, ...data.blocks];
      else {
        const replacements = new Map(data.blocks.map((block) => [block.id, block])), found = new Set<string>();
        const replace = (items: Page["content"]): Page["content"] => items.map((block) => {
          if (replacements.has(block.id)) { found.add(block.id); return replacements.get(block.id)!; }
          return { ...block, children: replace(block.children) };
        });
        content = replace(current.content);
        if (found.size !== replacements.size) throw new AppError(400, "unknown_block", "A block ID was not found or was nested inside another replacement. Read the page again.");
      }
      return updatePage(sql, actor, id, patchPageSchema.parse({ expectedRevision: data.expectedRevision, mutationId: data.mutationId, content }), hash);
    });
  }
  /* Drag reordering (B28). Two things make this more than a `parent_id` write:

     (a) order lives *per parent*, so a move renumbers the destination's siblings into
         dense positions 0..n-1. Leaving gaps is what turns "insert at 2" into "insert
         at 7" after a handful of moves, and the client's index would stop meaning the
         row the pointer was over.
     (b) only the moved page bumps its revision. Bumping the siblings would 409 every
         editor open on one of them, and their content did not change — a drag must not
         be able to break an unrelated page's autosave.

     `index` is clamped, not rejected. The client derives it from measured geometry, and
     a row that vanished mid-drag (another tab trashed it) should land the page at the
     end rather than make the drop fail after the user already let go. */
  move(actor: Actor, id: string, input: unknown) {
    const data = movePageSchema.parse(input);
    const hash = fingerprint(`move:${id}`, data);
    return this.database.transaction(async (sql) => {
      await access(sql, actor, true);
      const previous = await receipt(sql, actor, data.mutationId, hash); if (previous) return previous;
      const current = await find(sql, actor, id);
      if (Number(current.revision) !== data.expectedRevision) throw new AppError(409, "revision_conflict", "This page changed. Reload before moving it.");
      const wasParent = current.parent_id ? String(current.parent_id) : null;
      /* Reuse the same cycle guard the `⋯ → Move to` dialog relies on: a drop onto a
         page's own descendant would detach the subtree from the tree it is drawn from. */
      if (data.parentId !== wasParent) await assertMovable(sql, actor, id, data.parentId);
      const siblings = data.parentId
        ? await sql.query("SELECT id FROM pages WHERE workspace_id=$1 AND parent_id=$2 AND deleted_at IS NULL AND id<>$3 ORDER BY position,created_at,id", [actor.workspaceId, data.parentId, id])
        : await sql.query("SELECT id FROM pages WHERE workspace_id=$1 AND parent_id IS NULL AND deleted_at IS NULL AND id<>$2 ORDER BY position,created_at,id", [actor.workspaceId, id]);
      const order = siblings.map((row) => String(row.id));
      order.splice(Math.min(Math.max(0, data.index), order.length), 0, id);
      const now = new Date().toISOString();
      for (const [slot, sibling] of order.entries()) {
        if (sibling === id) continue;
        await sql.query("UPDATE pages SET position=$1 WHERE id=$2 AND workspace_id=$3 AND position<>$1", [slot, sibling, actor.workspaceId]);
      }
      const [row] = await sql.query("UPDATE pages SET parent_id=$1,position=$2,revision=revision+1,updated_at=$3 WHERE id=$4 AND workspace_id=$5 AND revision=$6 AND deleted_at IS NULL RETURNING *", [data.parentId, order.indexOf(id), now, id, actor.workspaceId, data.expectedRevision]);
      if (!row) throw new AppError(409, "revision_conflict", "This page changed. Reload before moving it.");
      await snapshot(sql, row, actor); const result = page(row);
      await remember(sql, actor, data.mutationId, hash, result); return result;
    });
  }
  trash(actor: Actor, id: string, expectedRevision: number) {
    return this.database.transaction(async (sql) => {
      await access(sql, actor, true); const row = await find(sql, actor, id);
      if (Number(row.revision) !== expectedRevision) throw new AppError(409, "revision_conflict", "This page changed. Reload before moving it to trash.");
      const batch = randomUUID(), now = new Date().toISOString();
      const tree = (await sql.query("WITH RECURSIVE tree AS (SELECT id FROM pages WHERE id=$1 AND workspace_id=$2 UNION ALL SELECT p.id FROM pages p JOIN tree t ON p.parent_id=t.id WHERE p.workspace_id=$2) SELECT id FROM tree", [id, actor.workspaceId])).map((item) => String(item.id));
      /* Rows of any database owned inside this subtree come along, so restoring the
         page restores its table rather than resurrecting it empty. */
      const { rowIds } = await databaseScope(sql, tree);
      const scope = [...new Set([...tree, ...rowIds])];
      const slots = scope.map((_, index) => `$${index + 3}`).join(",");
      const changed = await sql.query(`UPDATE pages SET deleted_at=$1,trash_batch=$2,revision=revision+1,updated_at=$1 WHERE workspace_id=$${scope.length + 3} AND deleted_at IS NULL AND id IN (${slots}) RETURNING *`, [now, batch, ...scope, actor.workspaceId]);
      for (const item of changed) await snapshot(sql, item, actor);
      return { ids: changed.map((item) => String(item.id)) };
    });
  }
  restore(actor: Actor, id: string) {
    return this.database.transaction(async (sql) => {
      await access(sql, actor, true); const current = await find(sql, actor, id, true);
      if (!current.deleted_at) return page(current);
      if (current.parent_id) {
        const parent = await find(sql, actor, String(current.parent_id), true);
        if (parent.deleted_at) throw new AppError(409, "parent_in_trash", "Restore the parent page first.");
      }
      const now = new Date().toISOString(), batch = current.trash_batch == null ? null : String(current.trash_batch);
      // Batches are matched by identifier. A page trashed by an older build (or by
      // hand) carries no batch, so matching on null deleted nothing and the non-null
      // assertion below then crashed while reading an absent row.
      const rows = batch
        ? await sql.query("UPDATE pages SET deleted_at=NULL,trash_batch=NULL,revision=revision+1,updated_at=$1 WHERE workspace_id=$2 AND trash_batch=$3 AND deleted_at IS NOT NULL RETURNING *", [now, actor.workspaceId, batch])
        : await sql.query("UPDATE pages SET deleted_at=NULL,trash_batch=NULL,revision=revision+1,updated_at=$1 WHERE id=$2 AND workspace_id=$3 AND deleted_at IS NOT NULL RETURNING *", [now, id, actor.workspaceId]);
      for (const item of rows) await snapshot(sql, item, actor);
      const restored = rows.find((item) => String(item.id) === id);
      if (!restored) throw new AppError(409, "restore_failed", "This page could not be restored. Reload and try again.");
      return page(restored);
    });
  }
  /**
   * Deletes a trashed page and everything trashed beneath it, for good.
   *
   * Until now `trash` was the only deletion the server offered, so the trash could
   * only grow: every duplicate and mistake stayed there permanently with no way to
   * remove it. Restoring and re-trashing was the closest thing to a purge.
   *
   * Only trashed rows are eligible. "Permanently delete" must never be reachable
   * for a page that is not in the trash — the button that calls this is not the
   * guard, this is.
   */
  purge(actor: Actor, id: string) {
    return this.database.transaction(async (sql) => {
      await access(sql, actor, true);
      const current = await find(sql, actor, id, true);
      if (!current.deleted_at) throw new AppError(409, "not_trashed", "Only a page in the trash can be deleted permanently.");
      /* `parent_id` is a foreign key, so the subtree has to go in one piece — but
         only the trashed part of it. A live child of a trashed page is detached to
         the top level instead of vanishing with its parent. */
      const ids = (await sql.query(
        "WITH RECURSIVE tree AS (SELECT id FROM pages WHERE id=$1 AND workspace_id=$2 UNION ALL SELECT p.id FROM pages p JOIN tree t ON p.parent_id=t.id WHERE p.workspace_id=$2 AND p.deleted_at IS NOT NULL) SELECT id FROM tree",
        [id, actor.workspaceId],
      )).map((row) => String(row.id));
      /* A trashed database page takes its rows with it, and the rows bring their
         databases' schema, views and cells — otherwise "delete permanently" leaves a
         database nobody can open, still holding cells for rows that no longer exist. */
      const scope = await databaseScope(sql, ids);
      const all = [...new Set([...ids, ...scope.rowIds])];
      /* Cells are cleared by row id, which also covers purging a single row straight
         out of the trash — its cells go even though no database was in this subtree. */
      await forgetDatabases(sql, scope.databaseIds, all);
      const slots = all.map((_, index) => `$${index + 1}`).join(",");
      await sql.query(`UPDATE pages SET parent_id=NULL WHERE parent_id IN (${slots}) AND deleted_at IS NULL`, all);
      await sql.query(`DELETE FROM revisions WHERE page_id IN (${slots})`, all);
      await sql.query(`DELETE FROM pages WHERE id IN (${slots})`, all);
      return { ids: all };
    });
  }
  /** Empties the trash. Same rules as `purge`, applied to every trashed page. */
  emptyTrash(actor: Actor) {
    return this.database.transaction(async (sql) => {
      await access(sql, actor, true);
      const trashed = "SELECT id FROM pages WHERE workspace_id=$1 AND deleted_at IS NOT NULL";
      const ids = (await sql.query(`SELECT id FROM pages WHERE workspace_id=$1 AND deleted_at IS NOT NULL`, [actor.workspaceId])).map((row) => String(row.id));
      if (!ids.length) return { ids };
      const scope = await databaseScope(sql, ids);
      await forgetDatabases(sql, scope.databaseIds, ids);
      await sql.query(`UPDATE pages SET parent_id=NULL WHERE workspace_id=$1 AND parent_id IN (${trashed}) AND deleted_at IS NULL`, [actor.workspaceId]);
      await sql.query(`DELETE FROM revisions WHERE page_id IN (${trashed})`, [actor.workspaceId]);
      await sql.query(`DELETE FROM pages WHERE workspace_id=$1 AND deleted_at IS NOT NULL`, [actor.workspaceId]);
      return { ids };
    });
  }
  history(actor: Actor, id: string): Promise<Revision[]> {
    return this.database.transaction(async (sql) => {
      await access(sql, actor); await find(sql, actor, id);
      return (await sql.query("SELECT * FROM revisions WHERE page_id=$1 ORDER BY revision DESC LIMIT 30", [id])).map((row) => ({ revision: Number(row.revision), createdAt: String(row.created_at), clientId: String(row.client_id), title: JSON.parse(String(row.snapshot)).title }));
    });
  }
  revision(actor: Actor, id: string, version: number): Promise<Page> {
    return this.database.transaction(async (sql) => {
      await access(sql, actor); await find(sql, actor, id);
      const [row] = await sql.query("SELECT snapshot FROM revisions WHERE page_id=$1 AND revision=$2", [id, version]);
      if (!row) throw new AppError(404, "not_found", "That revision is unavailable.");
      return JSON.parse(String(row.snapshot));
    });
  }
}
