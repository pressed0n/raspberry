// Seeds an isolated instance (never the owner's database) with the smallest thing the
// browser probe can exercise: a page holding one database block with a title column, one
// text column, and three entries. Re-runnable against a fresh file.
const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const id = () => crypto.randomUUID();

async function call(path, method, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      /* Local mode refuses a write that does not look like a same-origin browser request —
         the guard that stops a random process on the machine from writing to the database.
         The probe is on the machine, so it says what it is. */
      origin: BASE,
      "sec-fetch-site": "same-origin",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text}`);
  /* Routes answer `{ database }`, services answer the payload itself. */
  return json?.database ?? json;
}

const database = await call("/api/databases", "POST", { title: "QA table", mutationId: id() });
const withProperty = await call(`/api/databases/${database.id}/properties`, "POST", { type: "text", name: "Note", mutationId: id() });
const noteId = withProperty.properties[0].id;

for (const [title, note] of [["Two", "b"], ["One", "a"], ["Three", ""]]) {
  const row = await call(`/api/databases/${database.id}/rows`, "POST", { title, mutationId: id() });
  const rowId = row.rows[row.rows.length - 1].id;
  if (note) await call(`/api/databases/${database.id}/rows/${rowId}`, "PATCH", { cells: { [noteId]: note }, mutationId: id() });
}

const content = [
  { id: id(), type: "paragraph", props: { textColor: "default", backgroundColor: "default", textAlignment: "left" }, content: [{ type: "text", text: "QA page", styles: {} }], children: [] },
  { id: id(), type: "database", props: { databaseId: database.id, viewId: "" }, children: [] },
];
const created = await fetch(`${BASE}/api/pages`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: BASE, "sec-fetch-site": "same-origin" },
  body: JSON.stringify({ title: "QA database page", content, mutationId: id() }),
});
const createdBody = await created.text();
if (!created.ok) throw new Error(`POST /api/pages → ${created.status} ${createdBody}`);
const page = JSON.parse(createdBody).page ?? JSON.parse(createdBody);
console.log(JSON.stringify({ pageId: page.id, databaseId: database.id, noteId }, null, 2));
