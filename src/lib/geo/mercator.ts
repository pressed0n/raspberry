/**
 * Web Mercator, and the tile grid that covers a rectangle of it.
 * ---------------------------------------------------------------------------
 * The Place cell's map preview needs two things and nothing else: where a coordinate lands
 * in the world, and which 256px squares of the world a box of a given size sits on. That is
 * the whole of this file — no state, no React, no network — because the map *view* of a
 * database (one point per row, drawn over one map) is the next thing that needs exactly this
 * and must not end up with a second, slightly different copy of the arithmetic.
 *
 * Three conventions, each of which is a bug if broken quietly:
 *
 * **X grows east, Y grows south.** Mercator's Y is the opposite of screen coordinates, so the
 * projection flips it here, once. A caller that flips it again puts Slovenia in the Sahara —
 * the same class of error as the `[lng, lat]` swap the place tests already guard.
 *
 * **The world wraps east-west and stops north-south.** A tile at x < 0 is the same square as
 * x + 2^z (the antimeridian), so those are wrapped. A tile at y < 0 or y >= 2^z is *outside*
 * the world, so those are dropped rather than wrapped — wrapping them would draw the Arctic
 * under the Antarctic.
 *
 * **The projection is clamped, not refused.** `project` pins latitude to the Mercator limit,
 * because a value that reached the database as 89.9° from a sloppy geocoder must still draw
 * *somewhere honest* (the top of the world) rather than at negative infinity.
 *
 * The one thing deliberately *not* here: fractional tile positions. The origin is rounded once
 * and every tile is derived from it, so each square is handed to the browser at an integer
 * offset. A compositor given two fractional neighbours rounds each one on its own, and two
 * independent roundings of adjacent edges is how a row of tiles ends up with a 1px seam of
 * background showing through — which is what makes a hand-rolled map look hand-rolled.
 */

/** One square of the slippy-map pyramid, in the pixels of the world it came from. */
export const TILE_SIZE = 256;

/* The tile servers this app may talk to serve z0-z19. Beyond that a "tile" is a single
   building and the preview would be a wall. */
export const MIN_ZOOM = 0;
export const MAX_ZOOM = 19;

/** The latitude at which Web Mercator reaches ±π. Anything beyond it is not on the map. */
export const MAX_LATITUDE = 85.0511287798066;

export interface MapPoint {
  lat: number;
  lng: number;
}

/** The projected position, in pixels of the whole world at one zoom. */
export interface WorldPixel {
  x: number;
  y: number;
}

export function clampLatitude(lat: number): number {
  return Math.min(MAX_LATITUDE, Math.max(-MAX_LATITUDE, lat));
}

/** Longitude folded into [-180, 180). 180 and -180 are one meridian; this file picks the
 *  west side of it so that a point on the antimeridian projects to x = 0, not x = worldSize. */
export function wrapLongitude(lng: number): number {
  return (((lng + 180) % 360) + 360) % 360 - 180;
}

/** A coordinate's position on the world square at `zoom`, in pixels from the north-west
 *  corner of the world. Y grows **south**, like a screen. */
export function project(point: MapPoint, zoom: number): WorldPixel {
  const size = TILE_SIZE * 2 ** zoom;
  const radians = (clampLatitude(point.lat) * Math.PI) / 180;
  return {
    x: ((wrapLongitude(point.lng) + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * size,
  };
}

/** One tile placed inside the box: `left`/`top` are where its north-west corner goes, in the
 *  box's own pixels. */
export interface MapTile {
  /** Stable React key and cache identity: `16/33185/23093`. */
  key: string;
  z: number;
  x: number;
  y: number;
  left: number;
  top: number;
}

export interface TileGrid {
  zoom: number;
  width: number;
  height: number;
  /** Where the centre coordinate lands inside the box — the pin's position. Within half a
   *  pixel of `width / 2, height / 2` by construction, fractional on purpose. */
  pin: { left: number; top: number };
  tiles: MapTile[];
}

/**
 * The tiles that cover a `width` × `height` box centred on `center`.
 *
 * The box is the window onto the world: its centre *is* the point, so the pin never has to be
 * positioned by a second calculation that could disagree with the first.
 */
export function tileGrid(center: MapPoint, zoom: number, width: number, height: number): TileGrid {
  const level = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(zoom)));
  const world = project(center, level);
  const count = 2 ** level;

  /* Rounded once, here. Every tile below is derived from it, so neighbours cannot drift. */
  const originX = Math.round(world.x - width / 2);
  const originY = Math.round(world.y - height / 2);

  const tiles: MapTile[] = [];
  const seen = new Set<string>();
  const lastX = Math.floor((originX + width - 1) / TILE_SIZE);
  const lastY = Math.floor((originY + height - 1) / TILE_SIZE);
  for (let ty = Math.floor(originY / TILE_SIZE); ty <= lastY; ty++) {
    /* North of the top of the world, or south of the bottom: nothing to draw. */
    if (ty < 0 || ty >= count) continue;
    for (let tx = Math.floor(originX / TILE_SIZE); tx <= lastX; tx++) {
      const x = ((tx % count) + count) % count;
      const key = `${level}/${x}/${ty}`;
      /* Only reachable from a box wider than the world (zoom 0, say). Two identical keys are
         one tile to React and would be drawn twice. */
      if (seen.has(key)) continue;
      seen.add(key);
      tiles.push({ key, z: level, x, y: ty, left: tx * TILE_SIZE - originX, top: ty * TILE_SIZE - originY });
    }
  }

  return { zoom: level, width, height, pin: { left: world.x - originX, top: world.y - originY }, tiles };
}

/** `z/x/y` is an existing square of the pyramid. The server refuses anything else rather than
 *  asking a tile server for a square that cannot exist — which for `x = -1` would be a 404 and
 *  for `z = 40` would be a request for a 2^40-wide image. */
export function isValidTile(z: number, x: number, y: number): boolean {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (z < MIN_ZOOM || z > MAX_ZOOM) return false;
  const count = 2 ** z;
  return x >= 0 && x < count && y >= 0 && y < count;
}

/** A tile server's URL for one square. Trailers are trimmed so a base ending in `/` does not
 *  produce `//16/…` — the fixture in the probe and the public server differ by exactly that. */
export function tileUrl(base: string, z: number, x: number, y: number): string {
  return `${base.replace(/\/+$/, "")}/${z}/${x}/${y}.png`;
}

/** The app's own route, which is where the browser gets its tiles. */
export function tileSrc(z: number, x: number, y: number): string {
  return `/api/places/tile?z=${z}&x=${x}&y=${y}`;
}

/** Where "open in a real map" goes — Google Maps, which is where a person who does not know
 *  what OpenStreetMap is can actually navigate, and which answers to an address search as well
 *  as to a pin.
 *
 *  **The query is the coordinate, not the address.** The address is text the provider gave us
 *  and Google would re-geocode it against its own database — so `Rašica 53` could land on a
 *  different doorstep from the one the pin was drawn on a pixel earlier. A coordinate cannot be
 *  re-geocoded: `maps/search/?api=1&query=lat,lng` is Google's documented keyless form and shows
 *  the place at exactly the point we stored. One behaviour, always, and it opens what it drew.
 *
 *  Six decimals is Google's documented maximum and ~11cm — the precision the provider gave us,
 *  rather than a rounding of it. Latitude and longitude are clamped first, because `90` is not a
 *  point on this map and `190` is a longitude the provider should have wrapped and did not. */
export function mapLink(point: MapPoint): string {
  const lat = clampLatitude(point.lat).toFixed(6);
  const lng = wrapLongitude(point.lng).toFixed(6);
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
