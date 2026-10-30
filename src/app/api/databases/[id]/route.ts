import { api, readBody, pageId } from "@/server/http";
import { getDatabases } from "@/server/runtime";
type Context = { params: Promise<{ id: string }> };
export const runtime = "nodejs";
export async function GET(request: Request, context: Context) { return api(request, async ({ actor }) => ({ database: await (await getDatabases()).get(actor, pageId((await context.params).id)) })); }
export async function PATCH(request: Request, context: Context) { return api(request, async ({ actor }) => ({ database: await (await getDatabases()).patch(actor, pageId((await context.params).id), await readBody(request)) })); }
