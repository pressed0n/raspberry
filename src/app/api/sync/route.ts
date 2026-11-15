import { api } from "@/server/http";
import { getService } from "@/server/runtime";

export const runtime = "nodejs";

/* The most tabs one browser can hold. A request may name the pages it is looking
   at so the answer carries their current revision; beyond this the list itself is
   the cheaper question, and an unbounded `watch` is an unbounded SQL `IN`. */
const MAX_WATCHED = 32;

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The live-sync digest (B56).
 *
 * Not in `PUBLIC_APIS`: this reads a workspace, so it is signed-in only, and the
 * proxy refuses it before the handler runs without a session cookie.
 *
 * Malformed ids are dropped rather than refused — a stale tab naming a page that
 * was purged is normal, and answering 400 for it would stop the poller instead of
 * telling it the page is gone.
 */
export async function GET(request: Request) {
  return api(request, async ({ actor }) => {
    const raw = new URL(request.url).searchParams.get("watch") ?? "";
    const ids = [...new Set(raw.split(",").map((value) => value.trim()).filter((value) => idPattern.test(value)))].slice(0, MAX_WATCHED);
    return (await getService()).sync(actor, ids);
  });
}
