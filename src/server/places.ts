import { placeResults, readQuery, type PlaceHit } from "../lib/database/property-types/place";

/**
 * The place search — the one part of this app that talks to somebody else's computer.
 * ---------------------------------------------------------------------------
 * Three things here are deliberate and each has a cost, so each is written down.
 *
 * **It is on the server.** The browser could call a geocoder directly and it would be
 * twenty lines shorter. It would also send the owner's IP address, every keystroke of a
 * half-typed home address, and a user-agent we do not control to a third party — and the
 * `User-Agent` is the whole reason OSM's policy exists. On the server the provider sees one
 * identified application, the answer is cached for every cell that asks the same question,
 * and one env var turns the whole thing off.
 *
 * **The provider is Photon, not Nominatim.** Not a preference: OSM's usage policy for
 * Nominatim explicitly forbids "auto-complete search", which is the exact feature being
 * built. Photon (`photon.komoot.io`) is an OSM-derived geocoder intended for search-as-you-
 * type and needs no key. Any service that speaks the same GeoJSON shape works.
 *
 * **A search is more than one question.** `providerQueries` explains why an address-shaped
 * query is asked twice; it is the fix for the owner's first example and it costs one extra
 * request in the case where the first one was already going to be wrong.
 *
 * **And it is a free service, so it has to be treated like one.** Measured on 2026-11-01:
 * about twenty requests inside two minutes and the public Photon instance stopped answering
 * this machine at all — 503s, then TCP timeouts, for the rest of the evening, while
 * Nominatim and example.com kept answering in under a second. A person typing an address
 * produces one request per pause, so the pause is generous, nothing is asked twice, a 5xx is
 * retried once, and after three failures in a row this module stops asking at all for thirty
 * seconds and says so — because thirty doomed requests behind a busy provider is how a
 * shared free service gets withdrawn for everybody.
 *
 * **`RASPBERRY_PLACES_URL` overrides it, and `off` disables it.**
 *   unset            → Photon
 *   `off` / `none`   → no network at all; the cell is a plain text field that says so
 *   `http://…`      → any GeoJSON geocoder, which is also how the probe runs deterministically
 *                      (`scripts/verify-db-places.mjs` starts a fixture on loopback) without
 *                      a single keystroke leaving the machine.
 *
 * What is NOT here: a key. If a provider ever needs one it goes in the environment beside
 * this setting, never in a request from the browser, and never in a cell's config — a
 * database is shared, a key is not.
 */
const DEFAULT_ENDPOINT = "https://photon.komoot.io/api/";
const REQUEST_TIMEOUT_MS = 4_000;
/* Ask for more than we draw. Ranking re-orders the provider's answer, so the answer we
   re-order should be wider than the list we show — a top-six cut taken before the sort is
   six rows the sort was never allowed to improve. One request either way. */
const FETCH_LIMIT = 20;
const WANT = 6;
const CACHE_TTL_MS = 10 * 60_000;
/* How long a cached answer stays usable *when the provider is failing*. Past the ten minutes
   it is no longer fresh enough to answer with on a good day, but it is still a better answer
   than an error message on a bad one. */
const CACHE_STALE_MS = 60 * 60_000;
const CACHE_MAX = 120;
const RETRY_AFTER_MS = 300;
const BREAK_AFTER = 3;
const BREAK_FOR_MS = 30_000;

export class PlaceServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaceServiceError";
  }
}

/** The provider is not broken, it is *busy* — and that is a different sentence to the person
 *  typing, because the answer is "wait a moment" rather than "check your connection". */
export class PlaceServiceBusy extends PlaceServiceError {
  constructor(message: string) {
    super(message);
    this.name = "PlaceServiceBusy";
  }
}

