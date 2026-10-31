// Seeds an isolated instance with the one thing the reorder probe needs: a `select`
// column holding four options in a known order, and one row.
//
// Four, not two: with two, "moved down one" and "swapped" are the same array, so a
// wrong splice reads as a pass. With four, a drag from the top to the bottom and a
// drag back are two different permutations.
//
// Usage: BASE=http://127.0.0.1:3100 node scripts/seed-qa-reorder.mjs
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
      "sec-fetch-site": "same-origin",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text}`);
  return json?.database ?? json;
}

const database = await call("/api/databases", "POST", { title: "QA reorder", mutationId: id() });

/* Named so that alphabetical order is *not* the seed order — if the probe ever measured a
   list the server had sorted, `Delta,Beta,Gamma,Alpha` would be the tell. */
const options = [
  { id: id(), name: "Gamma", color: "orange", groupId: null },
  { id: id(), name: "Alpha", color: "blue", groupId: null },
  { id: id(), name: "Delta", color: "purple", groupId: null },
  { id: id(), name: "Beta", color: "green", groupId: null },
];

const withStatus = await call(`/api/databases/${database.id}/properties`, "POST", {
  type: "select",
  name: "Status",
  config: { options },
  mutationId: id(),
});
const statusId = withStatus.properties.find((property) => property.name === "Status").id;

await call(`/api/databases/${database.id}/rows`, "POST", { title: "Row one", mutationId: id() });

const content = [
  { id: id(), type: "paragraph", props: { textColor: "default", backgroundColor: "default", textAlignment: "left" }, content: [{ type: "text", text: "QA reorder page", styles: {} }], children: [] },
  { id: id(), type: "database", props: { databaseId: database.id, viewId: "" }, children: [] },
];
const created = await fetch(`${BASE}/api/pages`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: BASE, "sec-fetch-site": "same-origin" },
  body: JSON.stringify({ title: "QA reorder page", content, mutationId: id() }),
});
const createdBody = await created.text();
if (!created.ok) throw new Error(`POST /api/pages → ${created.status} ${createdBody}`);
const page = JSON.parse(createdBody).page ?? JSON.parse(createdBody);

console.log(JSON.stringify({
  pageId: page.id,
  databaseId: database.id,
  statusId,
  options: options.map((option) => option.name),
}, null, 2));
