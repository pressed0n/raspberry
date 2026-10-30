import { api, pageId, readBody } from "@/server/http";
import { getDatabases } from "@/server/runtime";
type Context = { params: Promise<{ id: string }> };
export const runtime = "nodejs";
/* `+ Add Property` in the table header. The property's own type schema validates its
   config on the way in, so a menu that offers a choice the editor cannot render fails
   here rather than on the next read. */
export async function POST(request: Request, context: Context) {
  return api(request, async ({ actor }) => ({
    database: await (await getDatabases()).addProperty(actor, pageId((await context.params).id), await readBody(request)),
  }));
}
