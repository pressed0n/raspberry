import { api } from "@/server/http";
import { getFileStore } from "@/server/runtime";

/**
 * Raspberry — serve a stored file (B26)
 * ---------------------------------------------------------------------------
 * Range requests are honoured so `<video>` can seek without downloading the whole
 * file first. Files are immutable — the id is a uuid over content-addressed bytes —
 * so they are cached for a year, privately, because media belongs to a workspace.
 */
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return api(request, async ({ actor }) => {
    const id = (await context.params).id;
    return (await getFileStore()).serve(actor, id, request.headers.get("range"));
  });
}
