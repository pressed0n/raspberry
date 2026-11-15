import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { TileServiceError, clearTileCache, fetchTile, tileCacheStats, tilesEndpoint } from "../src/server/tiles";

/* ---------------------------------------------------------------------------
   The tile proxy — the app's second outbound request.
   ---------------------------------------------------------------------------
   These tests replace `globalThis.fetch` and count the calls it receives, because the two claims
   that matter here cannot be seen from the outside: that a square is fetched *once* (a preview is
   four requests, and a map view scrolling would be hundreds), and that a failure is a `hole`
   rather than an `error` when an older copy of that square is still around.
   --------------------------------------------------------------------------- */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const realFetch = globalThis.fetch;
const realEnvironment = { ...process.env };

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of ["RASPBERRY_TILES_URL"]) {
    if (realEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = realEnvironment[key];
  }
  clearTileCache();
});

function stub(handler: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    return handler(url);
  }) as typeof fetch;
  return calls;
}

test("the tile server is OpenStreetMap unless the environment says otherwise", () => {
  delete process.env.RASPBERRY_TILES_URL;
  assert.equal(tilesEndpoint(), "https://tile.openstreetmap.org");
  process.env.RASPBERRY_TILES_URL = "http://127.0.0.1:3119/";
  assert.equal(tilesEndpoint(), "http://127.0.0.1:3119/");
  for (const off of ["off", "OFF", " none ", "disabled"]) {
    process.env.RASPBERRY_TILES_URL = off;
    assert.equal(tilesEndpoint(), null, `${off} should switch the map off`);
  }
});

test("a square is fetched once and then remembered", async () => {
  const calls = stub(() => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } }));
  const first = await fetchTile(16, 33185, 22545, "http://fixture", undefined, 1_000);
  assert.equal(first.cached, false);
  assert.equal(first.type, "image/png");
  const second = await fetchTile(16, 33185, 22545, "http://fixture", undefined, 2_000);
  assert.equal(second.cached, true);
  assert.equal(calls.length, 1, `fetched ${calls.length} times: ${JSON.stringify(calls)}`);
  assert.equal(tileCacheStats().entries, 1);
});

test("the request identifies the app, which is what the tile server's policy asks for", async () => {
  let agent = "";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    agent = String((init?.headers as Record<string, string> | undefined)?.["user-agent"] ?? "");
    return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
  }) as typeof fetch;
  await fetchTile(15, 1, 2, "http://fixture", undefined, 1_000);
  assert.match(agent, /^Raspberry\//);
});

test("a page of HTML with a 200 is not a tile", async () => {
  /* A rate-limited tile server answers 200 with a "you are being throttled" page. Stored under
     `image/png`, the browser draws four broken images — which looks exactly like this app being
     broken. */
  stub(() => new Response("<html>slow down</html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }));
  await assert.rejects(() => fetchTile(16, 1, 2, "http://fixture", undefined, 1_000), TileServiceError);
  assert.equal(tileCacheStats().entries, 0);
});

test("an empty body, or one far too big to be a tile, is refused", async () => {
  stub(() => new Response(new Uint8Array(0), { status: 200, headers: { "content-type": "image/png" } }));
  await assert.rejects(() => fetchTile(16, 3, 4, "http://fixture", undefined, 1_000), TileServiceError);
  stub(() => new Response(new Uint8Array(600 * 1024), { status: 200, headers: { "content-type": "image/png" } }));
  await assert.rejects(() => fetchTile(16, 5, 6, "http://fixture", undefined, 1_000), TileServiceError);
  assert.equal(tileCacheStats().entries, 0);
});

test("a failing square is an error only when there is nothing older to draw", async () => {
  const now = 1_000_000;
  stub(() => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } }));
  await fetchTile(16, 7, 8, "http://fixture", undefined, now);

  /* Past the day it stays fresh, so it is asked for again... */
  stub(() => new Response("nope", { status: 503 }));
  const stale = await fetchTile(16, 7, 8, "http://fixture", undefined, now + 25 * 60 * 60_000);
  assert.equal(stale.cached, true, "a slightly old square beats a hole");

  /* ...and a square nobody has ever seen is a failure, because a hole with no picture behind it
     is the app having nothing to show. */
  await assert.rejects(() => fetchTile(16, 9, 10, "http://fixture", undefined, now), TileServiceError);
});

test("the cache is shaped like a cache or replaced — the expensive lesson from the place search", async () => {
  /* The cache lives on `globalThis` so a hot reload does not cold-start it, which means an entry
     written by an older version of this file can be read by a newer one. The place search answered
     "nothing found" to every query for this exact reason, on a running server, with 556 tests
     green. A tile entry without bytes is not a tile. */
  const store = globalThis as unknown as { raspberryTileCache?: unknown };
  store.raspberryTileCache = { entries: new Map([["16/1/2", { at: 0, type: "image/png" }]]), bytes: 999 };
  stub(() => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } }));
  const tile = await fetchTile(16, 1, 2, "http://fixture", undefined, 1_000);
  assert.equal(tile.cached, false, "an entry with no body must not be treated as an answer");
  assert.equal(tileCacheStats().entries, 1);
});

test("eviction keeps the cache inside its memory budget", async () => {
  /* One square is a few kilobytes and a map view is hundreds of them, so the bound is bytes and
     not a count nobody can reason about. */
  stub(() => new Response(new Uint8Array(64 * 1024), { status: 200, headers: { "content-type": "image/png" } }));
  for (let i = 0; i < 400; i++) {
    await fetchTile(16, i, 1, "http://fixture", undefined, 1_000);
  }
  const { entries, bytes } = tileCacheStats();
  assert.ok(entries < 400, `kept every one of ${entries} squares`);
  assert.ok(bytes <= 24 * 1024 * 1024, `${bytes} bytes is over the budget`);
});
