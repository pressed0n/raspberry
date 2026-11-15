import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extname, join } from "node:path";
import { accessMode } from "./access";
import type { Database } from "./database";
import { AppError, type Actor } from "./service";
import { blobKey, blobs, incomingKey, isIncomingKey, storageConfigured, uploadsDir, type BlobStore } from "./storage";
import { DIRECT_UPLOAD_THRESHOLD } from "../lib/upload-limits";

export { uploadsDir };

/**
 * Raspberry — uploaded files (B26)
 * ---------------------------------------------------------------------------
 * Media blocks store a URL, not bytes. This module owns the bytes.
 *
 * Three decisions worth knowing before reading the code:
 *
 * 1. **Content-addressed on disk.** The blob's filename is its sha256, so the same
 *    image pasted into five pages is stored once. The public URL carries a uuid
 *    instead, which means the id is stable and guessable-by-nobody while the
 *    storage layer stays free to dedupe.
 *
 * 2. **The bytes are streamed, never buffered.** A 300 MB video read into memory
 *    would be a memory bug on a machine that is also running the editor. The body
 *    is piped through a meter that hashes and enforces the size cap as it goes, so
 *    an oversized upload is rejected at the point it crosses the limit rather than
 *    after it has all arrived.
 *
 * 3. **The server decides the content type.** The client's header is ignored and
 *    the type is derived from the extension allowlist below. An upload named
 *    `.html` is served as `application/octet-stream` with `Content-Disposition:
 *    attachment`, so it becomes a download rather than a page on our origin.
 */

const TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", svg: "image/svg+xml", bmp: "image/bmp",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac",
  flac: "audio/flac", oga: "audio/ogg", opus: "audio/opus",
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", ogv: "video/ogg", mov: "video/quicktime",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv",
  json: "application/json", zip: "application/zip", gz: "application/gzip",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  epub: "application/epub+zip", rtf: "application/rtf", ics: "text/calendar",
};

const MB = 1024 * 1024;
const LIMITS: Record<string, number> = { image: 25 * MB, audio: 100 * MB, video: 512 * MB, other: 100 * MB };

/* How long a browser's direct-upload URL stays usable. Fifteen minutes is long enough
   for a slow line to push a 40 MB photo and short enough that a leaked URL is not a
   standing invitation. The key is random and workspace-scoped, so the worst case is a
   stray object nobody references. */
const DIRECT_UPLOAD_TTL_SECONDS = 900;

/* Above this size an upload is sent straight to the bucket, because a hosted function
   refuses a request body over 4.5 MB before the handler is reached. The threshold is
   shared with the browser so the two halves cannot drift: see `src/lib/upload-limits.ts`. */
export { DIRECT_UPLOAD_THRESHOLD };

/** Types the browser should display in place rather than download. */
const INLINE = new Set(["image/", "audio/", "video/"]);
/** Types that can execute in a document context, so they are sandboxed when served. */
const SANDBOXED = new Set(["image/svg+xml", "text/plain", "text/markdown", "text/csv"]);

export type StoredFile = { id: string; name: string; mime: string; size: number; url: string };

function kindOf(mime: string): string {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "other";
}

/**
 * A name is metadata, never a path. Everything before the last separator is
 * discarded so `../../etc/passwd` cannot become a filename, and control
 * characters are dropped because they end up in a `Content-Disposition` header.
 */
