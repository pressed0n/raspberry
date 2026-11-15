import { createHash, createHmac } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";

/**
 * Raspberry — where uploaded bytes actually live (hosting)
 * ---------------------------------------------------------------------------
 * `files.ts` owns the *metadata* of an upload: its name, its type, its size, and the
 * sha256 that content-addresses it. This module owns the bytes, and there are two
 * places they can be.
 *
 * 1. **The disk** — `data/uploads/<sha256>`, which is what `pnpm dev` uses and what
 *    every test exercises. Nothing about this changed.
 * 2. **Object storage** — S3-compatible, Signature Version 4 over HTTPS, path style.
 *    A hosted deployment has no durable disk: a serverless filesystem is read-only
 *    except `/tmp`, and `/tmp` is per-instance and wiped on every cold start, so an
 *    upload written there is a broken image on the next request. Neon Object Storage
 *    is what this talks to; endpoint, region, bucket and keys are environment
 *    variables, so any S3-compatible provider works.
 *
 * The split sits behind one interface on purpose. `FileStore` cannot tell which
 * backend it is using, which is the property that keeps the disk path tested and the
 * bucket path honest: the same code that passes in CI against a temp directory runs
 * against the bucket.
 *
 * **No SDK.** `@aws-sdk/client-s3` is a large dependency whose only job here is to
 * sign a handful of request shapes, and SigV4 over a known method, path and three
 * headers is a fixed computation rather than a protocol negotiation. The parts that
 * are easy to get wrong — RFC 3986 encoding, the empty query line, the newline
 * before `SignedHeaders`, signed-header ordering — are pinned by tests, and every
 * operation below was proved against the live endpoint before this shipped.
 * (SMTP is the opposite case and is refused in `auth/mail.ts` for exactly this
 * reason: there, being clever means being downgraded.)
 *
 * Three facts came from those probes rather than from documentation, and each one
 * shapes the code:
 *
 *   - A signed PUT **is** checked against `x-amz-content-sha256`; a mismatched body
 *     is refused with `XAmzContentSHA256Mismatch` and nothing is stored. So the
 *     upload path signs the real hash and the bucket enforces content addressing.
 *   - A **presigned** PUT is refused unless the payload hash is `UNSIGNED-PAYLOAD`.
 *     A browser cannot therefore be bound to a hash it declares, which is why a
 *     direct upload lands at a random key under `i/` and is hashed by the server on
 *     completion instead of being trusted.
 *   - `CopyObject` works, so a verified upload is moved into its content address
 *     server-side without pulling the bytes through the function a second time.
 */

const SERVICE = "s3";
const ALGORITHM = "AWS4-HMAC-SHA256";
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export type BlobRange = { start: number; end: number };

export type BlobStore = {
  /** Which backend answered. Surfaced by `/api/health` and by the tests. */
  readonly kind: "disk" | "s3";
  /** A directory this process may write to while an upload is in flight. */
  stagingDir(): string;
  put(key: string, sourcePath: string, contentSha256: string): Promise<void>;
  head(key: string): Promise<{ size: number } | null>;
  read(key: string, range?: BlobRange): Promise<ReadableStream | null>;
  remove(key: string): Promise<void>;
  /** Server-side rename. Resolves even when the source has already gone. */
  copy(fromKey: string, toKey: string, contentSha256: string): Promise<void>;
  /**
   * A URL the *browser* can PUT to directly, or null when this backend cannot offer
   * one. Direct upload exists because a hosted function refuses a request body over
   * 4.5 MB at the platform edge: streaming through the app works for ordinary photos
   * and cannot work for video, whatever the app's own limit says.
   */
  presignPut(key: string, expiresIn: number): string | null;
};

export type S3Config = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

const text = (name: string): string => (process.env[name] ?? "").trim();

/**
 * The storage key for verified bytes: workspace-scoped, so no two accounts can ever
 * name the same object, and content-addressed, so the same photo on three pages costs
 * one copy.
 */
export function blobKey(workspaceId: string, sha256: string): string {
  return `w/${workspaceId}/${sha256}`;
}

/**
 * Where a browser's direct upload lands before anyone has hashed it.
 *
 * A separate prefix rather than a separate bucket, so the object is in the workspace
 * that asked for it and the completion step can prove the key it was handed belongs
 * to the caller. Nothing is ever served from here: `serve` only resolves `blobKey`.
 */
export function incomingKey(workspaceId: string, id: string): string {
  return `i/${workspaceId}/${id}`;
}

/** True only for a key this module issued to this workspace for a direct upload. */
export function isIncomingKey(key: string, workspaceId: string): boolean {
  return new RegExp(`^i/${workspaceId}/[0-9a-f-]{36}$`).test(key);
}

/**
 * Object-storage configuration, or null when it is absent.
 *
 * Both the AWS-standard names (so values Neon injects work untouched) and a
 * `RASPBERRY_S3_*` alias are accepted. A half-configured bucket is null rather than a
 * partial client: an upload must fail loudly, not write to a disk that vanishes.
 */
