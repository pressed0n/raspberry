import { tileUrl } from "../lib/geo/mercator";

/**
 * Map tiles — the app's *second* outbound request, and it is an image fetch.
 * ---------------------------------------------------------------------------
 * The Place cell shows a map of the place you just picked, and the map is made of 256px
 * squares that somebody else renders. Those squares are fetched here, on the server, for the
 * same reason the search is (`places.ts`): a browser that asked for them itself would put
 * this machine's address and the fact that somebody just picked a home address into a third
 * party's log, once per tile, and the `User-Agent` it identified itself with would be whatever
 * Chrome felt like — which is precisely what OSM's tile policy exists to stop.
 *
 * So the browser asks *us* for `z/x/y`, and we ask the tile server, with a UA that says what
 * this is. That also makes the whole thing one switch: **`RASPBERRY_TILES_URL=off`** and the
 * preview still draws its pin on its own background, honestly labelled, with nothing leaving
 * the machine.
 *
 * What is deliberately absent: a retry. A view is four squares, and a square that fails is a
 * *hole*, not a lost answer — retrying it costs the person waiting on a preview they are
 * going to see in three seconds anyway. The search retries once because losing it loses the
 * whole answer; here it does not.
 */
const DEFAULT_ENDPOINT = "https://tile.openstreetmap.org";
const REQUEST_TIMEOUT_MS = 4_000;

/* A tile is a small PNG — OSM's are ~8-25 KB. 512 KB is the point at which the "tile" is
   something else wearing a PNG's content-type, and storing it would be a way to fill the
   process's memory through a route anybody can call. */
const MAX_TILE_BYTES = 512 * 1024;

/* Tiles change rarely: a new building appears and a tile is re-rendered weeks later. A day is
   long enough that a person reopening the same place never pays for it twice, and short
   enough that a map does not drift for a month. */
const TILE_TTL_MS = 24 * 60 * 60_000;
/* Past the TTL a tile is no longer fresh but still a better answer than a hole, so a failing
   tile server degrades the map rather than emptying it — the same rule the search follows. */
const TILE_STALE_MS = 7 * 24 * 60 * 60_000;
const CACHE_MAX_ENTRIES = 900;
const CACHE_MAX_BYTES = 24 * 1024 * 1024;

export class TileServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TileServiceError";
  }
}

/** The tile server in force, or `null` when maps are switched off. */
export function tilesEndpoint(): string | null {
  const raw = process.env.RASPBERRY_TILES_URL;
  if (raw === undefined || raw.trim() === "") return DEFAULT_ENDPOINT;
  const value = raw.trim();
  /* Case-insensitive for the same reason as `placesEndpoint`: this is an environment
     variable somebody typed by hand, not an API. */
  const keyword = value.toLowerCase();
  return keyword === "off" || keyword === "none" || keyword === "disabled" ? null : value;
}

type TileEntry = { at: number; type: string; body: Uint8Array<ArrayBuffer> };

/* On `globalThis` for the same reason as the place cache: a dev-mode hot reload re-evaluates
   this module, and a module-scoped Map would become a second, empty cache on every save —
   which for tiles means four fresh requests to somebody else's server per save.

   The byte total is kept *inside* the same object as the entries. Two globals would let a
   reload keep the entries from the old file and the total from the new one, and the eviction
   it then drives deletes nothing. */
type Store = { raspberryTileCache?: { entries: Map<string, TileEntry>; bytes: number } };
const store = globalThis as typeof globalThis & Store;

function cache(): { entries: Map<string, TileEntry>; bytes: number } {
  const current = store.raspberryTileCache;
  /* Shape-checked on every use, not just on creation: the value outlives the module that wrote
     it, so an entry left by an older version of this file must never be trusted to be what
     this one expects. (The place cache learned that the expensive way — every search answered
     "nothing found" on the running dev server until the process was restarted.) */
  if (!current || !(current.entries instanceof Map) || typeof current.bytes !== "number") {
    store.raspberryTileCache = { entries: new Map(), bytes: 0 };
  }
  return store.raspberryTileCache as { entries: Map<string, TileEntry>; bytes: number };
}

