// Seeds a disposable instance with a Files & Media column, real uploaded bytes, and the rows the
// probe needs.
//
// WHY THE FILES ARE UPLOADED HERE AND NOT FAKED
// A Files cell holds *references*, and a reference to bytes that are not on disk is exactly the
// bug this turn removes (typing a name into the old text field produced one). So the seed uploads
// for real through `POST /api/files`, and the two rows it writes hold what the server answered.
// That also means the probe can assert that a thumbnail *painted* rather than that an `<img>` tag
// exists — a 404 image is an `<img>` tag too.
//
// The PNG is a 4×4 red square, 73 bytes, inlined: a seed that read an image from the repo would
// make the probe depend on a fixture that can be moved or renamed.
//
// Usage: BASE=http://127.0.0.1:3110 node scripts/seed-qa-files.mjs
const BASE = process.env.BASE ?? "http://127.0.0.1:3110";
const id = () => crypto.randomUUID();

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGN44OAARwzEcQBGUhYBORcDcwAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n", "latin1");

const HEADERS = {
  /* Local mode refuses a write that does not look like a same-origin browser request. The seed
     is on the machine, so it says what it is. */
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

/** The raw-body upload the app itself uses — same route, same query-string name, no multipart. */
async function upload(name, bytes, type) {
  const response = await fetch(`${BASE}/api/files?name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "content-type": type, ...HEADERS },
    body: bytes,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`POST /api/files?name=${name} → ${response.status} ${text}`);
  return JSON.parse(text).file;
}

const png = await upload("holiday.png", PNG, "image/png");
const pdf = await upload("pitch.pdf", PDF, "application/pdf");

const database = await json("/api/databases", "POST", { title: "QA files", mutationId: id() });
const withFiles = await json(`/api/databases/${database.id}/properties`, "POST", {
  type: "files",
  name: "Files",
  config: {},
  mutationId: id(),
});
const filesId = withFiles.properties.find((property) => property.name === "Files").id;

/* The cell holds `{id,name,mime,size}` and nothing else — `url` is the server's own reply and is
   derived from the id, so storing it would be a second copy of a fact that cannot drift. */
const ref = (file) => ({ id: file.id, name: file.name, mime: file.mime, size: file.size });

/* Four states, and each exists for one section of the probe:
   "Both"    — an image and a document: the thumbnail branch, the badge branch, and `+1`.
   "One"     — a single document: the no-count branch.
   "Nothing" — the empty cell, and the only one that can be pressed expecting "No files".
   "Spare"   — the upload target, untouched by any earlier section.
   "Drop"    — the drop target, for the same reason: a cell that already carries an upload makes
               "the drop added a second file" a question about two writes. */
const plan = [
  { title: "Both", value: [ref(png), ref(pdf)] },
  { title: "One", value: [ref(pdf)] },
  { title: "Nothing", value: undefined },
  { title: "Spare", value: undefined },
  { title: "Drop", value: undefined },
];

for (const entry of plan) {
  const after = await json(`/api/databases/${database.id}/rows`, "POST", { title: entry.title, mutationId: id() });
  if (entry.value === undefined) continue;
  const row = after.rows.find((item) => item.title === entry.title);
  if (!row) throw new Error(`the seeded row ${entry.title} is not in the payload`);
  await json(`/api/databases/${database.id}/rows/${row.id}`, "PATCH", {
    cells: { [filesId]: entry.value },
    mutationId: id(),
  });
}

const content = [
  { id: id(), type: "paragraph", props: { textColor: "default", backgroundColor: "default", textAlignment: "left" }, content: [{ type: "text", text: "QA files page", styles: {} }], children: [] },
  { id: id(), type: "database", props: { databaseId: database.id, viewId: "" }, children: [] },
];
const created = await fetch(`${BASE}/api/pages`, {
  method: "POST",
  headers: { "content-type": "application/json", ...HEADERS },
  body: JSON.stringify({ title: "QA files page", content, mutationId: id() }),
});
const createdBody = await created.text();
if (!created.ok) throw new Error(`POST /api/pages → ${created.status} ${createdBody}`);
const page = JSON.parse(createdBody).page ?? JSON.parse(createdBody);

console.log(JSON.stringify({
  pageId: page.id,
  databaseId: database.id,
  filesId,
  pngId: png.id,
  pngBytes: PNG.length,
  pdfId: pdf.id,
  pdfBytes: PDF.length,
}, null, 2));
