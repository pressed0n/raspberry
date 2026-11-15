import { isValidTile } from "@/lib/geo/mercator";
import { api } from "@/server/http";
import { AppError } from "@/server/service";
import { TileServiceError, fetchTile, tilesEndpoint } from "@/server/tiles";

/**
 * GET /api/places/tile?z=<zoom>&x=<column>&y=<row>
 * ---------------------------------------------------------------------------
 * The Place cell's map preview, one square at a time. Answers the PNG bytes, not JSON —
 * `http.ts` returns a `Response` untouched for exactly this case.
 *
 * **The browser never names a host.** It names a square of the world, and this route decides
 * which server renders it (`RASPBERRY_TILES_URL`), with a `User-Agent` that says whose request
 * it is. A `<img src="https://tile.openstreetmap.org/…">` would have been one line shorter and
 * would have handed each person's address to a stranger's access log four times per cell.
 *
 * Three answers, and they are different sentences:
 *
 *   200  image/png                      the square
 *   400  invalid_input                  not a square of the pyramid (z, x, y out of range)
 *   503  tiles_off                      `RASPBERRY_TILES_URL=off` — the map draws without tiles
 *   502  tile_unavailable               the tile server answered with something that is not a tile
 *
 * `cache-control: private` rather than `public`: in session mode this route sits behind
 * sign-in, and a shared cache keyed only by URL would hand one person's square to another.
 * A week of `max-age` on the private cache is what makes reopening the same place free.
 */
export const runtime = "nodejs";

/** A decimal integer out of a query string, or `null`. `""` and `"1e3"` and `"-1"` are not
 *  square indices, and `Number("")` is `0` — which would be a real tile. Seven digits is the
 *  widest a real index gets (z19 is 524287); `isValidTile` decides whether it is one. */
function index(value: string | null): number | null {
  if (value === null) return null;
  const text = value.trim();
  if (!/^\d{1,7}$/.test(text)) return null;
  return Number(text);
}

export async function GET(request: Request) {
  return api(
    request,
    async () => {
      const params = new URL(request.url).searchParams;
      const z = index(params.get("z"));
      const x = index(params.get("x"));
      const y = index(params.get("y"));
      if (z === null || x === null || y === null || !isValidTile(z, x, y)) {
        throw new AppError(400, "invalid_input", "That is not a square of the map.");
      }

      const endpoint = tilesEndpoint();
      if (endpoint === null) throw new AppError(503, "tiles_off", "Map tiles are switched off.");

      try {
        const tile = await fetchTile(z, x, y, endpoint, request.signal);
        return new Response(tile.body, {
          status: 200,
          headers: {
            "content-type": tile.type,
            "content-length": String(tile.body.byteLength),
            /* A week in the browser, so reopening the same place costs nothing. The server's
               own copy is the one that has to stay honest about the provider — see `tiles.ts`. */
            "cache-control": "private, max-age=604800",
            /* Which of the two this was. A probe can then tell "the map drew" from "the map
               drew out of a cache that a previous step had already warmed". */
            "x-raspberry-cache": tile.cached ? "hit" : "miss",
          },
        });
      } catch (error) {
        if (error instanceof TileServiceError) {
          console.error("Raspberry map tile failed", error.message);
          throw new AppError(502, "tile_unavailable", "The map could not be drawn.");
        }
        throw error;
      }
    },
    /* A preview is four squares, and every one of them is cached by the browser afterwards.
       300 a minute leaves room for a person scrolling a future map view over a city and still
       cannot be pointed at somebody else's tile server as a relay. */
    { bucket: "tiles", limit: 300, windowMs: 60_000 },
  );
}