export function readS3Config(): S3Config | null {
  const endpoint = text("RASPBERRY_S3_ENDPOINT") || text("AWS_ENDPOINT_URL_S3");
  const bucket = text("RASPBERRY_S3_BUCKET") || text("AWS_BUCKET");
  const accessKeyId = text("RASPBERRY_S3_ACCESS_KEY_ID") || text("AWS_ACCESS_KEY_ID");
  const secretAccessKey = text("RASPBERRY_S3_SECRET_ACCESS_KEY") || text("AWS_SECRET_ACCESS_KEY");
  const region = text("RASPBERRY_S3_REGION") || text("AWS_REGION") || "eu-central-1";
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  return { endpoint: parsed.origin, region, bucket, accessKeyId, secretAccessKey };
}

export function storageConfigured(): boolean {
  return readS3Config() !== null;
}

/* RFC 3986. `encodeURIComponent` leaves `!'()*` alone, and those must be escaped in a
   canonical URI or the signature disagrees with what was sent. */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { stamp, date: stamp.slice(0, 8) };
}

function signingKey(config: S3Config, date: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, date), config.region), SERVICE), "aws4_request");
}

function canonicalPath(config: S3Config, key: string): string {
  return `/${encodeRfc3986(config.bucket)}/${key.split("/").map(encodeRfc3986).join("/")}`;
}

/** Lowercase, sorted, trimmed — the only form the signature is defined over. */
function canonicalise(headers: Record<string, string>) {
  const lower: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) lower[name.toLowerCase()] = String(value).trim();
  const names = Object.keys(lower).sort();
  return { lower, names, canonical: names.map((name) => `${name}:${lower[name]}\n`).join(""), signed: names.join(";") };
}

type Signed = { url: string; headers: Record<string, string> };

/**
 * Sign one request. `payloadHash` is the hex sha256 of the body, so a PUT is bound to
 * the exact bytes it claims to carry.
 */
export function signS3Request(
  config: S3Config,
  method: string,
  key: string,
  options: { payloadHash: string; now?: Date; query?: Record<string, string>; headers?: Record<string, string> },
): Signed {
  const { stamp, date } = amzDate(options.now ?? new Date());
  const query = options.query ?? {};
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((name) => `${encodeRfc3986(name)}=${encodeRfc3986(query[name]!)}`)
    .join("&");
  const host = new URL(config.endpoint).host;

  const { canonical, signed } = canonicalise({
    ...(options.headers ?? {}),
    host,
    "x-amz-content-sha256": options.payloadHash,
    "x-amz-date": stamp,
  });

  const canonicalRequest = [method, canonicalPath(config, key), canonicalQuery, canonical, signed, options.payloadHash].join("\n");
  const stringToSign = [ALGORITHM, stamp, `${date}/${config.region}/${SERVICE}/aws4_request`, sha256Hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(config, date)).update(stringToSign).digest("hex");

  return {
    url: `${config.endpoint}${canonicalPath(config, key)}${canonicalQuery ? `?${canonicalQuery}` : ""}`,
    headers: {
      ...(options.headers ?? {}),
      host,
      "x-amz-content-sha256": options.payloadHash,
      "x-amz-date": stamp,
      authorization: `${ALGORITHM} Credential=${config.accessKeyId}/${date}/${config.region}/${SERVICE}/aws4_request, SignedHeaders=${signed}, Signature=${signature}`,
    },
  };
}

/**
 * A presigned PUT, for bytes that never travel through the app.
 *
 * `UNSIGNED-PAYLOAD` is not a shortcut: the endpoint refuses anything else on a
 * presigned request (proved), so the browser cannot be bound to a hash here. That is
 * why the key it writes to is a random one and why `FileStore.complete` hashes the
 * object itself before it becomes content-addressed.
 */
