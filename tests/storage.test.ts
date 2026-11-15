import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "../src/server/files";
import { AppError, localActor } from "../src/server/service";
import {
  DiskBlobs,
  blobKey,
  incomingKey,
  isIncomingKey,
  presignS3Put,
  signS3Request,
  type BlobRange,
  type BlobStore,
  type S3Config,
} from "../src/server/storage";
import { openMigrated } from "./schema";

/**
 * Uploaded bytes, and the address they live at.
 *
 * Two things are being held down here.
 *
 * **The signature.** A hosted deployment cannot be verified by a unit test, so what is
 * pinned instead is the part that silently breaks: the canonical request. Signed-header
 * ordering, the RFC 3986 escaping, the date scope in `Credential`, and determinism for a
 * fixed clock. A wrong signature is a 403 that says "SignatureDoesNotMatch" and nothing
 * else, so the only defence is that it was right before it was deployed.
 *
 * **The direct-upload path.** A presigned PUT cannot carry a payload hash the endpoint
 * will accept, so the client's claim about its own bytes is worthless. These tests prove
 * the claim is not used: the object is hashed by the server, the cap is enforced against
 * the real byte count, and identical bytes arriving by either route get one id.
 */

const dir = mkdtempSync(join(tmpdir(), "raspberry-storage-"));
process.env.RASPBERRY_UPLOADS_DIR = dir;
const owner = localActor();
const MB = 1024 * 1024;

const config: S3Config = {
  endpoint: "https://storage.test",
  region: "eu-central-1",
  bucket: "raspberry-uploads",
  accessKeyId: "nak_live_test",
  secretAccessKey: "nsk_live_test",
};

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYOBAQAWJgMB8y0oQwAAAABJRU5ErkJggg==",
  "base64",
);

/** Object storage, in a Map. Same contract, no network. */
class MemoryBlobs implements BlobStore {
  readonly kind = "s3" as const;
  readonly objects = new Map<string, Buffer>();

  stagingDir(): string {
    return dir;
  }
  async put(key: string, sourcePath: string): Promise<void> {
    this.objects.set(key, readFileSync(sourcePath));
  }
  async head(key: string): Promise<{ size: number } | null> {
    const bytes = this.objects.get(key);
    return bytes ? { size: bytes.length } : null;
  }
  async read(key: string, range?: BlobRange): Promise<ReadableStream | null> {
    const bytes = this.objects.get(key);
    if (!bytes) return null;
    const slice = range ? bytes.subarray(range.start, range.end + 1) : bytes;
    return new Response(slice as unknown as BodyInit).body;
  }
  async remove(key: string): Promise<void> {
    this.objects.delete(key);
  }
  async copy(fromKey: string, toKey: string): Promise<void> {
    const bytes = this.objects.get(fromKey);
    if (bytes) this.objects.set(toKey, bytes);
  }
  presignPut(key: string): string | null {
    return `https://storage.test/${key}?X-Amz-Signature=test`;
  }
}

const fixture = async (store?: BlobStore) => {
  const db = await openMigrated();
  return new FileStore(db, store);
};

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** What the browser does after `/presign`: put the bytes at the key it was given. */
async function push(store: MemoryBlobs, key: string, bytes: Buffer) {
  store.objects.set(key, bytes);
}

test("a blob key names a workspace, so no two accounts can collide", () => {
  assert.equal(blobKey("ws-a", "deadbeef"), "w/ws-a/deadbeef");
  assert.notEqual(blobKey("ws-a", "deadbeef"), blobKey("ws-b", "deadbeef"));
});

test("an incoming key is only accepted for the workspace it was issued to", () => {
  const key = incomingKey("ws-a", randomUUID());
  assert.equal(isIncomingKey(key, "ws-a"), true);
  assert.equal(isIncomingKey(key, "ws-b"), false, "a key is not a capability across accounts");
  assert.equal(isIncomingKey(blobKey("ws-a", "deadbeef"), "ws-a"), false, "a verified blob is never an upload target");
  assert.equal(isIncomingKey("i/ws-a/../../etc/passwd", "ws-a"), false);
  assert.equal(isIncomingKey("i/ws-a/not-a-uuid", "ws-a"), false);
});

