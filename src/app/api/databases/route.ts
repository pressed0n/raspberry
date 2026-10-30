import { api, readBody } from "@/server/http";
import { getDatabases } from "@/server/runtime";
export const runtime = "nodejs";
/* A database is only ever created from `/database` inside a page (owner decision), so
   there is no sidebar "New database" and no list endpoint here — the block holds the
   id, and the page's content is the only index. */
export async function POST(request: Request) { return api(request, async ({ actor }) => ({ database: await (await getDatabases()).create(actor, await readBody(request)) })); }
