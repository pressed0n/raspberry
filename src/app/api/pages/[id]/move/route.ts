import { api, readBody, pageId } from "@/server/http";
import { getService } from "@/server/runtime";

/* Drag reordering (B28).

   A sub-path rather than PATCH on the page, for the same reason purge is one: a move is
   not a field write. It renumbers every sibling of the destination inside a single
   transaction, and `index` only means anything relative to the list it lands in — so a
   caller that sent it through PATCH would be describing half a change.

   The body is parsed by the service (`movePageSchema`), which is where `expectedRevision`
   and the cycle guard live; validating twice here would mean two definitions of what a
   legal move is. */
type Context = { params: Promise<{ id: string }> };
export const runtime = "nodejs";
export async function POST(request: Request, context: Context) { return api(request, async ({ actor }) => ({ page: await (await getService()).move(actor, pageId((await context.params).id), await readBody(request)) })); }