/** The endpoint in force, or `null` when search is switched off. */
export function placesEndpoint(): string | null {
  const raw = process.env.RASPBERRY_PLACES_URL;
  if (raw === undefined || raw.trim() === "") return DEFAULT_ENDPOINT;
  const value = raw.trim();
  /* Case-insensitive: `OFF` is the same instruction as `off`, and an environment variable
     somebody typed by hand is not the place to be strict about capitalization. */
  const keyword = value.toLowerCase();
  return keyword === "off" || keyword === "none" || keyword === "disabled" ? null : value;
}

/* The cache lives on `globalThis` for the same reason `runtime.ts` parks its service there:
   a dev-mode hot reload re-evaluates this module, and a module-scoped Map would silently
   become a second, cold cache every time a file is saved.

   It holds the provider's *features*, not our finished rows. Two people asking "Rašica" and
   "Rašica 53" are one provider question and two different orderings, so the ordering has to
   happen after the cache, never inside it. */
type CacheEntry = { at: number; features: unknown[] };
type Store = {
  raspberryPlaceCache?: Map<string, CacheEntry>;
  raspberryPlaceHealth?: { failures: number; until: number };
};
const store = globalThis as typeof globalThis & Store;

function cache(): Map<string, CacheEntry> {
  store.raspberryPlaceCache ??= new Map();
  return store.raspberryPlaceCache;
}

function health(): { failures: number; until: number } {
  store.raspberryPlaceHealth ??= { failures: 0, until: 0 };
  return store.raspberryPlaceHealth;
}

/** "Paris" and "paris " and "  PARIS" are one question to a rate-limited provider. */
function cacheKey(query: string): string {
  return query.toLowerCase().replace(/\s+/g, " ").trim();
}

function read(key: string, now: number): { features: unknown[]; fresh: boolean } | null {
  const entry = cache().get(key);
  if (!entry) return null;
  /* The cache is on `globalThis`, so it outlives the module that wrote it. An entry stored by
     an older shape of this file (`{ at, hits }`, before ranking moved here) is a truthy object
     with no `features`, and returning it made every search answer "nothing found" on the live
     dev server until the process was restarted — measured, not imagined. An entry is only an
     answer if it still has the shape of one. */
  if (!Array.isArray(entry.features)) {
    cache().delete(key);
    return null;
  }
  const age = now - entry.at;
  if (age <= CACHE_TTL_MS) return { features: entry.features, fresh: true };
  if (age > CACHE_STALE_MS) {
    cache().delete(key);
    return null;
  }
  return { features: entry.features, fresh: false };
}

function write(key: string, features: unknown[], now: number): void {
  const entries = cache();
  /* Oldest first: a Map iterates in insertion order, and re-inserting a key on write keeps
     the *most recent* entry at the end, which is the one we keep. */
  while (entries.size >= CACHE_MAX) {
    const oldest = entries.keys().next();
    if (oldest.done) break;
    entries.delete(oldest.value);
  }
  entries.set(key, { at: now, features });
}

/**
 * The questions to ask a provider for one typed query.
 *
 * `Rašica 53` is a name and a door on it. Photon treats the trailing number as the thing to
 * satisfy and lets the name go fuzzy, so the answer to that one question was `53 Rašice` in
 * Slovakia and eight more streets ending in 53 — the village the person meant was not in the
 * top ten at all. Asked as `Rašica`, the same index answers correctly and instantly.
 *
 * So an address-shaped query is asked twice: as typed (which finds the door when the door
 * exists — `Grahovo Brdo 1` is a node in OSM and Photon finds it) and without the number
 * (which finds the street the door is on when it does not). The second answer is not a
 * fallback for a failed search; it is the answer to the other half of the question.
 */
export function providerQueries(query: string): string[] {
  const plan = readQuery(query);
  /* Two characters of name is the floor: a single letter plus a number says nothing about
     which street was meant, and it is a whole request to find that out. */
  if (!plan.address || plan.words.length < 2) return [query];
  return [query, plan.words];
}

