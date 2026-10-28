import { api, browserActor, pageId } from "@/server/http";
import { getService } from "@/server/runtime";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return api(request, async () => ({ page: await (await getService()).restore(browserActor, pageId((await context.params).id)) })); }
