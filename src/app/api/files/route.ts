import { api } from "@/server/http";
import { getFileStore } from "@/server/runtime";

/**
 * Raspberry — upload endpoint (B26)
 * ---------------------------------------------------------------------------
 * The body is the file itself, with its name in the query string:
 *
 *   POST /api/files?name=holiday.png    body: raw bytes
 *
 * Not multipart, and that is deliberate. Multipart parsing means either a
 * dependency or a hand-rolled parser, and both are a bigger surface than the
 * thing they protect. A raw body streams straight through to disk, so the size
 * cap is enforced while the bytes arrive rather than after they are all in memory.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  return api(request, async ({ actor }) => {
    const name = new URL(request.url).searchParams.get("name") ?? "file";
    return { file: await (await getFileStore()).store(actor, name, request) };
  });
}
