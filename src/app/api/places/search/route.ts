import { api } from "@/server/http";
import { AppError } from "@/server/service";
import { PlaceServiceBusy, PlaceServiceError, placesEndpoint, searchPlaces } from "@/server/places";

/**
 * GET /api/places/search?q=<address>
 * ---------------------------------------------------------------------------
 * The place cell's search, and the only route in the app whose call rate is set by a
 * person's typing. Its answers:
 *
 *   { results: PlaceHit[], matchedNumber }   found some, or found none (an empty list is an answer)
 *   { results: [], disabled: true }          search is switched off — `RASPBERRY_PLACES_URL=off`
 *   400 invalid_input                        the query was empty or absurdly long
 *   502 places_unavailable                   the provider answered, but not with an answer
 *   503 places_busy                          the provider is at capacity or has cut us off
 *
 * `disabled` is separate from an empty list on purpose. A cell that said "no places match
 * 'Paris'" because the owner turned the feature off would be describing a fact about the
 * *app* as a fact about the world, and the person would go on correcting a correctly
 * spelled address. The client shows the difference.
 *
 * `busy` is separate from `places_unavailable` for the same reason one level down: 503 and
 * 429 are the provider saying "later", not "never". It is also the state this app reached in
 * testing by typing quickly enough, so the person must be told to wait rather than to
 * distrust their address or their network.
 */
export const runtime = "nodejs";

const MIN_QUERY = 2;
/* Long enough for the longest postal address anyone types, short enough that the query
   string cannot be used to make us fetch something enormous. */
const MAX_QUERY = 120;

export async function GET(request: Request) {
  return api(
    request,
    async () => {
      const query = (new URL(request.url).searchParams.get("q") ?? "").trim();
      if (query.length < MIN_QUERY) throw new AppError(400, "invalid_input", "Type at least two characters to search for a place.");
      if (query.length > MAX_QUERY) throw new AppError(400, "invalid_input", "That address is too long to search for.");

      const endpoint = placesEndpoint();
      if (endpoint === null) return { results: [], disabled: true };

      try {
        const { results, matchedNumber } = await searchPlaces(query, endpoint, request.signal);
        return { results, matchedNumber };
      } catch (error) {
        if (error instanceof PlaceServiceBusy) {
          console.error("Raspberry place search is waiting", error.message);
          throw new AppError(503, "places_busy", "The place service is busy — try again in a moment.");
        }
        if (error instanceof PlaceServiceError) {
          /* The message names the provider's problem in the server log; the client is told
             the one thing it can act on — that this is not about their address. */
          console.error("Raspberry place search failed", error.message);
          throw new AppError(502, "places_unavailable", "The place service could not be reached.");
        }
        throw error;
      }
    },
    /* One request per pause in typing, and a pause is 380ms on the client. An address-shaped
       query is two provider requests, so 120 a minute is still a third more than the fastest
       typist alive can spend, and far below the read bucket — a runaway client cannot turn
       this app into somebody's geocoding proxy. */
    { bucket: "places", limit: 120, windowMs: 60_000 },
  );
}