test("a signed request carries the date, scope and sorted headers the signature is defined over", () => {
  const signed = signS3Request(config, "PUT", "w/ws-a/abc", {
    payloadHash: "a".repeat(64),
    now: new Date("2024-01-01T00:00:00Z"),
  });
  assert.equal(signed.url, "https://storage.test/raspberry-uploads/w/ws-a/abc");
  assert.equal(signed.headers["x-amz-date"], "20240101T000000Z");
  assert.match(String(signed.headers.authorization), /Credential=nak_live_test\/20240101\/eu-central-1\/s3\/aws4_request/);
  assert.match(String(signed.headers.authorization), /SignedHeaders=host;x-amz-content-sha256;x-amz-date/);
  assert.match(String(signed.headers.authorization), /Signature=[0-9a-f]{64}$/);
});

test("the same request signs identically twice, and differently when the bytes differ", () => {
  const at = new Date("2024-06-01T12:00:00Z");
  const first = signS3Request(config, "PUT", "w/ws-a/abc", { payloadHash: "a".repeat(64), now: at });
  const second = signS3Request(config, "PUT", "w/ws-a/abc", { payloadHash: "a".repeat(64), now: at });
  const other = signS3Request(config, "PUT", "w/ws-a/abc", { payloadHash: "b".repeat(64), now: at });
  assert.deepEqual(first.headers, second.headers);
  assert.notEqual(first.headers.authorization, other.headers.authorization, "the payload hash is part of what is signed");
});

test("a key containing characters that need escaping is signed over its encoded form", () => {
  const signed = signS3Request(config, "GET", "w/ws a/x+y", { payloadHash: "c".repeat(64) });
  assert.equal(signed.url, "https://storage.test/raspberry-uploads/w/ws%20a/x%2By");
});

test("a presigned PUT is host-signed and time-boxed, and carries no payload hash", () => {
  const url = presignS3Put(config, "i/ws-a/abc", 900, new Date("2024-01-01T00:00:00Z"));
  assert.match(url, /^https:\/\/storage\.test\/raspberry-uploads\/i\/ws-a\/abc\?/);
  assert.match(url, /X-Amz-Expires=900/);
  assert.match(url, /X-Amz-SignedHeaders=host/);
  assert.match(url, /X-Amz-Signature=[0-9a-f]{64}$/);
  assert.doesNotMatch(url, /a{64}/, "the endpoint refuses any payload hash on a presigned request");
});

test("the disk keeps its flat, hash-named layout so existing images still resolve", async () => {
  const store = new DiskBlobs();
  const bytes = Buffer.from("already on disk");
  const source = join(dir, `source-${randomUUID()}`);
  writeFileSync(source, bytes);

  await store.put(`w/ws-a/${sha(bytes)}`, source);
  assert.equal(existsSync(join(dir, sha(bytes))), true, "the workspace prefix is a bucket concern, not a disk one");
  assert.equal((await store.head(`w/ws-a/${sha(bytes)}`))?.size, bytes.length);

  const stream = await store.read(`w/ws-a/${sha(bytes)}`, { start: 0, end: 5 });
  assert.equal(Buffer.from(await new Response(stream).arrayBuffer()).toString(), "alread");
  assert.equal(store.presignPut(`w/ws-a/${sha(bytes)}`, 900), null, "a disk cannot accept a direct upload");
});

test("a direct upload is hashed by the server and lands at its content address", async () => {
  const store = new MemoryBlobs();
  const files = await fixture(store);

  const ticket = await files.presign(owner, "photo.png", PNG.length);
  assert.match(ticket.url, /^https:\/\/storage\.test\/i\//);
  await push(store, ticket.key, PNG);

  const saved = await files.complete(owner, "photo.png", ticket.key);
  assert.equal(saved.mime, "image/png");
  assert.equal(saved.size, PNG.length);
  assert.equal(store.objects.has(blobKey(owner.workspaceId, sha(PNG))), true, "the bytes moved to their hash");
  assert.equal(store.objects.has(ticket.key), false, "nothing is left at the upload key");

  const served = await files.serve(owner, saved.id, null);
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), PNG);
});

