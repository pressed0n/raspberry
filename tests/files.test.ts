import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMigrated } from "./schema";
import { FileStore } from "../src/server/files";
import { AppError, localActor } from "../src/server/service";

/**
 * Uploads are content-addressed on disk, so every test needs its own directory —
 * otherwise the dedupe test would pass for the wrong reason, finding a blob a
 * previous run left behind.
 */
const dir = mkdtempSync(join(tmpdir(), "raspberry-uploads-"));
process.env.RASPBERRY_UPLOADS_DIR = dir;

const owner = localActor();

/** Two pixels of PNG, the smallest thing that is really an image. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYOBAQAWJgMB8y0oQwAAAABJRU5ErkJggg==",
  "base64",
);

async function fixture() {
  const db = await openMigrated();
  return { db, store: new FileStore(db) };
}

const upload = (name: string, bytes: Buffer) =>
  new Request(`http://localhost/api/files?name=${encodeURIComponent(name)}`, { method: "POST", body: new Uint8Array(bytes) });

test("stores a file and serves the same bytes back", async () => {
  const { store } = await fixture();
  const saved = await store.store(owner, "pixel.png", upload("pixel.png", PNG));

  assert.equal(saved.mime, "image/png", "the type comes from the extension, not the client");
  assert.equal(saved.size, PNG.length);
  assert.match(saved.url, /^\/api\/files\/[0-9a-f-]{36}$/);

  const response = await store.serve(owner, saved.id, null);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.match(String(response.headers.get("content-disposition")), /^inline/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), PNG);
});

test("the same bytes are stored once and share one id", async () => {
  const { store } = await fixture();
  const first = await store.store(owner, "one.png", upload("one.png", PNG));
  const second = await store.store(owner, "two.png", upload("two.png", PNG));
  assert.equal(second.id, first.id, "deduplication is by content, not by name");
});

test("a range request returns 206 and only the bytes asked for", async () => {
  const { store } = await fixture();
  const saved = await store.store(owner, "pixel.png", upload("pixel.png", PNG));
  const response = await store.serve(owner, saved.id, "bytes=0-9");

  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), `bytes 0-9/${PNG.length}`);
  assert.equal(response.headers.get("content-length"), "10");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), PNG.subarray(0, 10));
});

test("an oversized file is refused before it is written", async () => {
  const { store } = await fixture();
  const tooBig = Buffer.alloc(26 * 1024 * 1024, 1);
  await assert.rejects(
    () => store.store(owner, "huge.png", upload("huge.png", tooBig)),
    (error: AppError) => error.status === 413 && error.code === "file_too_large",
  );
});

test("an empty upload is refused", async () => {
  const { store } = await fixture();
  await assert.rejects(
    () => store.store(owner, "nothing.png", upload("nothing.png", Buffer.alloc(0))),
    (error: AppError) => error.status === 400,
  );
});

test("a path in the name cannot escape the upload directory", async () => {
  const { store } = await fixture();
  const saved = await store.store(owner, "../../../etc/passwd", upload("../../../etc/passwd", Buffer.from("not a passwd file")));
  assert.equal(saved.name, "passwd");
  assert.equal(saved.mime, "application/octet-stream", "an unknown extension is never treated as script or markup");
});

test("an uploaded page is served as a download, not as a document", async () => {
  const { store } = await fixture();
  const saved = await store.store(owner, "evil.html", upload("evil.html", Buffer.from("<script>alert(1)</script>")));
  const response = await store.serve(owner, saved.id, null);
  assert.match(String(response.headers.get("content-disposition")), /^attachment/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("download=1 turns an image into a file to save, with its stored name", async () => {
  /* The cell's save button. An image is served `inline` so the name link can show it; the same
     bytes asked for as a download must arrive as an attachment, or the browser opens a tab and
     the person still has no file. The name in the header is the stored one, not the id. */
  const { store } = await fixture();
  const saved = await store.store(owner, "sunset photo.png", upload("sunset photo.png", PNG));

  const view = await store.serve(owner, saved.id, null);
  assert.match(String(view.headers.get("content-disposition")), /^inline/);

  const save = await store.serve(owner, saved.id, null, true);
  assert.match(String(save.headers.get("content-disposition")), /^attachment/);
  assert.match(String(save.headers.get("content-disposition")), /filename\*=UTF-8''sunset%20photo\.png/);
  /* The flag changes the disposition and nothing else: same type, same bytes, same immutability. */
  assert.equal(save.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await save.arrayBuffer()), PNG);
});

test("svg is sandboxed so it cannot run script on our origin", async () => {
  const { store } = await fixture();
  const saved = await store.store(owner, "logo.svg", upload("logo.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')));
  const response = await store.serve(owner, saved.id, null);
  assert.match(String(response.headers.get("content-security-policy")), /sandbox/);
});

test("a missing or foreign file is a 404, never a directory listing", async () => {
  const { store } = await fixture();
  const saved = await store.store(owner, "pixel.png", upload("pixel.png", PNG));
  const stranger = { ...owner, workspaceId: "00000000-0000-4000-8000-0000000000ff" };

  await assert.rejects(() => store.serve(owner, "not-a-uuid", null), (error: AppError) => error.status === 404);
  await assert.rejects(() => store.serve(stranger, saved.id, null), (error: AppError) => error.status === 404);
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
