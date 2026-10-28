import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { createPageSchema, patchPageSchema, documentSchema, emptyDocument, createPageLink, pageReferences, plainText, wordCount, type PatchPageInput, type Page, type PageSummary, type Revision } from "../lib/document";
import { type Database, type Sql, LOCAL_USER_ID, LOCAL_WORKSPACE_ID } from "./database";

export type Actor = { userId: string; workspaceId: string; clientId: string };
export const localActor = (clientId = "browser"): Actor => ({ userId: LOCAL_USER_ID, workspaceId: LOCAL_WORKSPACE_ID, clientId });
export class AppError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
type Row = Record<string, unknown>;
function page(row: Row): Page {
  const content = JSON.parse(String(row.content)) as Page["content"];
  return { id: String(row.id), parentId: row.parent_id ? String(row.parent_id) : null, title: String(row.title), icon: row.icon as Page["icon"], content,
    favorite: Number(row.favorite) === 1, revision: Number(row.revision), schemaVersion: 1, createdAt: String(row.created_at), updatedAt: String(row.updated_at), deletedAt: row.deleted_at ? String(row.deleted_at) : null, wordCount: wordCount(content) };
}
function summary(row: Row): PageSummary { const { content: _content, schemaVersion: _schema, ...value } = page(row); return value; }
async function access(sql: Sql, actor: Actor, write = false) {
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
function fingerprint(operation: string, value: unknown) { return createHash("sha256").update(JSON.stringify({ operation, value })).digest("hex"); }
async function receipt(sql: Sql, actor: Actor, id: string, hash: string): Promise<Page | undefined> {
  const [row] = await sql.query("SELECT * FROM mutations WHERE workspace_id=$1 AND user_id=$2 AND client_id=$3 AND mutation_id=$4", [actor.workspaceId, actor.userId, actor.clientId, id]);
  if (!row) return;
  if (row.fingerprint !== hash) throw new AppError(409, "mutation_reused", "That retry identifier belongs to a different change.");
  return JSON.parse(String(row.result));
}
async function remember(sql: Sql, actor: Actor, id: string, hash: string, result: Page) {
  await sql.query("INSERT INTO mutations(workspace_id,user_id,client_id,mutation_id,fingerprint,result) VALUES($1,$2,$3,$4,$5,$6)", [actor.workspaceId, actor.userId, actor.clientId, id, hash, JSON.stringify(result)]);
}
async function validatePageReferences(sql: Sql, actor: Actor, content: Page["content"]) {
  // Retain links to trashed pages so unrelated edits and history restoration
  // continue to work, but never permit a reference across workspace boundaries.
  for (const id of new Set(pageReferences(content))) await find(sql, actor, id, true);
}
async function updatePage(sql: Sql, actor: Actor, id: string, data: PatchPageInput, hash: string) {
  await access(sql, actor, true);
  const previous = await receipt(sql, actor, data.mutationId, hash); if (previous) return previous;
  const current = await find(sql, actor, id);
  const content = data.content ?? JSON.parse(String(current.content));
  await validatePageReferences(sql, actor, content);
  const [row] = await sql.query("UPDATE pages SET title=$1,icon=$2,content=$3,plain_text=$4,favorite=$5,revision=revision+1,updated_at=$6 WHERE id=$7 AND workspace_id=$8 AND revision=$9 AND deleted_at IS NULL RETURNING *", [data.title === undefined ? current.title : data.title || "Untitled", data.icon ?? current.icon, JSON.stringify(content), plainText(content), data.favorite === undefined ? current.favorite : data.favorite ? 1 : 0, new Date().toISOString(), id, actor.workspaceId, data.expectedRevision]);
  if (!row) throw new AppError(409, "revision_conflict", "This page changed elsewhere. Your draft is preserved; reload the saved version before trying again.");
  await snapshot(sql, row, actor); const result = page(row);
  await remember(sql, actor, data.mutationId, hash, result); return result;
}
const blockChangeSchema = z.object({ expectedRevision: z.number().int().positive(), mutationId: z.string().uuid(), blocks: documentSchema }).strict();

async function linkChildPage(sql: Sql, actor: Actor, parentId: string, child: Page) {
  const parent = page(await find(sql, actor, parentId));
  if (pageReferences(parent.content).includes(child.id)) return;
  await updatePage(sql, actor, parentId, { expectedRevision: parent.revision, mutationId: randomUUID(), content: documentSchema.parse([...parent.content, createPageLink(child, "child")]) }, fingerprint("child-link", child.id));
}
async function migrateChildPageLinks(sql: Sql) {
  if ((await sql.query("SELECT version FROM schema_migrations WHERE version=2")).length) return;
  const children = await sql.query("SELECT c.* FROM pages c JOIN pages p ON p.id=c.parent_id AND p.workspace_id=c.workspace_id WHERE c.deleted_at IS NULL AND p.deleted_at IS NULL ORDER BY c.created_at,c.id");
  for (const row of children) {
    const [owner] = await sql.query("SELECT user_id FROM memberships WHERE workspace_id=$1 AND role='owner' ORDER BY user_id LIMIT 1", [row.workspace_id]);
    if (!owner) continue;
    await linkChildPage(sql, { userId: String(owner.user_id), workspaceId: String(row.workspace_id), clientId: "migration" }, String(row.parent_id), page(row));
  }
  await sql.query("INSERT INTO schema_migrations(version) VALUES(2) ON CONFLICT DO NOTHING");
}

export class RaspberryService {
  constructor(private readonly database: Database) {}
  async seed() {
    await this.database.transaction(async (sql) => {
      await sql.query("INSERT INTO users(id,display_name) VALUES($1,$2) ON CONFLICT DO NOTHING", [LOCAL_USER_ID, "You"]);
      await sql.query("INSERT INTO workspaces(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING", [LOCAL_WORKSPACE_ID, "Personal workspace"]);
      await sql.query("INSERT INTO memberships(user_id,workspace_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [LOCAL_USER_ID, LOCAL_WORKSPACE_ID, "owner"]);
      const [{ count }] = await sql.query("SELECT COUNT(*) AS count FROM pages WHERE workspace_id=$1", [LOCAL_WORKSPACE_ID]);
      if (Number(count)) { await migrateChildPageLinks(sql); return; }
      const block = (type: Page["content"][number]["type"], text: string, props = {}) => ({ id: randomUUID(), type, props, content: [{ type: "text" as const, text, styles: {} }], children: [] });
      for (const entry of [
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
      ]) {
        const now = new Date().toISOString();
        const [row] = await sql.query("INSERT INTO pages(id,workspace_id,title,icon,content,plain_text,created_at,updated_at,favorite) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8) ON CONFLICT DO NOTHING RETURNING *", [entry.id, LOCAL_WORKSPACE_ID, entry.title, entry.icon, JSON.stringify(entry.content), plainText(entry.content), now, entry.icon === "sparkles" ? 1 : 0]);
        if (row) await snapshot(sql, row, localActor("setup"));
      }
      await migrateChildPageLinks(sql);
    });
  }
  list(actor: Actor, options: { trash?: boolean; query?: string; limit?: number; offset?: number } = {}) {
    return this.database.transaction(async (sql) => {
      await access(sql, actor);
      const query = (options.query ?? "").trim().slice(0, 200).toLowerCase().replace(/[\\%_]/g, "\\$&");
      const rows = await sql.query(`SELECT * FROM pages WHERE workspace_id=$1 AND deleted_at IS ${options.trash ? "NOT " : ""}NULL AND (LOWER(title) LIKE $2 ESCAPE '\\' OR LOWER(plain_text) LIKE $2 ESCAPE '\\') ORDER BY created_at,id LIMIT $3 OFFSET $4`, [actor.workspaceId, `%${query}%`, Math.min(200, Math.max(1, options.limit ?? 200)), Math.max(0, options.offset ?? 0)]);
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
      const [row] = await sql.query("INSERT INTO pages(id,workspace_id,parent_id,title,icon,content,plain_text,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *", [randomUUID(), actor.workspaceId, data.parentId, data.title || "Untitled", data.icon, JSON.stringify(content), plainText(content), now]);
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
  trash(actor: Actor, id: string, expectedRevision: number) {
    return this.database.transaction(async (sql) => {
      await access(sql, actor, true); const row = await find(sql, actor, id);
      if (Number(row.revision) !== expectedRevision) throw new AppError(409, "revision_conflict", "This page changed. Reload before moving it to trash.");
      const batch = randomUUID(), now = new Date().toISOString();
      const changed = await sql.query("WITH RECURSIVE tree AS (SELECT id FROM pages WHERE id=$1 AND workspace_id=$2 UNION ALL SELECT p.id FROM pages p JOIN tree t ON p.parent_id=t.id WHERE p.workspace_id=$2) UPDATE pages SET deleted_at=$3,trash_batch=$4,revision=revision+1,updated_at=$3 WHERE id IN (SELECT id FROM tree) AND workspace_id=$2 AND deleted_at IS NULL RETURNING *", [id, actor.workspaceId, now, batch]);
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
      const rows = await sql.query("UPDATE pages SET deleted_at=NULL,trash_batch=NULL,revision=revision+1,updated_at=$1 WHERE workspace_id=$2 AND trash_batch=$3 RETURNING *", [new Date().toISOString(), actor.workspaceId, current.trash_batch]);
      for (const item of rows) await snapshot(sql, item, actor);
      return page(rows.find((item) => item.id === id)!);
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
