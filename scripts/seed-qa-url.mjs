// Seeds a disposable instance with a URL column, so a link cell can be read and pressed.
//
// WHY THESE THREE ROWS
// A URL column's value has three shapes the probe has to see at once: an address with the
// two things this turn removes (`https://www.`), one with a scheme worth keeping (a local
// `http://127.0.0.1:<port>/…` — the probe presses *this* opener, so the new tab it opens is
// served by the disposable instance instead of the internet), and an empty cell, which must
// offer nothing to open. One row would only prove the shortening on the string it was
// written against.
//
// Usage: BASE=http://127.0.0.1:3107 node scripts/seed-qa-url.mjs
const BASE = process.env.BASE ?? "http://127.0.0.1:3107";
const id = () => crypto.randomUUID();

async function call(path, method, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      /* Local mode refuses a write that does not look like a same-origin browser request.
         The seed is on the machine, so it says what it is. */
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

const database = await call("/api/databases", "POST", { title: "QA url", mutationId: id() });

/* The default config, explicitly: a URL column has one setting and it is off, which is the
   state the probe has to find the menu row in. */
const withLink = await call(`/api/databases/${database.id}/properties`, "POST", {
  type: "url",
  name: "Link",
  config: {},
  mutationId: id(),
});
const linkId = withLink.properties.find((property) => property.name === "Link").id;

/* The values, as a person would type them: the first is what a paste of a shared link looks
   like, the second is an address whose scheme is the point — plain `http:` to this instance,
   and the one the probe presses, so the page it opens is served by the disposable copy
   instead of the internet. */
const plan = [
  { title: "Site", value: "https://www.example.com/docs" },
  { title: "Local", value: `${BASE}/api/health` },
  { title: "Empty", value: undefined },
];

for (const entry of plan) {
  const after = await call(`/api/databases/${database.id}/rows`, "POST", { title: entry.title, mutationId: id() });
  if (entry.value === undefined) continue;
  const row = after.rows.find((item) => item.title === entry.title);
  if (!row) throw new Error(`the seeded row ${entry.title} is not in the payload`);
  await call(`/api/databases/${database.id}/rows/${row.id}`, "PATCH", {
    cells: { [linkId]: entry.value },
    mutationId: id(),
  });
}

const content = [
  { id: id(), type: "paragraph", props: { textColor: "default", backgroundColor: "default", textAlignment: "left" }, content: [{ type: "text", text: "QA url page", styles: {} }], children: [] },
  { id: id(), type: "database", props: { databaseId: database.id, viewId: "" }, children: [] },
];
const created = await fetch(`${BASE}/api/pages`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: BASE, "sec-fetch-site": "same-origin" },
  body: JSON.stringify({ title: "QA url page", content, mutationId: id() }),
});
const createdBody = await created.text();
if (!created.ok) throw new Error(`POST /api/pages → ${created.status} ${createdBody}`);
const page = JSON.parse(createdBody).page ?? JSON.parse(createdBody);

console.log(JSON.stringify({
  pageId: page.id,
  databaseId: database.id,
  linkId,
  rows: plan.map((entry) => `${entry.title}:${String(entry.value)}`),
}, null, 2));
