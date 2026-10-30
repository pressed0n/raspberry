import { api, pageId, readBody } from "@/server/http";
import { getDatabases } from "@/server/runtime";
type Context = { params: Promise<{ id: string; rowId: string }> };
export const runtime = "nodejs";
/* `Duplicate` on the row's grip menu: the entry below itself, with its cells copied. */
export async function POST(request: Request, context: Context) {
  return api(request, async ({ actor }) => {
    const { id, rowId } = await context.params;
    return { database: await (await getDatabases()).duplicateRow(actor, pageId(id), pageId(rowId), await readBody(request)) };
  });
}
