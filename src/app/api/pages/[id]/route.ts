import { z } from "zod";
import { api, readBody, pageId } from "@/server/http";
import { getService } from "@/server/runtime";
type Context = { params: Promise<{ id: string }> };
export const runtime = "nodejs";
export async function GET(request: Request, context: Context) { return api(request, async ({ actor }) => ({ page: await (await getService()).get(actor, pageId((await context.params).id)) })); }
export async function PATCH(request: Request, context: Context) { return api(request, async ({ actor }) => ({ page: await (await getService()).patch(actor, pageId((await context.params).id), await readBody(request)) })); }
export async function DELETE(request: Request, context: Context) { return api(request, async ({ actor }) => { const body = z.object({ expectedRevision: z.number().int().positive() }).strict().parse(await readBody(request)); return (await getService()).trash(actor, pageId((await context.params).id), body.expectedRevision); }); }