test("the size a client declares is not the size that is enforced", async () => {
  const store = new MemoryBlobs();
  const files = await fixture(store);

  /* The claim is a lie: 1 KB declared, 26 MB sent. `presign` believed the small number,
     so only the real byte count can catch this — which is what `complete` does. */
  const ticket = await files.presign(owner, "huge.png", 1024);
  await push(store, ticket.key, Buffer.alloc(26 * MB, 1));

  await assert.rejects(
    () => files.complete(owner, "huge.png", ticket.key),
    (error: AppError) => error.status === 413 && error.code === "file_too_large",
  );
  assert.equal(store.objects.has(ticket.key), false, "the refused bytes are removed");
});

test("a presigned upload over the cap is refused before any bytes move", async () => {
  const store = new MemoryBlobs();
  const files = await fixture(store);
  await assert.rejects(
    () => files.presign(owner, "huge.png", 26 * MB),
    (error: AppError) => error.status === 413,
  );
  await assert.rejects(() => files.presign(owner, "empty.png", 0), (error: AppError) => error.status === 400);
});

test("an upload key belonging to another workspace is refused", async () => {
  const store = new MemoryBlobs();
  const files = await fixture(store);
  const stranger = incomingKey("00000000-0000-4000-8000-0000000000ff", randomUUID());
  await push(store, stranger, PNG);
  await assert.rejects(
    () => files.complete(owner, "photo.png", stranger),
    (error: AppError) => error.status === 400 && error.code === "invalid_upload",
  );
});

test("an upload that never arrived is an error, not an empty file", async () => {
  const store = new MemoryBlobs();
  const files = await fixture(store);
  await assert.rejects(
    () => files.complete(owner, "photo.png", incomingKey(owner.workspaceId, randomUUID())),
    (error: AppError) => error.status === 400 && error.code === "missing_upload",
  );
});

test("identical bytes get one id whether they arrive directly or through the app", async () => {
  const store = new MemoryBlobs();
  const files = await fixture(store);

  const direct = await files.presign(owner, "photo.png", PNG.length);
  await push(store, direct.key, PNG);
  const first = await files.complete(owner, "photo.png", direct.key);

  const posted = await files.store(
    owner,
    "same-photo.png",
    new Request(`http://localhost/api/files?name=${encodeURIComponent("same-photo.png")}`, { method: "POST", body: new Uint8Array(PNG) }),
  );

  assert.equal(posted.id, first.id, "content addressing holds across both upload paths");
  assert.equal(first.name, "photo.png", "the first name wins, and deduplication does not rewrite it");
  assert.equal(store.objects.size, 1, "one copy of the bytes");
});

test("a second direct upload of the same bytes is deleted and the first file returned", async () => {
  const store = new MemoryBlobs();
  const files = await fixture(store);

  const one = await files.presign(owner, "photo.png", PNG.length);
  await push(store, one.key, PNG);
  const first = await files.complete(owner, "photo.png", one.key);

  const two = await files.presign(owner, "copy.png", PNG.length);
  await push(store, two.key, PNG);
  const second = await files.complete(owner, "copy.png", two.key);

  assert.equal(second.id, first.id);
  assert.equal(store.objects.has(two.key), false, "the duplicate upload is cleaned up, not orphaned");
});

test("a hosted deployment with no bucket refuses an upload instead of writing it to a disk that vanishes", async () => {
  const files = await fixture();
  const keys = ["RASPBERRY_S3_ENDPOINT", "AWS_ENDPOINT_URL_S3", "RASPBERRY_S3_BUCKET", "AWS_BUCKET", "RASPBERRY_S3_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID", "RASPBERRY_S3_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"];
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  const savedMode = process.env.RASPBERRY_AUTH_MODE;
  for (const key of keys) delete process.env[key];
  process.env.RASPBERRY_AUTH_MODE = "session";
  try {
    await assert.rejects(
      () => files.store(owner, "photo.png", new Request("http://localhost/api/files?name=photo.png", { method: "POST", body: new Uint8Array(PNG) })),
      (error: AppError) => error.status === 503 && error.code === "storage_not_configured",
    );
  } finally {
    process.env.RASPBERRY_AUTH_MODE = savedMode;
    for (const [key, value] of saved) if (value !== undefined) process.env[key] = value;
  }
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