/** For tests: nothing cached, and a fresh object rather than a mutated one. */
export function clearTileCache(): void {
  store.raspberryTileCache = { entries: new Map(), bytes: 0 };
}

export function tileCacheStats(): { entries: number; bytes: number } {
  const { entries, bytes } = cache();
  return { entries: entries.size, bytes };
}

function read(key: string, now: number): { entry: TileEntry; fresh: boolean } | null {
  const state = cache();
  const entry = state.entries.get(key);
  if (!entry) return null;
  /* A truthy object with no `body` is not a tile, whatever version of this file wrote it. */
  if (!(entry.body instanceof Uint8Array) || typeof entry.type !== "string") {
    if (entry.body instanceof Uint8Array) state.bytes = Math.max(0, state.bytes - entry.body.byteLength);
    state.entries.delete(key);
    return null;
  }
  const age = now - entry.at;
  if (age <= TILE_TTL_MS) return { entry, fresh: true };
  if (age > TILE_STALE_MS) return null;
  return { entry, fresh: false };
}

function write(key: string, entry: TileEntry): void {
  const store = cache();
  const previous = store.entries.get(key);
  if (previous) {
    store.entries.delete(key);
    store.bytes -= previous.body.byteLength;
  }
  /* Insertion order is the recency order: a re-write moves the key to the end. */
  while (store.entries.size >= CACHE_MAX_ENTRIES || store.bytes + entry.body.byteLength > CACHE_MAX_BYTES) {
    const oldest = store.entries.keys().next();
    if (oldest.done) break;
    const evicted = store.entries.get(oldest.value);
    store.entries.delete(oldest.value);
    if (evicted) store.bytes -= evicted.body.byteLength;
  }
  store.entries.set(key, entry);
  store.bytes += entry.body.byteLength;
}

export interface Tile {
  body: Uint8Array<ArrayBuffer>;
  /** `image/png` and friends, without parameters. */
  type: string;
  /** True when this answer came out of the cache rather than off the network. The probe uses
   *  it to tell "the map drew" from "the map drew from a cache that was already warm". */
  cached: boolean;
}

/** One square, from the cache when it has been fetched recently. */
export async function fetchTile(
  z: number,
  x: number,
  y: number,
  endpoint: string,
  signal?: AbortSignal,
  now = Date.now(),
): Promise<Tile> {
  const key = `${z}/${x}/${y}`;
  const remembered = read(key, now);
  if (remembered?.fresh) return { ...remembered.entry, cached: true };

  let response: Response;
  try {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    response = await fetch(tileUrl(endpoint, z, x, y), {
      headers: {
        accept: "image/png,image/*;q=0.8",
        /* Identifies the application rather than pretending to be a browser. OSM's policy
           asks for exactly this, and a default fetch UA does not provide it. */
        "user-agent": "Raspberry/0.1 (local notes app; map preview)",
      },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    /* A tile server that is refusing this machine is still a *hole* rather than a lost answer,
       so a remembered square is better than none — but only if we had one. */
    if (remembered) return { ...remembered.entry, cached: true };
    throw new TileServiceError(`the tile server could not be reached: ${(error as Error).message}`);
  }

  if (!response.ok) {
    if (remembered) return { ...remembered.entry, cached: true };
    throw new TileServiceError(`the tile server answered ${response.status}`);
  }

  /* A 200 carrying an HTML "rate limited" page is not a tile. Without this check the browser
     would be handed 4 KB of markup under `image/png` and draw four broken images, which looks
     exactly like the app being broken. */
  const type = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  if (!/^image\//i.test(type)) {
    if (remembered) return { ...remembered.entry, cached: true };
    throw new TileServiceError(`the tile server answered with ${type === "" ? "no content type" : type}`);
  }

  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength === 0) throw new TileServiceError("the tile server answered with an empty body");
  if (body.byteLength > MAX_TILE_BYTES) throw new TileServiceError(`the tile server answered with ${body.byteLength} bytes, which is not a tile`);

  write(key, { at: now, type, body });
  return { body, type, cached: false };
}

