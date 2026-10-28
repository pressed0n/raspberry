import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase, LOCAL_WORKSPACE_ID } from "../src/server/database";
import { RaspberryService, localActor, AppError } from "../src/server/service";
import { createCallout, createColumns, createPageLink, documentSchema, editorDocument, emptyDocument, plainText, toMarkdown, type DocumentBlock } from "../src/lib/document";

function table(): DocumentBlock {
  return { id: crypto.randomUUID(), type: "table", props: { textColor: "default" }, children: [], content: { type: "tableContent", columnWidths: [null, 140], headerRows: 1, rows: [
    { cells: [[{ type: "text", text: "Idea", styles: {} }], [{ type: "text", text: "Status", styles: {} }]] },
    { cells: [{ type: "tableCell", props: { backgroundColor: "default", textColor: "default", textAlignment: "left" }, content: [{ type: "text", text: "Blueberries", styles: {} }] }, []] },
  ] } };
}

test("callout colors migrate recursively and the standard palette survives saving", async () => {
  const legacy = createCallout(); legacy.props = { emoji: "💡", color: "blue" };
  const columns = createColumns(2); columns.children[0].children = [legacy];
  const migrated = editorDocument([columns]);
  assert.deepEqual(migrated[0].children[0].children[0].props, { emoji: "💡", backgroundColor: "blue" });
  assert.equal(legacy.props.color, "blue");
  const db = await openDatabase("file::memory:"), service = new RaspberryService(db), actor = localActor(); await service.seed();
  try {
    const page = await service.create(actor, { title: "Palette", content: migrated, mutationId: crypto.randomUUID() });
    for (const backgroundColor of ["default", "gray", "brown", "red", "orange", "yellow", "green", "blue", "purple", "pink"]) {
      const latest = await service.get(actor, page.id);
      const callout = latest.content[0].children[0].children[0];
      callout.props.backgroundColor = backgroundColor;
      const saved = await service.patch(actor, page.id, { expectedRevision: latest.revision, mutationId: crypto.randomUUID(), content: latest.content });
      assert.equal(saved.content[0].children[0].children[0].props.backgroundColor, backgroundColor);
    }
  } finally { await db.close(); }
  assert.equal(documentSchema.safeParse([{ ...legacy, props: { emoji: "💡", backgroundColor: "url(https://example.com)" } }]).success, false);
});
test("nested callouts, two-to-five columns, tables and dividers survive save, history and Markdown export", async () => {
  const db = await openDatabase("file::memory:"), service = new RaspberryService(db), actor = localActor(); await service.seed();
  try {
    const callout = createCallout(); callout.children[0].content = [{ type: "text", text: "Nested thought 🥳", styles: {} }];
    callout.children.push(table(), { id: crypto.randomUUID(), type: "divider", props: {}, children: [] });
    const columns = [2, 3, 4, 5].map(createColumns); columns[0].children[1].children = [callout];
    const content = documentSchema.parse(columns);
    const created = await service.create(actor, { title: "Block roundtrip", content, mutationId: crypto.randomUUID() });
    const saved = await service.get(actor, created.id);
    assert.deepEqual(saved.content, content);
    assert.deepEqual((await service.revision(actor, created.id, 1)).content, content);
    assert.match(plainText(content), /Nested thought 🥳/); assert.match(plainText(content), /Blueberries/);
    assert.equal((await service.list(actor, { query: "blueberries" })).length, 1);
    assert.match(toMarkdown(content), /> 💡/); assert.match(toMarkdown(content), /Column 5/); assert.match(toMarkdown(content), /\| Idea \| Status \|/); assert.match(toMarkdown(content), /> ---/);
  } finally { await db.close(); }
});
test("page creation links children once; ordinary page links do not reparent their target", async () => {
  const db = await openDatabase("file::memory:"), service = new RaspberryService(db), actor = localActor(); await service.seed();
  try {
    const parent = await service.create(actor, { title: "Parent", mutationId: crypto.randomUUID() });
    const input = { title: "Child", parentId: parent.id, mutationId: crypto.randomUUID() };
    const child = await service.create(actor, input); await service.create(actor, input);
    const linkedParent = await service.get(actor, parent.id);
    assert.equal(linkedParent.content.filter((block) => block.type === "pageLink").length, 1);
    assert.equal(linkedParent.revision, 2);
    assert.equal(linkedParent.content.at(-1)?.props.pageId, child.id);
    const other = await service.create(actor, { title: "Unrelated page", mutationId: crypto.randomUUID() });
    const changed = await service.patch(actor, parent.id, { expectedRevision: linkedParent.revision, mutationId: crypto.randomUUID(), content: [...linkedParent.content, createPageLink(other)] });
    assert.equal((await service.get(actor, other.id)).parentId, null);
    assert.match(toMarkdown(changed.content), new RegExp(other.id));
    const position = createColumns(3); position.children[1].children = [createPageLink(child, "child")];
    const atCursor = await service.create(actor, { title: "Place me", parentId: parent.id, linkInParent: false, mutationId: crypto.randomUUID() });
    assert.equal((await service.get(actor, parent.id)).revision, changed.revision);
    assert.equal(atCursor.parentId, parent.id);
  } finally { await db.close(); }
});
test("upgrading backfills legacy child-page links without duplicating references or losing text", async () => {
  const db = await openDatabase("file::memory:"), service = new RaspberryService(db), actor = localActor(); await service.seed();
  try {
    const parent = await service.create(actor, { title: "Legacy parent", mutationId: crypto.randomUUID() });
    const child = await service.create(actor, { title: "Legacy child", parentId: parent.id, linkInParent: false, mutationId: crypto.randomUUID() });
    await db.transaction((sql) => sql.query("DELETE FROM schema_migrations WHERE version=2"));
    await service.seed(); const migrated = await service.get(actor, parent.id); await service.seed();
    assert.equal(migrated.content.at(-1)?.props.pageId, child.id); assert.deepEqual(migrated.content[0], parent.content[0]);
    assert.equal((await service.get(actor, parent.id)).revision, migrated.revision);
    assert.equal((await service.history(actor, parent.id))[0].clientId, "migration");
  } finally { await db.close(); }
});
test("page references reject inaccessible targets and remain editable after a target is trashed", async () => {
  const db = await openDatabase("file::memory:"), service = new RaspberryService(db), actor = localActor(); await service.seed();
  try {
    const otherWorkspace = crypto.randomUUID(), otherId = crypto.randomUUID();
    await db.transaction(async (sql) => {
      await sql.query("INSERT INTO workspaces(id,name) VALUES($1,$2)", [otherWorkspace, "Other"]);
      await sql.query("INSERT INTO pages(id,workspace_id,title,icon,content,plain_text,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)", [otherId, otherWorkspace, "Secret", "file", JSON.stringify(emptyDocument()), "", new Date().toISOString()]);
    });
    const doc = createColumns(2); doc.children[1].children = [createPageLink({ id: otherId, title: "Secret" })];
    await assert.rejects(service.create(actor, { content: [doc], mutationId: crypto.randomUUID() }), (error: AppError) => error.status === 404);
    const target = await service.create(actor, { title: "Target", mutationId: crypto.randomUUID() });
    const parent = await service.create(actor, { content: [createPageLink(target)], mutationId: crypto.randomUUID() });
    await service.trash(actor, target.id, 1);
    await service.patch(actor, parent.id, { title: "Still editable", content: parent.content, expectedRevision: 1, mutationId: crypto.randomUUID() });
    assert.equal((await service.get(actor, parent.id)).title, "Still editable");
  } finally { await db.close(); }
});
test("validation rejects malformed layouts and unsafe links inside table cells", () => {
  const columns = createColumns(3);
  assert.equal(documentSchema.safeParse([columns]).success, true);
  assert.equal(documentSchema.safeParse([columns.children[0]]).success, false);
  assert.equal(documentSchema.safeParse([{ ...columns, children: columns.children.slice(0, 1) }]).success, false);
  assert.equal(documentSchema.safeParse([{ ...createCallout(), children: [] }]).success, false);
  assert.equal(documentSchema.safeParse([{ ...createCallout(), props: { color: "url(javascript:alert(1))", emoji: "💡" } }]).success, false);
  const bad = table(); if (bad.content && !Array.isArray(bad.content)) bad.content.rows[1].cells[0] = [{ type: "link", href: "javascript:alert(1)", content: [] }];
  assert.equal(documentSchema.safeParse([bad]).success, false);
  assert.throws(() => createColumns(6));
});
