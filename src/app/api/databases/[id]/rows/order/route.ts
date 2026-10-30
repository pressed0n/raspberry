import { api, pageId, readBody } from "@/server/http";
import { getDatabases } from "@/server/runtime";

/* Reordering rows (the grip).
   
   A sub-path rather than PATCH on a row, for the reason `pages/:id/move` is one: a
   reorder is not a field write. It renumbers every row it touches in a single
   transaction, and a `position` on its own would describe half of that change.

   `order` is a static segment beside `[rowId]`, which Next resolves first, so a row
   can never be called "order" and shadow this. */
type Context = { params: Promise<{ id: string }> };
export const runtime = "nodejs";
export async function POST(request: Request, context: Context) {
  return api(request, async ({ actor }) => ({
    database: await (await getDatabases()).reorderRows(actor, pageId((await context.params).id), await readBody(request)),
  }));
}
