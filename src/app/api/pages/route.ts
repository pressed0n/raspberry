import { api, browserActor, readBody } from "@/server/http";
import { getService } from "@/server/runtime";
export const runtime = "nodejs";
export async function GET(request: Request) { return api(request, async () => { const url = new URL(request.url); return { pages: await (await getService()).list(browserActor, { trash: url.searchParams.get("trash") === "1", query: url.searchParams.get("q") ?? "" }) }; }); }
export async function POST(request: Request) { return api(request, async () => ({ page: await (await getService()).create(browserActor, await readBody(request)) })); }
