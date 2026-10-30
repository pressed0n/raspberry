"use client";
/* Raspberry — media uploads (B26)
   ---------------------------------------------------------------------------
   BlockNote asks a single question when a file block gains a file: "here is a
   File, give me a URL." This is that function.

   It posts the raw file as the body rather than multipart, because the server
   streams straight to disk and a multipart parser would only be something else
   to get wrong. The name travels in the query string, where it is metadata and
   cannot be mistaken for a path.

   Errors are surfaced as they arrive: "larger than the 25 MB limit" is a message
   the reader can act on, where a generic failure is not.
*/

export type StoredFile = { id: string; name: string; mime: string; size: number; url: string };

export async function uploadFile(file: File): Promise<StoredFile> {
  const response = await fetch(`/api/files?name=${encodeURIComponent(file.name || "file")}`, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  const text = await response.text();
  type Envelope = { file?: StoredFile; error?: { message?: string } };
  let payload: Envelope | null = null;
  try { payload = text ? (JSON.parse(text) as Envelope) : null; } catch { payload = null; }
  if (!response.ok || !payload?.file) {
    throw new Error(payload?.error?.message ?? "That file could not be uploaded.");
  }
  return payload.file;
}

/** BlockNote's `uploadFile` hook: URL in, nothing else. */
export async function uploadFileUrl(file: File): Promise<string> {
  return (await uploadFile(file)).url;
}
