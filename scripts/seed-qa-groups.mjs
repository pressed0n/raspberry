// Seeds an isolated instance with a Status column shaped exactly like the owner's live one:
// **no stored groups** and every tag's `groupId` null.
//
// WHY THAT SHAPE MATTERS
// The feature is "the three Notion groups are editable", and the easy bug is to build the
// editor against a column that already has groups — every fresh fixture has them, because
// whoever seeded it wrote them. The owner's column has `groups: []`, so the defaults have
// to be materialised for *reading* and stored only on the first *edit*, and a tag whose
// `groupId` is null has to be drawn in the first group rather than nowhere.
//
// Usage: BASE=http://127.0.0.1:3103 node scripts/seed-qa-groups.mjs
const BASE = process.env.BASE ?? "http://127.0.0.1:3103";
const id = () => crypto.randomUUID();

async function call(path, method, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      /* Local mode refuses a write that does not look like a same-origin browser request.
         The probe is on the machine, so it says what it is. */
      origin: BASE,
      "fetch-site": "same-origin",
      "sec-fetch-site": "same-origin",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text}`);
  return json?.database ?? json;
}

const database = await call("/api/databases", "POST", { title: "QA groups", mutationId: id() });

/* Null `groupId` on purpose — this is what the live column has. */
const options = [
  { id: id(), name: "Backlog", color: "gray", groupId: null },
  { id: id(), name: "Doing", color: "blue", groupId: null },
  { id: id(), name: "Done", color: "green", groupId: null },
];

const withStatus = await call(`/api/databases/${database.id}/properties`, "POST", {
  type: "status",
  name: "Status",
  /* No `groups` key at all — the schema's default (`[]`) is what the owner's column stores. */
  config: { options },
  mutationId: id(),
});
const statusId = withStatus.properties.find((property) => property.name === "Status").id;
const optionId = (name) => options.find((option) => option.name === name).id;

const plan = [
  { title: "Row one", tag: "Backlog" },
  { title: "Row two", tag: "Doing" },
  { title: "Row three", tag: "Done" },
  { title: "Row four", tag: null },
];

for (const entry of plan) {
  const after = await call(`/api/databases/${database.id}/rows`, "POST", { title: entry.title, mutationId: id() });
  if (!entry.tag) continue;
  const row = after.rows.find((item) => item.title === entry.title);
  if (!row) throw new Error(`the seeded row ${entry.title} is not in the payload`);
  await call(`/api/databases/${database.id}/rows/${row.id}`, "PATCH", {
    cells: { [statusId]: optionId(entry.tag) },
    mutationId: id(),
  });
}

const content = [
  { id: id(), type: "paragraph", props: { textColor: "default", backgroundColor: "default", textAlignment: "left" }, content: [{ type: "text", text: "QA groups page", styles: {} }], children: [] },
  { id: id(), type: "database", props: { databaseId: database.id, viewId: "" }, children: [] },
];
const created = await fetch(`${BASE}/api/pages`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: BASE, "sec-fetch-site": "same-origin" },
  body: JSON.stringify({ title: "QA groups page", content, mutationId: id() }),
});
const createdBody = await created.text();
if (!created.ok) throw new Error(`POST /api/pages → ${created.status} ${createdBody}`);
const page = JSON.parse(createdBody).page ?? JSON.parse(createdBody);

console.log(JSON.stringify({
  pageId: page.id,
  databaseId: database.id,
  statusId,
  groupsStored: 0,
  tags: options.map((option) => option.name),
  seeded: plan.map((entry) => `${entry.title}:${entry.tag ?? "-"}`),
}, null, 2));
