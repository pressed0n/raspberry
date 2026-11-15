// Seeds a disposable instance with a Place column, so a place cell can be searched and picked.
//
// WHY THESE FOUR ROWS
// The cell has exactly two shapes and two empty states, and the probe needs to see all four
// at once: a cell that was *typed* (a string, no point), a cell that was *picked* (a record
// with a point — the shape a map view will read), an empty cell to search from, and a second
// empty cell, so the "nothing is lost when the search cannot answer" check does not have to
// start from a cell a previous section already wrote to.
//
// Usage: BASE=http://127.0.0.1:3108 node scripts/seed-qa-places.mjs
const BASE = process.env.BASE ?? "http://127.0.0.1:3108";
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

const database = await call("/api/databases", "POST", { title: "QA places", mutationId: id() });

const withPlace = await call(`/api/databases/${database.id}/properties`, "POST", {
  type: "place",
  name: "Where",
  config: {},
  mutationId: id(),
});
const placeId = withPlace.properties.find((property) => property.name === "Where").id;

/* The picked value, exactly as a search would have committed it. Written through the API on
   purpose: it makes the server's own `coerce` part of the seed, so a value shape the server
   disagrees with fails here rather than in the browser. */
const picked = {
  address: "Eiffel Tower, Paris, Île-de-France, France",
  name: "Eiffel Tower",
  lat: 48.8584,
  lng: 2.2945,
  id: "W:5013364",
};

const plan = [
  { title: "Typed", value: "12 Rue de Rivoli, Paris" },
  { title: "Picked", value: picked },
  { title: "Search", value: undefined },
  { title: "Spare", value: undefined },
  /* The fifth exists for the last section: the check that nothing is lost when the provider
     cannot answer types a fresh query, and a cell a previous section already wrote to would
     make the "what got stored" assertion a question about two writes instead of one. */
  { title: "Offline", value: undefined },
  /* And two for the ranking section, one query each, for the same reason: the owner's two
     searches are different questions and a shared cell would leave the second one typing into
     the first one's draft. */
  { title: "Village", value: undefined },
  { title: "Address", value: undefined },
];

for (const entry of plan) {
  const after = await call(`/api/databases/${database.id}/rows`, "POST", { title: entry.title, mutationId: id() });
  if (entry.value === undefined) continue;
  const row = after.rows.find((item) => item.title === entry.title);
  if (!row) throw new Error(`the seeded row ${entry.title} is not in the payload`);
  await call(`/api/databases/${database.id}/rows/${row.id}`, "PATCH", {
    cells: { [placeId]: entry.value },
    mutationId: id(),
  });
}

const content = [
  { id: id(), type: "paragraph", props: { textColor: "default", backgroundColor: "default", textAlignment: "left" }, content: [{ type: "text", text: "QA places page", styles: {} }], children: [] },
  { id: id(), type: "database", props: { databaseId: database.id, viewId: "" }, children: [] },
];
const created = await fetch(`${BASE}/api/pages`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: BASE, "sec-fetch-site": "same-origin" },
  body: JSON.stringify({ title: "QA places page", content, mutationId: id() }),
});
const createdBody = await created.text();
if (!created.ok) throw new Error(`POST /api/pages → ${created.status} ${createdBody}`);
const page = JSON.parse(createdBody).page ?? JSON.parse(createdBody);

console.log(JSON.stringify({
  pageId: page.id,
  databaseId: database.id,
  placeId,
  rows: plan.map((entry) => `${entry.title}:${typeof entry.value === "string" ? entry.value : typeof entry.value === "object" ? "record" : "empty"}`),
}, null, 2));
