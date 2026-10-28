import { api, pageId } from "@/server/http";
import { getService } from "@/server/runtime";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return api(request, async ({ actor }) => ({ page: await (await getService()).restore(actor, pageId((await context.params).id)) })); }
