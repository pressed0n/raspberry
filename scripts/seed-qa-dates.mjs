// Seeds a disposable instance with a Date column, so the picker can be driven end to end.
//
// WHY A DATE-ONLY COLUMN WITH *LONG* FORMAT AND NO CLOCKS
// That is the shape a person lands on by adding a Date property and changing nothing: ISO
// storage, `format: "long"` is the readable one, and `includeTime: false`. The probe then
// turns the clocks on through the UI, so the property write is exercised rather than
// assumed — and every row starts empty except one, whose seeded date proves the column
// renders in its configured format before anything is clicked.
//
// Usage: BASE=http://127.0.0.1:3103 node scripts/seed-qa-dates.mjs
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

const database = await call("/api/databases", "POST", { title: "QA dates", mutationId: id() });

const withDate = await call(`/api/databases/${database.id}/properties`, "POST", {
  type: "date",
  name: "When",
  config: { format: "long", includeTime: false, timeFormat: "24" },
  mutationId: id(),
});
const dateId = withDate.properties.find((property) => property.name === "When").id;

/* Empty everywhere but one: a date the probe did not write, so the *rendering* of a stored
   value is checked as well as the writing of a new one. */
const plan = [
  { title: "Seeded", start: "2026-10-30" },
  { title: "Single", start: null },
  { title: "Range", start: null },
  { title: "Meeting", start: null },
];

for (const entry of plan) {
  const after = await call(`/api/databases/${database.id}/rows`, "POST", { title: entry.title, mutationId: id() });
  if (!entry.start) continue;
  const row = after.rows.find((item) => item.title === entry.title);
  if (!row) throw new Error(`the seeded row ${entry.title} is not in the payload`);
  await call(`/api/databases/${database.id}/rows/${row.id}`, "PATCH", {
    cells: { [dateId]: { start: entry.start, end: null } },
    mutationId: id(),
  });
}

const content = [
  { id: id(), type: "paragraph", props: { textColor: "default", backgroundColor: "default", textAlignment: "left" }, content: [{ type: "text", text: "QA dates page", styles: {} }], children: [] },
  { id: id(), type: "database", props: { databaseId: database.id, viewId: "" }, children: [] },
];
const created = await fetch(`${BASE}/api/pages`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: BASE, "sec-fetch-site": "same-origin" },
  body: JSON.stringify({ title: "QA dates page", content, mutationId: id() }),
});
const createdBody = await created.text();
if (!created.ok) throw new Error(`POST /api/pages → ${created.status} ${createdBody}`);
const page = JSON.parse(createdBody).page ?? JSON.parse(createdBody);

console.log(JSON.stringify({
  pageId: page.id,
  databaseId: database.id,
  dateId,
  rows: plan.map((entry) => `${entry.title}:${entry.start ?? "-"}`),
}, null, 2));
