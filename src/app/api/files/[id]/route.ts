import { api } from "@/server/http";
import { getFileStore } from "@/server/runtime";

/**
 * Raspberry — serve a stored file (B26)
 * ---------------------------------------------------------------------------
 * Range requests are honoured so `<video>` can seek without downloading the whole
 * file first. Files are immutable — the id is a uuid over content-addressed bytes —
 * so they are cached for a year, privately, because media belongs to a workspace.
 *
 * `?download=1` (B54) asks for the same bytes as a save rather than a view: every
 * type the store would display inline — images, audio, video, PDF — becomes an
 * attachment carrying its stored name. The cell's save button is the caller; the
 * rule lives in the store, so the query cannot be the only thing deciding.
 */
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return api(request, async ({ actor }) => {
    const id = (await context.params).id;
    const download = new URL(request.url).searchParams.has("download");
    return (await getFileStore()).serve(actor, id, request.headers.get("range"), download);
  });
}
