import { api, readBody } from "@/server/http";
import { getService } from "@/server/runtime";
export const runtime = "nodejs";
export async function GET(request: Request) { return api(request, async ({ actor }) => { const url = new URL(request.url); return { pages: await (await getService()).list(actor, { trash: url.searchParams.get("trash") === "1", query: url.searchParams.get("q") ?? "" }) }; }); }
export async function POST(request: Request) { return api(request, async ({ actor }) => ({ page: await (await getService()).create(actor, await readBody(request)) })); }
