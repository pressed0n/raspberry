import { z } from "zod";
import { api, readBody } from "@/server/http";
import { getFileStore } from "@/server/runtime";

/**
 * POST /api/files/presign  { name, size }  →  { url, key, name }
 * ---------------------------------------------------------------------------
 * The first half of an upload that does not travel through the app.
 *
 * A hosted function refuses a request body over 4.5 MB at the platform edge — the
 * request never reaches a handler, so no limit the app can set rescues a 20 MB photo
 * sent to `POST /api/files`. Above `DIRECT_UPLOAD_THRESHOLD` the browser therefore puts
 * the bytes straight into object storage with the URL this returns, then reports back
 * to `/api/files/complete`.
 *
 * `size` is a claim, and it is only used to answer early: the real cap is enforced
 * against the real byte count in `complete`. What this route actually decides is the
 * extension (which fixes the type and the cap) and the key, which is random and inside
 * the caller's own workspace.
 */
export const runtime = "nodejs";

const Body = z.object({
  name: z.string().min(1).max(400),
  size: z.number().int().positive(),
});

export async function POST(request: Request) {
  return api(request, async ({ actor }) => {
    const body = Body.parse(await readBody(request));
    return (await getFileStore()).presign(actor, body.name, body.size);
  });
}
