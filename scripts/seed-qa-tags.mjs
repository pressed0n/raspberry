// Seeds an isolated instance (never the owner's database) with the smallest thing the
// tag probe can exercise: a page holding one database block whose table has the title
// column, a `select` column with two existing options, and a `multiSelect` column with
// none — so the probe proves both "pick what exists" and "create what does not".
//
// Usage: BASE=http://127.0.0.1:3100 node scripts/seed-qa-tags.mjs
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
  return json?.database ?? json;
}

const database = await call("/api/databases", "POST", { title: "QA tags", mutationId: id() });

/* Two options already in the list: the probe must be able to *pick* one without
   creating anything. Their colours are two different palette names, so a chip that
   rendered the wrong token is visible rather than merely absent. */
const options = [
  { id: id(), name: "Alpha", color: "orange", groupId: null },
  { id: id(), name: "Beta", color: "purple", groupId: null },
];
const withStatus = await call(`/api/databases/${database.id}/properties`, "POST", {
  type: "select",
  name: "Status",
  config: { options },
  mutationId: id(),
});
const statusId = withStatus.properties.find((property) => property.name === "Status").id;

const withTags = await call(`/api/databases/${database.id}/properties`, "POST", {
  type: "multiSelect",
  name: "Tags",
  config: { options: [] },
  mutationId: id(),
});
const tagsId = withTags.properties.find((property) => property.name === "Tags").id;

for (const title of ["Row one", "Row two"]) {
  await call(`/api/databases/${database.id}/rows`, "POST", { title, mutationId: id() });
}

const content = [
  { id: id(), type: "paragraph", props: { textColor: "default", backgroundColor: "default", textAlignment: "left" }, content: [{ type: "text", text: "QA tags page", styles: {} }], children: [] },
  { id: id(), type: "database", props: { databaseId: database.id, viewId: "" }, children: [] },
];
const created = await fetch(`${BASE}/api/pages`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: BASE, "sec-fetch-site": "same-origin" },
  body: JSON.stringify({ title: "QA tags page", content, mutationId: id() }),
});
const createdBody = await created.text();
if (!created.ok) throw new Error(`POST /api/pages → ${created.status} ${createdBody}`);
const page = JSON.parse(createdBody).page ?? JSON.parse(createdBody);

console.log(JSON.stringify({ pageId: page.id, databaseId: database.id, statusId, tagsId, options }, null, 2));