async function fetchFeatures(endpoint: string, query: string, signal?: AbortSignal): Promise<unknown[]> {
  const url = new URL(endpoint);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(FETCH_LIMIT));

  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const attempt = async (): Promise<Response> => fetch(url, {
    headers: {
      accept: "application/json",
      /* Identifies the application rather than pretending to be a browser, which is what
         the provider's policy asks for and what a default fetch UA fails to do. */
      "user-agent": "Raspberry/0.1 (local notes app; place autocomplete)",
    },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });

  let response: Response;
  try {
    response = await attempt();
    /* One retry, and only for a *reply*. A provider that refuses the connection is not
       briefly busy, it has decided not to talk to us, and retrying that doubles a four
       second wait to tell us the same thing. */
    if (response.status === 429 || response.status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
      response = await attempt();
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new PlaceServiceError(`the place service could not be reached: ${(error as Error).message}`);
  }
  if (!response.ok) {
    if (response.status === 429 || response.status >= 500) {
      throw new PlaceServiceBusy(`the place service answered ${response.status}`);
    }
    throw new PlaceServiceError(`the place service answered ${response.status}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    /* A 200 with a captcha page in it is a failure, not an empty list. Saying "no results"
       here would be the app blaming the address for the provider's problem. */
    throw new PlaceServiceError("the place service answered with something that is not GeoJSON");
  }
  const features = typeof body === "object" && body !== null ? (body as { features?: unknown }).features : undefined;
  return Array.isArray(features) ? features : [];
}

/** One provider question, from the cache when it has been asked recently.
 *
 *  An empty answer is cached — "nothing is called that" is a real answer, and re-asking a
 *  rate-limited provider the same unsuccessful question on every keystroke of a backspace is
 *  how a free service gets withdrawn. A *failure* is not cached as an answer, but a stale
 *  answer is used in its place, so an outage degrades the list instead of emptying it. */
async function features(endpoint: string, query: string, signal: AbortSignal | undefined, now: number): Promise<unknown[]> {
  if (now < health().until) throw new PlaceServiceBusy("the place service is resting after repeated failures");

  const key = cacheKey(query);
  const entry = read(key, now);
  if (entry?.fresh) return entry.features;

  try {
    const features = await fetchFeatures(endpoint, query, signal);
    health().failures = 0;
    health().until = 0;
    write(key, features, now);
    return features;
  } catch (error) {
    if (!signal?.aborted) {
      health().failures += 1;
      if (health().failures >= BREAK_AFTER) health().until = now + BREAK_FOR_MS;
    }
    if (entry !== null) {
      console.error("Raspberry place search answered from a stale cache", (error as Error).message);
      return entry.features;
    }
    throw error;
  }
}

export interface PlaceSearch {
  results: PlaceHit[];
  /** False when a house number was typed and no result carries it — a fact about the map
   *  data, which the surface can say plainly instead of appearing to ignore half a query. */
  matchedNumber: boolean;
}

/**
 * Search, from the cache when this question has been asked recently.
 *
 * The passes run together and are merged into one pool, because they answer one question and
 * the ranker is what decides between them: a door found by the first pass outranks the street
 * found by the second (it agrees with the number), and the street outranks a street in
 * another country (it agrees with the name). One pass failing does not lose the other — a
 * provider that answered the street question has answered most of what was asked.
 */
export async function searchPlaces(query: string, endpoint: string, signal?: AbortSignal, now = Date.now()): Promise<PlaceSearch> {
  const asked = providerQueries(query);
  const answers = await Promise.allSettled(asked.map((question) => features(endpoint, question, signal, now)));

  const answered = answers.filter((answer): answer is PromiseFulfilledResult<unknown[]> => answer.status === "fulfilled");
  if (answered.length === 0) {
    /* Every pass failed with the same cause, so report the first one as itself: busy stays
       busy, unreachable stays unreachable. */
    throw (answers[0] as PromiseRejectedResult).reason;
  }

  const pool = answered.flatMap((answer) => answer.value);
  const { hits, matchedNumber } = placeResults(pool, query, WANT);
  return { results: hits, matchedNumber };
}
