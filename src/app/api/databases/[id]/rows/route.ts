import { api, pageId, readBody } from "@/server/http";
import { getDatabases } from "@/server/runtime";
type Context = { params: Promise<{ id: string }> };
export const runtime = "nodejs";
/* `New page` — the wishlist asks for it in the table's second row, and the row is a
   real page, so this returns the whole database payload: the new row, in place. */
export async function POST(request: Request, context: Context) {
  return api(request, async ({ actor }) => ({
    database: await (await getDatabases()).addRow(actor, pageId((await context.params).id), await readBody(request)),
  }));
}
