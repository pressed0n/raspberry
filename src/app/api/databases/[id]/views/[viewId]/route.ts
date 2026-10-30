import { api, pageId, readBody } from "@/server/http";
import { getDatabases } from "@/server/runtime";
type Context = { params: Promise<{ id: string; viewId: string }> };
export const runtime = "nodejs";

/* A view is presentation: widths, sorts, filters, grouping. It gets its own route
   rather than riding on `PATCH /api/databases/:id` because that endpoint negotiates
   the schema revision, and widening a column must never do that. */
export async function PATCH(request: Request, context: Context) {
  return api(request, async ({ actor }) => {
    const { id, viewId } = await context.params;
    return { database: await (await getDatabases()).patchView(actor, pageId(id), pageId(viewId), await readBody(request)) };
  });
}
