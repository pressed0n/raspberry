// Seeds an isolated instance with the one thing the sort probe needs: a `select` column
// whose arranged order, alphabetical order and row order are all different.
//
// WHY THREE DIFFERENT ORDERS
// The feature is "sort the rows the way I arranged the tags", and the bug it is easy to
// write is sorting them the way they read instead. A fixture where the arranged order
// happens to be alphabetical — or where the rows were seeded in the arranged order —
// passes with either comparator wired in. So:
//
//   arranged      Gamma, Alpha, Delta, Beta     (the dropdown, grip order)
//   alphabetical  Alpha, Beta, Delta, Gamma     ("A → Z")
//   seeded rows   Row three, Row one, Row five, Row four, Row two
//
// …and one row holds no tag, because "an empty cell sorts last" is a rule every direction
// has to keep, and a table with no empty cell cannot see it.
//
// Usage: BASE=http://127.0.0.1:3100 node scripts/seed-qa-sort.mjs
const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
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

const database = await call("/api/databases", "POST", { title: "QA sort", mutationId: id() });

const options = [
  { id: id(), name: "Gamma", color: "orange", groupId: null },
  { id: id(), name: "Alpha", color: "blue", groupId: null },
  { id: id(), name: "Delta", color: "purple", groupId: null },
  { id: id(), name: "Beta", color: "green", groupId: null },
];

const withTags = await call(`/api/databases/${database.id}/properties`, "POST", {
  type: "select",
  name: "Tags",
  config: { options },
  mutationId: id(),
});
const tagsId = withTags.properties.find((property) => property.name === "Tags").id;
const optionId = (name) => options.find((option) => option.name === name).id;

/* Seeded in an order that is neither the arrangement nor the alphabet. */
const plan = [
  { title: "Row three", tag: "Gamma" },
  { title: "Row one", tag: "Delta" },
  { title: "Row five", tag: null },
  { title: "Row four", tag: "Beta" },
  { title: "Row two", tag: "Alpha" },
];

for (const entry of plan) {
  const after = await call(`/api/databases/${database.id}/rows`, "POST", { title: entry.title, mutationId: id() });
  if (!entry.tag) continue;
  const row = after.rows.find((item) => item.title === entry.title);
  if (!row) throw new Error(`the seeded row ${entry.title} is not in the payload`);
  await call(`/api/databases/${database.id}/rows/${row.id}`, "PATCH", {
    cells: { [tagsId]: optionId(entry.tag) },
    mutationId: id(),
  });
}

const content = [
  { id: id(), type: "paragraph", props: { textColor: "default", backgroundColor: "default", textAlignment: "left" }, content: [{ type: "text", text: "QA sort page", styles: {} }], children: [] },
  { id: id(), type: "database", props: { databaseId: database.id, viewId: "" }, children: [] },
];
const created = await fetch(`${BASE}/api/pages`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: BASE, "sec-fetch-site": "same-origin" },
  body: JSON.stringify({ title: "QA sort page", content, mutationId: id() }),
});
const createdBody = await created.text();
if (!created.ok) throw new Error(`POST /api/pages → ${created.status} ${createdBody}`);
const page = JSON.parse(createdBody).page ?? JSON.parse(createdBody);

console.log(JSON.stringify({
  pageId: page.id,
  databaseId: database.id,
  tagsId,
  arranged: options.map((option) => option.name),
  seeded: plan.map((entry) => `${entry.title}:${entry.tag ?? "-"}`),
}, null, 2));
