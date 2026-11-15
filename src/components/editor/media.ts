"use client";
/* Raspberry — media uploads (B26)
   ---------------------------------------------------------------------------
   BlockNote asks a single question when a file block gains a file: "here is a
   File, give me a URL." This is that function.

   There are two doors, and the file decides which one.

   **Small files** post the raw bytes to `/api/files`. Not multipart, and that is
   deliberate: a multipart parser would be something else to get wrong, and the name
   belongs in the query string where it is metadata rather than a path.

   **Large files** are PUT straight into object storage with a presigned URL, because
   a hosted function refuses a body over 4.5 MB at the platform edge — before any
   handler runs. The bytes then never pass through the app at all; the app is told
   afterwards, hashes what actually arrived and records it. On a local machine the
   server has object storage too when the bucket is configured, and falls back to the
   disk otherwise, so the same two doors work in both places.

   Errors are surfaced as they arrive: "larger than the 25 MB limit" is a message the
   reader can act on, where a generic failure is not.
*/

import { DIRECT_UPLOAD_THRESHOLD } from "@/lib/upload-limits";

export type StoredFile = { id: string; name: string; mime: string; size: number; url: string };

type Envelope = { file?: StoredFile; error?: { message?: string } };

async function read<T>(response: Response, fallback: string): Promise<T> {
  const text = await response.text();
  let payload: (T & Envelope) | null = null;
  try { payload = text ? (JSON.parse(text) as T & Envelope) : null; } catch { payload = null; }
  if (!response.ok) throw new Error(payload?.error?.message ?? fallback);
  return payload as T;
}

async function postJson<T>(path: string, body: unknown, fallback: string): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return read<T>(response, fallback);
}

async function throughServer(file: File): Promise<StoredFile> {
  const response = await fetch(`/api/files?name=${encodeURIComponent(file.name || "file")}`, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  const payload = await read<Envelope>(response, "That file could not be uploaded.");
  if (!payload.file) throw new Error("That file could not be uploaded.");
  return payload.file;
}

/**
 * The direct path: ask for a key, put the bytes at the bucket, tell the app they landed.
 *
 * The `complete` call is what mints the file. Until it returns there is an object in
 * storage that no page references, which is the safe failure direction: an unreferenced
 * object is invisible, whereas a file row without bytes is a broken image.
 */
async function directToStorage(file: File): Promise<StoredFile> {
  const name = file.name || "file";
  const ticket = await postJson<{ url: string; key: string }>(
    "/api/files/presign",
    { name, size: file.size },
    "That file could not be prepared for upload.",
  );

  const sent = await fetch(ticket.url, { method: "PUT", body: file });
  if (!sent.ok) throw new Error("The file could not be sent to storage. Check your connection and try again.");

  const payload = await postJson<Envelope>(
    "/api/files/complete",
    { name, key: ticket.key },
    "The upload finished but could not be recorded. Try again.",
  );
  if (!payload.file) throw new Error("The upload finished but could not be recorded. Try again.");
  return payload.file;
}

export async function uploadFile(file: File): Promise<StoredFile> {
  return file.size > DIRECT_UPLOAD_THRESHOLD ? directToStorage(file) : throughServer(file);
}

/** BlockNote's `uploadFile` hook: URL in, nothing else. */
export async function uploadFileUrl(file: File): Promise<string> {
  return (await uploadFile(file)).url;
}
