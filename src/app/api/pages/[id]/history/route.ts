import { z } from "zod";
import { api, browserActor, pageId } from "@/server/http";
import { getService } from "@/server/runtime";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return api(request, async () => { const service = await getService(), id = pageId((await context.params).id), version = new URL(request.url).searchParams.get("revision"); return version ? { page: await service.revision(browserActor, id, z.coerce.number().int().positive().parse(version)) } : { revisions: await service.history(browserActor, id) }; }); }
