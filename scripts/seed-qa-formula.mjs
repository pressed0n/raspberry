// Seeds a disposable instance with three formula columns and the rows that can tell them apart.
//
// WHY THREE COLUMNS AND THREE ROWS
// A formula's interesting states are *per row*, and a single row can only show one of them. So the
// seed has a row with every input filled, a row with the number alone, and a row with nothing —
// which is what "80", "14" and "Empty" are read from. Three columns because a result is not always
// a number: `Total` is arithmetic, `Label` is text built from another property, and `Open` is a
// checkbox, and each prints by a different rule.
//
// WHY THE EXPRESSIONS ARE STORED, NOT HARD-CODED IN THE PROBE
// The probe then asserts that what is stored produces what is drawn — i.e. the read path, not a
// fixture. Changing the expression through the editor is how the write path is tested.
//
// Usage: BASE=http://127.0.0.1:3111 node scripts/seed-qa-formula.mjs
const BASE = process.env.BASE ?? "http://127.0.0.1:3111";
const id = () => crypto.randomUUID();

const HEADERS = {
  /* Local mode refuses a write that does not look like a same-origin browser request. */
  origin: BASE,
  "sec-fetch-site": "same-origin",
  "fetch-site": "same-origin",
};

async function json(path, method, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...HEADERS },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text}`);
  return payload?.database ?? payload;
}

const database = await json("/api/databases", "POST", { title: "QA formula", mutationId: id() });

async function addProperty(type, name, config = {}) {
  const after = await json(`/api/databases/${database.id}/properties`, "POST", { type, name, config, mutationId: id() });
  const property = after.properties.find((candidate) => candidate.name === name);
  if (!property) throw new Error(`the ${name} property is not in the payload`);
  return property;
}

const price = await addProperty("number", "Price");
const done = await addProperty("checkbox", "Done");
const due = await addProperty("date", "Due");

/* The three expressions the probe reads out of a cell. `prop("Price") * 2` is arithmetic over
   another column; `concat` builds text from a computed value; `not` returns a checkbox. */
const total = await addProperty("formula", "Total", { expression: 'prop("Price") * 2' });
const label = await addProperty("formula", "Label", { expression: 'concat("Total ", prop("Total"))' });
const open = await addProperty("formula", "Open", { expression: 'not(prop("Done"))' });

const plan = [
  /* Every input filled: `80`, `Total 80`, `No`. */
  { title: "Alpha", cells: { [price.id]: 40, [done.id]: true, [due.id]: { start: "2026-10-01" } } },
  /* The number alone: `14`, `Total 14`, `Yes` — and the two empty properties read as nothing. */
  { title: "Beta", cells: { [price.id]: 7 } },
  /* Nothing at all: every formula reads `Empty`, which is not the same as `0`. */
  { title: "Gamma", cells: {} },
];

for (const entry of plan) {
  const after = await json(`/api/databases/${database.id}/rows`, "POST", { title: entry.title, mutationId: id() });
  const row = after.rows.find((item) => item.title === entry.title);
  if (!row) throw new Error(`the seeded row ${entry.title} is not in the payload`);
  if (Object.keys(entry.cells).length === 0) continue;
  await json(`/api/databases/${database.id}/rows/${row.id}`, "PATCH", { cells: entry.cells, mutationId: id() });
}

const content = [
  { id: id(), type: "paragraph", props: { textColor: "default", backgroundColor: "default", textAlignment: "left" }, content: [{ type: "text", text: "QA formula page", styles: {} }], children: [] },
  { id: id(), type: "database", props: { databaseId: database.id, viewId: "" }, children: [] },
];
const created = await fetch(`${BASE}/api/pages`, {
  method: "POST",
  headers: { "content-type": "application/json", ...HEADERS },
  body: JSON.stringify({ title: "QA formula page", content, mutationId: id() }),
});
const createdBody = await created.text();
if (!created.ok) throw new Error(`POST /api/pages → ${created.status} ${createdBody}`);
const page = JSON.parse(createdBody).page ?? JSON.parse(createdBody);

console.log(JSON.stringify({
  pageId: page.id,
  databaseId: database.id,
  priceId: price.id,
  doneId: done.id,
  dueId: due.id,
  totalId: total.id,
  labelId: label.id,
  openId: open.id,
}, null, 2));