function cleanName(raw: string): { name: string; ext: string } {
  const base = (raw.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f"]/g, "").trim();
  const name = base.slice(0, 180) || "file";
  return { name, ext: extname(name).slice(1).toLowerCase() };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function describe(row: Record<string, unknown>): StoredFile {
  const id = String(row.id);
  return { id, name: String(row.name), mime: String(row.mime), size: Number(row.size), url: `/api/files/${id}` };
}

/** `bytes=…` is the only form browsers send; anything else is served in full. */
function parseRange(header: string | null, total: number): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;
  let start: number;
  let end: number;
  if (!rawStart) {
    const length = Number(rawEnd);
    if (!Number.isFinite(length) || length <= 0) return null;
    start = Math.max(0, total - length);
    end = total - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : total - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start >= total || start > end) return { start: total - 1, end: total - 1 };
  return { start, end: Math.min(end, total - 1) };
}

export class FileStore {
  constructor(
    private readonly database: Database,
    /* An explicit byte store, used by the tests to hold the direct-upload path to its
       promises without a bucket. Production never passes one: the backend is decided by
       configuration, so the same code runs against the disk and against object storage. */
    private readonly override?: BlobStore,
  ) {}

  /**
   * The byte store, with the hosted-mode gate in front of it.
   *
   * A hosted deployment with no object storage configured has nowhere durable to put
   * an upload: `/tmp` is per-instance and wiped on cold start, so the write would
   * succeed and the file would be a broken image by the next request. Refusing is the
   * only honest answer — the deployment already refuses to serve data when sign-in is
   * unconfigured, and this is the same rule applied to bytes.
   */
  private storage(): BlobStore {
    if (this.override) return this.override;
    if (accessMode() === "session" && !storageConfigured()) {
      throw new AppError(
        503,
        "storage_not_configured",
        "File storage is not configured on this server. Set RASPBERRY_S3_BUCKET, RASPBERRY_S3_ENDPOINT, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.",
      );
    }
    return blobs();
  }

  /**
   * Store a request body. The size cap is checked as bytes arrive, so a hostile
   * or accidental 5 GB upload stops at the limit instead of filling the disk.
   */
  async store(actor: Actor, rawName: string, request: Request): Promise<StoredFile> {
    const { name, ext } = cleanName(rawName);
    const mime = TYPES[ext] ?? "application/octet-stream";
    const kind = kindOf(mime);
    const cap = LIMITS[kind];
    const body = request.body;
    if (!body) throw new AppError(400, "empty_upload", "No file was sent.");

    const store = this.storage();
    const dir = store.stagingDir();
    await mkdir(dir, { recursive: true });
    const temp = join(dir, `.incoming-${randomUUID()}`);
    const hash = createHash("sha256");
    let size = 0;

    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        size += chunk.length;
        if (size > cap) {
          done(new AppError(413, "file_too_large", `${name} is larger than the ${Math.round(cap / MB)} MB limit for ${kind} files.`));
          return;
        }
        hash.update(chunk);
        done(null, chunk);
      },
    });

    try {
      await pipeline(Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]), meter, createWriteStream(temp));
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
    if (size === 0) {
      await rm(temp, { force: true });
      throw new AppError(400, "empty_upload", `${name} is empty.`);
    }

    const sha256 = hash.digest("hex");
    const existing = await this.existing(actor, sha256);
    if (existing) {
      await rm(temp, { force: true });
      return describe(existing);
    }

    const key = blobKey(actor.workspaceId, sha256);
    try {
      await store.put(key, temp, sha256);
    } finally {
      await rm(temp, { force: true });
    }
    return this.remember(actor, { id: randomUUID(), sha256, name, mime, size });
  }

  /** The row for these exact bytes in this workspace, if they are already stored. */
  private async existing(actor: Actor, sha256: string): Promise<Record<string, unknown> | undefined> {
    return this.database.transaction(async (sql) =>
      (await sql.query("SELECT id, name, mime, size FROM files WHERE workspace_id=$1 AND sha256=$2", [actor.workspaceId, sha256]))[0],
    );
  }

  /** Record the bytes, settling a race with the unique index rather than failing it. */
  private async remember(
    actor: Actor,
    file: { id: string; sha256: string; name: string; mime: string; size: number },
  ): Promise<StoredFile> {
    try {
      await this.database.transaction(async (sql) => {
        await sql.query(
          "INSERT INTO files(id, workspace_id, sha256, name, mime, size, created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [file.id, actor.workspaceId, file.sha256, file.name, file.mime, file.size, new Date().toISOString()],
        );
      });
    } catch (error) {
      // Two uploads of the same bytes can both pass the lookup above; the unique
      // index settles it. The loser is not a failure — it is the same file.
      const duplicate = await this.existing(actor, file.sha256);
      if (!duplicate) throw error;
      return describe(duplicate);
    }
    return { id: file.id, name: file.name, mime: file.mime, size: file.size, url: `/api/files/${file.id}` };
  }

  /**
   * Begin an upload the browser sends straight to the bucket.
   *
   * A hosted function refuses a request body over 4.5 MB at the platform edge, before
   * any handler runs, so a 20 MB photo cannot arrive through `store()` however large
   * the app's own limit is. The name, the extension and the size are decided here —
   * the same allowlist and the same caps — and the browser is handed one URL for one
   * randomly named key inside its own workspace. Nothing about the bytes is trusted:
   * `complete` hashes them itself.
   */
  async presign(actor: Actor, rawName: string, size: number): Promise<{ url: string; key: string; name: string }> {
    const { name, ext } = cleanName(rawName);
    const mime = TYPES[ext] ?? "application/octet-stream";
    const kind = kindOf(mime);
    const cap = LIMITS[kind];
    if (!Number.isFinite(size) || size <= 0) throw new AppError(400, "empty_upload", `${name} is empty.`);
    if (size > cap) throw new AppError(413, "file_too_large", `${name} is larger than the ${Math.round(cap / MB)} MB limit for ${kind} files.`);

    const store = this.storage();
    const key = incomingKey(actor.workspaceId, randomUUID());
    const url = store.presignPut(key, DIRECT_UPLOAD_TTL_SECONDS);
    if (!url) throw new AppError(503, "direct_upload_unavailable", "This server cannot accept a direct upload.");
    return { url, key, name };
  }

  /**
   * Finish a direct upload.
   *
   * The object is read back and hashed, because a presigned PUT cannot be bound to a
   * hash the client declares (the endpoint refuses any payload hash but
   * `UNSIGNED-PAYLOAD`). So the client's claim is worth nothing here and is never
   * used: the size cap is enforced against the real byte count, the sha256 is
   * computed from the real bytes, and only then is the object moved to its
   * content-addressed key. A duplicate is deleted and the existing row returned —
   * deduplication by content holds across both upload paths.
   */
  async complete(actor: Actor, rawName: string, key: string): Promise<StoredFile> {
    const { name, ext } = cleanName(rawName);
    const mime = TYPES[ext] ?? "application/octet-stream";
    const kind = kindOf(mime);
    const cap = LIMITS[kind];
    if (!isIncomingKey(key, actor.workspaceId)) throw new AppError(400, "invalid_upload", "That upload reference is not yours.");

    const store = this.storage();
    const stream = await store.read(key);
    if (!stream) throw new AppError(400, "missing_upload", `The upload of ${name} did not arrive. Try again.`);

    const hash = createHash("sha256");
    let size = 0;
    for await (const chunk of Readable.fromWeb(stream as Parameters<typeof Readable.fromWeb>[0])) {
      const bytes = chunk as Buffer;
      size += bytes.length;
      if (size > cap) {
        await store.remove(key);
        throw new AppError(413, "file_too_large", `${name} is larger than the ${Math.round(cap / MB)} MB limit for ${kind} files.`);
      }
      hash.update(bytes);
    }
    if (size === 0) {
      await store.remove(key);
      throw new AppError(400, "empty_upload", `${name} is empty.`);
    }

    const sha256 = hash.digest("hex");
    const known = await this.existing(actor, sha256);
    if (known) {
      await store.remove(key);
      return describe(known);
    }

    try {
      await store.copy(key, blobKey(actor.workspaceId, sha256), sha256);
    } catch (error) {
      /* The bytes stay at their incoming key rather than being deleted on failure: the
         upload already happened, and a failed copy is a transient storage problem, not
         a reason to make the person send a 40 MB file again. */
      throw error;
    }
    await store.remove(key);
    return this.remember(actor, { id: randomUUID(), sha256, name, mime, size });
  }

  async find(actor: Actor, id: string): Promise<Record<string, unknown> | undefined> {
    if (!UUID.test(id)) return undefined;
    return this.database.transaction(async (sql) =>
      (await sql.query("SELECT id, sha256, name, mime, size FROM files WHERE id=$1 AND workspace_id=$2", [id, actor.workspaceId]))[0],
    );
  }

  /** Serve the bytes, honouring a single range so video and audio can seek. */
  async serve(actor: Actor, id: string, rangeHeader: string | null, download = false): Promise<Response> {
    const row = await this.find(actor, id);
    if (!row) throw new AppError(404, "not_found", "That file is no longer available.");
    const store = this.storage();
    const key = blobKey(actor.workspaceId, String(row.sha256));
    if (!(await store.head(key))) throw new AppError(404, "not_found", "That file is no longer available.");

    const total = Number(row.size);
    const mime = String(row.mime);
    const name = String(row.name);
    const range = parseRange(rangeHeader, total);
    const headers = new Headers({
      "Content-Type": mime,
      "Accept-Ranges": "bytes",
      // The proxy sets `no-store` on every response it sees, so this is a hint for
      // direct handler use and tests rather than the value a browser receives.
      // Range support is what keeps video usable under that policy: seeking does
      // not need a second download, only the bytes ahead of the playhead.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      ETag: `"${String(row.sha256)}"`,
    });
    const inline = [...INLINE].some((prefix) => mime.startsWith(prefix)) || mime === "application/pdf";
    /* `download` is the cell's save button asking for the same rule the non-inline types get:
       a picture opened to look at, the same picture saved when that is what was asked. It can
       only make a response *more* restricted — a `.html` upload is an attachment either way. */
    headers.set("Content-Disposition", `${inline && !download ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`);
    // A sandboxed document cannot run script, so an uploaded SVG or .txt cannot
    // reach the API with the reader's cookies even when opened directly.
    if (SANDBOXED.has(mime)) headers.set("Content-Security-Policy", "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'");

    if (!range) {
      const bytes = await store.read(key);
      if (!bytes) throw new AppError(404, "not_found", "That file is no longer available.");
      headers.set("Content-Length", String(total));
      return new Response(bytes, { status: 200, headers });
    }
    const bytes = await store.read(key, { start: range.start, end: range.end });
    if (!bytes) throw new AppError(404, "not_found", "That file is no longer available.");
    headers.set("Content-Length", String(range.end - range.start + 1));
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${total}`);
    return new Response(bytes, { status: 206, headers });
  }
}
