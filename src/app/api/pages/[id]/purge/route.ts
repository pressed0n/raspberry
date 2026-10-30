import { api, pageId } from "@/server/http";
import { getService } from "@/server/runtime";
/* Permanent deletion. A sub-path rather than a query flag on DELETE /api/pages/:id
   so the two deletions cannot be confused by a caller that forgets a parameter. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) { return api(request, async ({ actor }) => await (await getService()).purge(actor, pageId((await context.params).id))); }
