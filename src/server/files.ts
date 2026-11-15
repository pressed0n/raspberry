import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extname, join, resolve } from "node:path";
import type { Database } from "./database";
import { AppError, type Actor } from "./service";

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

/** Types the browser should display in place rather than download. */
const INLINE = new Set(["image/", "audio/", "video/"]);
/** Types that can execute in a document context, so they are sandboxed when served. */
const SANDBOXED = new Set(["image/svg+xml", "text/plain", "text/markdown", "text/csv"]);

export type StoredFile = { id: string; name: string; mime: string; size: number; url: string };

export function uploadsDir(): string {
  return resolve(process.env.RASPBERRY_UPLOADS_DIR ?? "data/uploads");
}

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
  constructor(private readonly database: Database) {}

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

    const dir = uploadsDir();
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
    const existing = await this.database.transaction(async (sql) =>
      (await sql.query("SELECT id, name, mime, size FROM files WHERE workspace_id=$1 AND sha256=$2", [actor.workspaceId, sha256]))[0],
    );
    if (existing) {
      await rm(temp, { force: true });
      return describe(existing);
    }

    const blob = join(dir, sha256);
    await rename(temp, blob);
    const id = randomUUID();
    try {
      await this.database.transaction(async (sql) => {
        await sql.query(
          "INSERT INTO files(id, workspace_id, sha256, name, mime, size, created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [id, actor.workspaceId, sha256, name, mime, size, new Date().toISOString()],
        );
      });
    } catch (error) {
      // Two uploads of the same bytes can both pass the lookup above; the unique
      // index settles it. The loser is not a failure — it is the same file.
      const duplicate = await this.database.transaction(async (sql) =>
        (await sql.query("SELECT id, name, mime, size FROM files WHERE workspace_id=$1 AND sha256=$2", [actor.workspaceId, sha256]))[0],
      );
      if (!duplicate) throw error;
      return describe(duplicate);
    }
    return { id, name, mime, size, url: `/api/files/${id}` };
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
    const path = join(uploadsDir(), String(row.sha256));
    const info = await stat(path).catch(() => null);
    if (!info) throw new AppError(404, "not_found", "That file is no longer available.");

    const total = info.size;
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
      headers.set("Content-Length", String(total));
      return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, { status: 200, headers });
    }
    headers.set("Content-Length", String(range.end - range.start + 1));
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${total}`);
    return new Response(Readable.toWeb(createReadStream(path, { start: range.start, end: range.end })) as ReadableStream, { status: 206, headers });
  }
}