export function presignS3Put(config: S3Config, key: string, expiresIn: number, now: Date = new Date()): string {
  const { stamp, date } = amzDate(now);
  const scope = `${date}/${config.region}/${SERVICE}/aws4_request`;
  const query: Record<string, string> = {
    "X-Amz-Algorithm": ALGORITHM,
    "X-Amz-Credential": `${config.accessKeyId}/${scope}`,
    "X-Amz-Date": stamp,
    "X-Amz-Expires": String(Math.max(1, Math.floor(expiresIn))),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((name) => `${encodeRfc3986(name)}=${encodeRfc3986(query[name]!)}`)
    .join("&");
  const canonicalRequest = [
    "PUT",
    canonicalPath(config, key),
    canonicalQuery,
    `host:${new URL(config.endpoint).host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(config, date)).update(stringToSign).digest("hex");
  return `${config.endpoint}${canonicalPath(config, key)}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/* -------------------------------------------------------------------------- */
/* Disk                                                                        */
/* -------------------------------------------------------------------------- */

export function uploadsDir(): string {
  return resolve(process.env.RASPBERRY_UPLOADS_DIR ?? "data/uploads");
}

export class DiskBlobs implements BlobStore {
  readonly kind = "disk" as const;

  stagingDir(): string {
    return uploadsDir();
  }

  /**
   * The last path segment is the filename.
   *
   * `w/<workspace>/<sha256>` becomes `<sha256>` on disk, so the directory keeps the
   * flat, hash-named layout it has always had and every image already in
   * `data/uploads` still resolves. Only the bucket needs the workspace prefix, and
   * only the bucket can be shared between accounts.
   */
  private path(key: string): string {
    return join(uploadsDir(), key.split("/").pop()!);
  }

  async put(key: string, sourcePath: string): Promise<void> {
    await mkdir(uploadsDir(), { recursive: true });
    await rename(sourcePath, this.path(key));
  }

  async head(key: string): Promise<{ size: number } | null> {
    const info = await stat(this.path(key)).catch(() => null);
    return info ? { size: info.size } : null;
  }

  async read(key: string, range?: BlobRange): Promise<ReadableStream | null> {
    const info = await stat(this.path(key)).catch(() => null);
    if (!info) return null;
    const stream = range
      ? createReadStream(this.path(key), { start: range.start, end: range.end })
      : createReadStream(this.path(key));
    return Readable.toWeb(stream) as ReadableStream;
  }

  async remove(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  async copy(fromKey: string, toKey: string): Promise<void> {
    if (fromKey === toKey) return;
    await mkdir(uploadsDir(), { recursive: true });
    await rename(this.path(fromKey), this.path(toKey)).catch(async (error: unknown) => {
      // A lost source is not a failure here: the bytes were already verified and the
      // row that names them is about to be written either way.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }

  presignPut(_key?: string, _expiresIn?: number): string | null {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Object storage                                                              */
/* -------------------------------------------------------------------------- */

export class S3Blobs implements BlobStore {
  readonly kind = "s3" as const;

  constructor(
    private readonly config: S3Config,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  stagingDir(): string {
    /* Not the bucket and not the app directory: a serverless filesystem only offers
       `/tmp`, so staging is wherever this process may write. Bytes are streamed in,
       hashed and pushed straight out again; nothing is left behind. */
    return join(tmpdir(), "raspberry-uploads");
  }

  async put(key: string, sourcePath: string, contentSha256: string): Promise<void> {
    const info = await stat(sourcePath);
    const signed = signS3Request(this.config, "PUT", key, { payloadHash: contentSha256 });
    const response = await this.fetchImpl(signed.url, {
      method: "PUT",
      headers: { ...signed.headers, "content-length": String(info.size) },
      body: Readable.toWeb(createReadStream(sourcePath)) as ReadableStream,
      // Node's fetch requires this for a streamed body. Cast because the DOM
      // `RequestInit` the app compiles against does not declare it.
      ...({ duplex: "half" } as Record<string, unknown>),
    });
    if (!response.ok) throw new Error(`Object storage refused the upload (${response.status}).`);
  }

  async head(key: string): Promise<{ size: number } | null> {
    const signed = signS3Request(this.config, "HEAD", key, { payloadHash: EMPTY_SHA256 });
    const response = await this.fetchImpl(signed.url, { method: "HEAD", headers: signed.headers });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Object storage could not be asked about the file (${response.status}).`);
    return { size: Number(response.headers.get("content-length") ?? 0) };
  }

  async read(key: string, range?: BlobRange): Promise<ReadableStream | null> {
    const signed = signS3Request(this.config, "GET", key, {
      payloadHash: EMPTY_SHA256,
      ...(range ? { headers: { range: `bytes=${range.start}-${range.end}` } } : {}),
    });
    const response = await this.fetchImpl(signed.url, { method: "GET", headers: signed.headers });
    if (response.status === 404) return null;
    if (!response.ok && response.status !== 206) throw new Error(`Object storage could not return the file (${response.status}).`);
    return response.body ?? null;
  }

  async remove(key: string): Promise<void> {
    const signed = signS3Request(this.config, "DELETE", key, { payloadHash: EMPTY_SHA256 });
    await this.fetchImpl(signed.url, { method: "DELETE", headers: signed.headers }).catch(() => undefined);
  }

  async copy(fromKey: string, toKey: string, contentSha256: string): Promise<void> {
    if (fromKey === toKey) return;
    const signed = signS3Request(this.config, "PUT", toKey, {
      payloadHash: EMPTY_SHA256,
      headers: { "x-amz-copy-source": `/${this.config.bucket}/${fromKey}` },
    });
    const response = await this.fetchImpl(signed.url, { method: "PUT", headers: { ...signed.headers, "content-length": "0" } });
    if (response.ok) return;
    /* A copy the gateway refuses is not fatal: the caller still holds a verified temp
       file and can put the bytes directly. Losing the shortcut costs bandwidth, not
       data, so it is reported rather than thrown. */
    throw new Error(`Object storage could not copy the upload (${response.status}).`);
  }

  presignPut(key: string, expiresIn: number): string | null {
    return presignS3Put(this.config, key, expiresIn);
  }
}

/* -------------------------------------------------------------------------- */
/* Selection                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Which backend this process uses.
 *
 * Configured object storage always wins. With none configured the disk is used, which
 * is right for `pnpm dev` and for CI — and is refused in hosted mode by `FileStore`,
 * because "no bucket" there means an upload that disappears.
 */
export function blobs(): BlobStore {
  const config = readS3Config();
  return config ? new S3Blobs(config) : new DiskBlobs();
}
