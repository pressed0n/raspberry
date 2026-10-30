import { api, pageId, readBody } from "@/server/http";
import { getDatabases } from "@/server/runtime";
type Context = { params: Promise<{ id: string; rowId: string }> };
export const runtime = "nodejs";
export async function PATCH(request: Request, context: Context) {
  return api(request, async ({ actor }) => {
    const { id, rowId } = await context.params;
    return { database: await (await getDatabases()).patchRow(actor, pageId(id), pageId(rowId), await readBody(request)) };
  });
}
/* `Move to trash` on the row's grip menu. A soft delete: the entry keeps its page, its
   body and its cells, and Trash restores it into the same slot. */
export async function DELETE(request: Request, context: Context) {
  return api(request, async ({ actor }) => {
    const { id, rowId } = await context.params;
    return { database: await (await getDatabases()).trashRow(actor, pageId(id), pageId(rowId), await readBody(request)) };
  });
}
