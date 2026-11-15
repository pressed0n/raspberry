// Seeds a disposable instance with a Checkbox column, so the *cell* tick can be measured.
//
// WHY THREE ROWS AND NOT ONE
// A checkbox column has three states, not two: `true`, `false`, and `null` — a row nobody
// has touched. The owner's report is that the ticked box and the unticked box sit on
// different pixels, so the probe needs both in the same column, side by side, at the same
// scroll offset. The untouched row is the third case, because `null` renders the same empty
// box as `false` and any fix that treats them differently would be invisible without it.
//
// Usage: BASE=http://127.0.0.1:3105 node scripts/seed-qa-checkbox.mjs
const BASE = process.env.BASE ?? "http://127.0.0.1:3105";
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

const database = await call("/api/databases", "POST", { title: "QA checkbox", mutationId: id() });

/* No `config`: a checkbox property has nothing to configure, which is the shape a person
   gets from the property menu and the shape the probe has to render. */
const withBox = await call(`/api/databases/${database.id}/properties`, "POST", {
  type: "checkbox",
  name: "Done",
  config: {},
  mutationId: id(),
});
const boxId = withBox.properties.find((property) => property.name === "Done").id;

/* A text column, because the cell's *vertical rhythm* is what the tick has to agree with:
   `31 Oct` and a name share a baseline, and a control that only centres itself in the cell
   can still sit 2px off the words beside it. It is also the column
   `scripts/verify-text-clip.mjs` walks, and having it here means the checkbox runner can
   reuse that sweep without re-seeding. */
await call(`/api/databases/${database.id}/properties`, "POST", {
  type: "text",
  name: "Note",
  config: {},
  mutationId: id(),
});

/* The three states, one row each, in the order the probe reads them. */
const plan = [
  { title: "Ticked", value: true },
  { title: "Cleared", value: false },
  { title: "Untouched", value: undefined },
];

for (const entry of plan) {
  const after = await call(`/api/databases/${database.id}/rows`, "POST", { title: entry.title, mutationId: id() });
  if (entry.value === undefined) continue;
  const row = after.rows.find((item) => item.title === entry.title);
  if (!row) throw new Error(`the seeded row ${entry.title} is not in the payload`);
  await call(`/api/databases/${database.id}/rows/${row.id}`, "PATCH", {
    cells: { [boxId]: entry.value },
    mutationId: id(),
  });
}

const content = [
  { id: id(), type: "paragraph", props: { textColor: "default", backgroundColor: "default", textAlignment: "left" }, content: [{ type: "text", text: "QA checkbox page", styles: {} }], children: [] },
  { id: id(), type: "database", props: { databaseId: database.id, viewId: "" }, children: [] },
];
const created = await fetch(`${BASE}/api/pages`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: BASE, "sec-fetch-site": "same-origin" },
  body: JSON.stringify({ title: "QA checkbox page", content, mutationId: id() }),
});
const createdBody = await created.text();
if (!created.ok) throw new Error(`POST /api/pages → ${created.status} ${createdBody}`);
const page = JSON.parse(createdBody).page ?? JSON.parse(createdBody);

console.log(JSON.stringify({
  pageId: page.id,
  databaseId: database.id,
  boxId,
  rows: plan.map((entry) => `${entry.title}:${String(entry.value)}`),
}, null, 2));
