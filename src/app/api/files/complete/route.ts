import { z } from "zod";
import { api, readBody } from "@/server/http";
import { getFileStore } from "@/server/runtime";

/**
 * POST /api/files/complete  { name, key }  →  { file }
 * ---------------------------------------------------------------------------
 * The second half of a direct upload, and the only place the bytes become a file.
 *
 * The object is read back through the server so the sha256 and the size are the real
 * ones. That is not paranoia for its own sake: a presigned PUT cannot carry a signed
 * payload hash (the endpoint refuses anything but `UNSIGNED-PAYLOAD`), so a client
 * that declared its own hash would be declaring something nobody could contradict.
 * Hashing here means the content address is earned rather than claimed, and the size
 * cap cannot be evaded by lying in `/presign`.
 *
 * `maxDuration` is raised because this route streams the object once. Vercel's Hobby
 * plan caps this at 60s, which is minutes of headroom for the largest file the app
 * allows on a connection between the bucket and the function.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  name: z.string().min(1).max(400),
  key: z.string().min(1).max(400),
});

export async function POST(request: Request) {
  return api(request, async ({ actor }) => {
    const body = Body.parse(await readBody(request));
    return { file: await (await getFileStore()).complete(actor, body.name, body.key) };
  });
}
