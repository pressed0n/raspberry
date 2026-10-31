// Seeds an isolated instance with one database whose *second* column is a Number, so the
// property menu's number-format and decimal-place settings can be driven by a real mouse.
// Never runs against the owner's file: point BASE at a disposable copy (docs/TESTING.md).
const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const id = () => crypto.randomUUID();

async function call(path, method, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
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

const database = await call("/api/databases", "POST", { title: "QA numbers", mutationId: id() });
const withProperty = await call(`/api/databases/${database.id}/properties`, "POST", {
  type: "number",
  name: "Amount",
  mutationId: id(),
});
const amountId = withProperty.properties[0].id;

/* Three values with a fractional part, so a decimal-places change is visible and a
   sort is not a tie. */
for (const [title, amount] of [["Two", 1234.5], ["One", 7], ["Three", 0.25]]) {
  const row = await call(`/api/databases/${database.id}/rows`, "POST", { title, mutationId: id() });
  const rowId = row.rows[row.rows.length - 1].id;
  await call(`/api/databases/${database.id}/rows/${rowId}`, "PATCH", {
    cells: { [amountId]: amount },
    mutationId: id(),
  });
}

const content = [
  { id: id(), type: "paragraph", props: { textColor: "default", backgroundColor: "default", textAlignment: "left" }, content: [{ type: "text", text: "QA numbers", styles: {} }], children: [] },
  { id: id(), type: "database", props: { databaseId: database.id, viewId: "" }, children: [] },
];
const created = await fetch(`${BASE}/api/pages`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: BASE, "sec-fetch-site": "same-origin" },
  body: JSON.stringify({ title: "QA number page", content, mutationId: id() }),
});
const createdBody = await created.text();
if (!created.ok) throw new Error(`POST /api/pages → ${created.status} ${createdBody}`);
const page = JSON.parse(createdBody).page ?? JSON.parse(createdBody);
console.log(JSON.stringify({ pageId: page.id, databaseId: database.id, amountId }, null, 2));
