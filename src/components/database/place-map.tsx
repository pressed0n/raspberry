"use client";
/* The map preview inside a Place cell.
   ---------------------------------------------------------------------------
   The owner's words: "When I do select a location in notion, the dropdown gets overwritten by
   a map with a pin on my selected location ... lets implement that too on Raspberry."

   So this is the second half of a Place cell: the list finds a place, this shows where it is.
   Four squares of OpenStreetMap, drawn as plain `<img>`s positioned by `tileGrid`, with a pin
   at the coordinate the value actually stores. No map library: at this size a library is a
   dependency, a canvas and a WebGL context to draw four images, and the arithmetic it would
   hide is forty lines in `src/lib/geo/`. The database's future map view wants that arithmetic
   at a larger size and its own zoom, which is why it is a library and not a component.

   **The bytes come from our own route**, `/api/places/tile`, not from a tile server: a
   browser-side `<img src="https://tile.openstreetmap.org/…">` would tell a stranger the place
   somebody just picked, four times, on every open. See `src/server/tiles.ts`.

   The one thing here that *does* leave the app is the corner arrow, and it leaves on a press:
   the coordinate goes to Google Maps because a person asked to see it in Google Maps, and gets
   there as a coordinate rather than as re-geocoded address text — see `mapLink`.
   --------------------------------------------------------------------------- */
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { mapLink, tileSrc, type MapPoint } from "@/lib/geo/mercator";
import { previewGrid } from "@/lib/geo/preview";

/** Why the map is blank. Three sentences because there are three different situations, and
 *  "the map is broken" is not one of them: the person can act on the first, wait out the
 *  second, and has to do nothing about the third. */
type Blank = "off" | "busy" | "failed";

const BLANK_TEXT: Record<Blank, string> = {
  off: "Map tiles are switched off",
  busy: "The map server is busy",
  failed: "The map could not be drawn",
};

export function PlaceMap({ point, approximate, label }: { point: MapPoint; approximate: boolean; label: string }) {
  const grid = previewGrid(point, approximate);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const [blank, setBlank] = useState<Blank | null>(null);
  const asked = useRef(false);

  const first = grid.tiles[0];
  const empty = grid.tiles.every((tile) => failed.has(tile.key));
  /* Re-armed when the box shows a different place, so a second failing place is described too
     rather than inheriting the first one's silence. */
  const mark = `${grid.zoom}/${Math.round(point.lat * 1e4)}/${Math.round(point.lng * 1e4)}`;
  useEffect(() => { asked.current = false; }, [mark]);

  /* All four squares failed, so the reason is worth one request more than a blank box is
     worth guessing at. It runs only in the failure path — a healthy map never costs this. */
  useEffect(() => {
    if (!empty || !first || asked.current) return;
    asked.current = true;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(tileSrc(first.z, first.x, first.y), { cache: "no-store", signal: controller.signal });
        const body: { error?: { code?: string } } | null = response.ok ? null : await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        const code = body?.error?.code ?? "";
        setBlank(code === "tiles_off" ? "off" : response.status === 429 || code === "rate_limited" ? "busy" : "failed");
      } catch {
        if (!controller.signal.aborted) setBlank("failed");
      }
    })();
    return () => controller.abort();
  }, [empty, first]);

  /* The box is sized from the grid, not from CSS: the tiles are positioned by `tileGrid`, so a
     width written again in the stylesheet is a second opinion that would crop them. */
  return (
    <div className="db-place-map" data-db-place-map="" style={{ width: grid.width, height: grid.height }}>
      {/* Until at least one square has failed, the tiles are shown. A partly-drawn map is not a
          broken map: three squares and a hole is still the street you are looking at. */}
      {!empty && (
        <div className="db-place-tiles">
          {grid.tiles.map((tile) => (
            <img
              key={tile.key}
              className="db-place-tile"
              src={tileSrc(tile.z, tile.x, tile.y)}
              width={256}
              height={256}
              style={{ left: tile.left, top: tile.top }}
              alt=""
              aria-hidden
              draggable={false}
              decoding="async"
              onError={() => setFailed((current) => (current.has(tile.key) ? current : new Set(current).add(tile.key)))}
            />
          ))}
        </div>
      )}
      {empty && <p className="db-place-map-note">{blank === null ? "Drawing the map…" : BLANK_TEXT[blank]}</p>}
      <span
        className="db-place-pin"
        data-approx={approximate ? "" : undefined}
        style={{ left: grid.pin.left, top: grid.pin.top }}
        title={approximate ? "Approximate — placed on the road, not the door" : "The selected place"}
      />
      <a
        className="db-place-map-open"
        href={mapLink(point)}
        target="_blank"
        rel="noreferrer noopener"
        title={`Open ${label} in Google Maps`}
        aria-label={`Open ${label} in Google Maps`}
      >
        {/* The URL cell's glyph, at the URL cell's size: it is the same promise — this leaves
            the app, in a new tab — and two different arrows for it would be two languages. */}
        <ArrowUpRight size={13} aria-hidden />
      </a>
      <a className="db-place-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer noopener" hidden={empty}>
        © OpenStreetMap contributors
      </a>
    </div>
  );
}
