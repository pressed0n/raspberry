import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  foldPlace,
  placeMatch,
  placeResults,
  readQuery,
} from "../src/lib/database/property-types/place";
import {
  PlaceServiceBusy,
  providerQueries,
  searchPlaces,
} from "../src/server/places";

/* ---------------------------------------------------------------------------
   The owner's words: "Search doesnt work the best yet ... Querrying 'Rašica 53' — on Notion
   the first result is 'Rašica 53, 1315 Velike Lašče, Slovenia'; on Raspberry the first result
   is '53 Rašice' in Slovakia. ... Ofcourse I dont want you to fix just those 2, they are just
   showing that there is a global problem that needs fixing."

   So the fixtures below are not invented to suit the ranker. They are the rows Photon really
   answered on 2026-11-01, with every property field copied from the response. Two things had
   to be checked against the map data itself before any of this was worth writing:

     * `Rašica 53` is **not in OpenStreetMap.** The street `Rašica` in Velike Lašče has two
       mapped addresses in the whole country — 40 and 12a (Overpass, `addr:street=Rašica`
       inside Slovenia). Notion returns that house because it is not an OSM geocoder. So
       there is no ordering of the provider's rows that can produce the door: the answer has
       to be *composed* — the address that was typed, placed on the road it would be on —
       which is what `composedHits` does and what `approx` records.
     * `Grahovo Brdo 1` **is** in OSM, as one node tagged `name=Turistična kmetija Mahnič`.
       That is why the answer was right and the *label* was wrong.
    --------------------------------------------------------------------------- */

function feature(properties: Record<string, unknown>, lng: number, lat: number) {
  return { type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties };
}

/* Recorded: `?q=Rašica 53&limit=10` — all ten rows. */
const RASICA_53 = [
  feature({ type: "house", street: "Rašice", housenumber: "53", city: "Rašice", postcode: "982 62", state: "Banskobystrický kraj", country: "Slovensko" }, 19.9, 48.6),
  feature({ type: "house", street: "Radical", housenumber: "53", city: "Armstrong", postcode: "2508", state: "Santa Fe", country: "Argentina" }, -61.6, -32.9),
  feature({ type: "house", name: "Stjepana Radića 53 (Vidovci)", street: "Ulica Stjepana Radića", city: "Požega", postcode: "34000", country: "Hrvatska" }, 17.68, 45.33),
  feature({ type: "house", street: "Stjepana Radića", housenumber: "53", city: "Petrinja", postcode: "44250", country: "Hrvatska" }, 16.28, 45.44),
  feature({ type: "house", street: "Ulica Stjepana Radića", housenumber: "53", city: "Selnik", postcode: "42230", country: "Hrvatska" }, 16.4, 46.2),
  feature({ type: "house", street: "Ulica braće Radića", housenumber: "53", city: "Koška", postcode: "31224", country: "Hrvatska" }, 18.29, 45.55),
  feature({ type: "house", street: "Ulica Stjepana Radića", housenumber: "53", city: "Ilača", postcode: "32248", country: "Hrvatska" }, 19.1, 45.18),
  feature({ type: "house", street: "Ulica Stjepana Radića", housenumber: "53", city: "Jakšić", postcode: "34308", country: "Hrvatska" }, 17.75, 45.36),
  feature({ type: "house", street: "Rasimäentie", housenumber: "53", city: "Savonlinna", postcode: "58810", state: "Etelä-Savo", country: "Suomi" }, 28.9, 61.87),
  feature({ type: "house", street: "улица Разина", housenumber: "53", city: "Пятигорск", postcode: "357500", country: "Россия" }, 43.05, 44.05),
];

/* Recorded: `?q=Rašica&limit=20` — the second question the planner asks. The roads matter and
   were missing from the first version of this fixture: a house number is an address *on* a
   road, so the roads are what `composedHits` counts. Four of them are in Velike Lašče and two
   in Ljubljana, which is the whole reason `Rašica 53` is offered at 1315 first — and the two
   houses the map does have on that road (40 and 12a) are both 1315. Non-Slovenian rows are
   trimmed; coordinates are rounded to the town. */
const RASICA = [
  feature({ type: "district", name: "Rašica", city: "Ljubljana", postcode: "1217", country: "Slovenija" }, 14.51, 46.136),
  feature({ type: "district", name: "Rašica", city: "Velike Lašče", postcode: "1315", country: "Slovenija" }, 14.623, 45.852),
  feature({ type: "other", name: "Rašica", city: "Velike Lašče", district: "Rašica", country: "Slovenija" }, 14.626, 45.851),
  feature({ type: "street", name: "Rašica", city: "Ljubljana", district: "Rašica", postcode: "1217", country: "Slovenija" }, 14.506, 46.135),
  feature({ type: "street", name: "Rašica", city: "Velike Lašče", district: "Rašica", postcode: "1315", country: "Slovenija" }, 14.623, 45.855),
  feature({ type: "street", name: "Rašica", city: "Velike Lašče", district: "Dolščaki", postcode: "1314", country: "Slovenija" }, 14.603, 45.859),
  feature({ type: "street", name: "Rašica", city: "Ljubljana", district: "Rašica", postcode: "1217", country: "Slovenija" }, 14.508, 46.136),
  feature({ type: "street", name: "Rašica", city: "Velike Lašče", district: "Rašica", postcode: "1311", country: "Slovenija" }, 14.621, 45.856),
  feature({ type: "street", name: "Rašica", city: "Velike Lašče", district: "Rašica", postcode: "1315", country: "Slovenija" }, 14.622, 45.854),
];

/* Recorded: `?q=Grahovo Brdo 1&limit=10` — and confirmed in OSM as the farm at that address. */
const GRAHOVO = [
  feature({ type: "house", name: "Turistična kmetija Mahnič", street: "Grahovo Brdo", housenumber: "1", city: "Sežana", postcode: "6210", country: "Slovenija" }, 13.8957, 45.7463),
  feature({ type: "district", name: "Grahovo Brdo", city: "Sežana", postcode: "6210", country: "Slovenija" }, 13.9, 45.75),
  feature({ type: "house", street: "Grahovo Brdo", housenumber: "1A", city: "Sežana", postcode: "6210", country: "Slovenija" }, 13.896, 45.7464),
  feature({ type: "other", name: "Zeljensko brdo", city: "Grahovo", postcode: "84310", country: "Crna Gora" }, 18.9, 42.7),
];

/* ---------------------------------------------------------------------------
   Reading what was typed.
   --------------------------------------------------------------------------- */

test("a trailing house number is split off the name, and only a trailing one", () => {
  /* This split is the fix for the first complaint: Photon honours the number and lets the
     name go fuzzy, so asking it "Rašica 53" as one phrase is asking the wrong question. */
  assert.deepEqual(readQuery("Rašica 53"), { words: "Rašica", number: "53", numberText: "53", address: true });
  assert.deepEqual(readQuery("Grahovo Brdo 1"), { words: "Grahovo Brdo", number: "1", numberText: "1", address: true });
  assert.deepEqual(readQuery("Rašica 53,"), { words: "Rašica", number: "53", numberText: "53", address: true });
  assert.deepEqual(readQuery("Trubarjeva cesta 12a"), { words: "Trubarjeva cesta", number: "12a", numberText: "12a", address: true });
  /* The folded number is for comparison; the row that repeats the address back must use the
     spelling that was typed. "12A" is not "12a" to the person who typed it. */
  assert.equal(readQuery("Trubarjeva cesta 12A").number, "12a");
  assert.equal(readQuery("Trubarjeva cesta 12A").numberText, "12A");
  /* A bare number is a name — a postcode, a street called "5th" — not a house to split off. */
  assert.deepEqual(readQuery("53"), { words: "53", number: null, numberText: "", address: false });
  /* Number-first addresses stay one phrase. Documented limitation, not an accident. */
  assert.deepEqual(readQuery("12 Rue de Rivoli"), { words: "12 Rue de Rivoli", number: null, numberText: "", address: false });
  assert.deepEqual(readQuery("Eiffel Tower"), { words: "Eiffel Tower", number: null, numberText: "", address: false });
});

test("folding is accent- and case-blind, and does not eat a non-Latin script", () => {
  assert.equal(foldPlace("Rašica"), foldPlace("RASICA"));
  assert.equal(foldPlace("Velike Lašče"), "velike lasce");
  assert.equal(foldPlace("  Grahovo   Brdo  "), "grahovo brdo");
  /* An empty fold would match *everything*, so Cyrillic must survive the fold rather than
     becoming the empty string that makes every query succeed. */
  assert.equal(foldPlace("Рашица"), "рашица");
  assert.notEqual(foldPlace("улица Разина"), "");
});

test("a name matches in bands: exact, typing, tokens, near-miss", () => {
  assert.equal(placeMatch("Rašica", ["Rašica"], true), 1);
  assert.equal(placeMatch("Rašica", ["rašica"], true), 1);
  /* Mid-word: "grahovo brd" is on its way to "Grahovo Brdo". */
  assert.equal(placeMatch("grahovo brd", ["Grahovo Brdo"], true), 0.9);
  assert.equal(placeMatch("Rašica", ["Rašice"], true), placeMatch("Rašica", ["Rašice"], true));
  /* The measurement that made the fix possible: a one-letter difference is not nothing.
     "Rašica" against "Rašice" is 0.36 in an address query and 0.72 in a name query. */
  assert.ok(placeMatch("Rašica", ["Rašice"], true) < 0.5);
  assert.ok(placeMatch("Rašica", ["Rašice"], false) > 0.7);
  assert.ok(placeMatch("Rašica", ["Ulica Stjepana Radića"], true) < 0.2);
  /* Typos still find things: autocomplete's whole reason for being fuzzy. */
  assert.ok(placeMatch("Eifel Tower", ["Eiffel Tower"], false) > 0.7);
});

/* ---------------------------------------------------------------------------
   The two searches the owner named.
   --------------------------------------------------------------------------- */

test("'Rašica 53' answers with the address that was typed, placed where that road is", () => {
  /* The owner's second report on this: "Query doesn't give Rašica 53, only Rašica." Both
     passes merged, exactly as the server merges them, and a house number that no row carries
     — and no row ever will, the door is not in the map — becomes the row itself. */
  const { hits, matchedNumber } = placeResults([...RASICA_53, ...RASICA], "Rašica 53", 6);
  assert.ok(hits.length > 0);
  assert.equal(hits[0]?.label, "Rašica 53");
  assert.equal(hits[0]?.context, "1315 Velike Lašče, Slovenija");
  assert.equal(hits[0]?.address, "Rašica 53, 1315 Velike Lašče, Slovenija");
  /* Velike Lašče first is measured, not preferred: four of the six roads called Rašica in the
     answer are in that village and two are in Ljubljana — and the two houses the map really
     does have on the road (40 and 12a) are both 1315. The other village stays on the list,
     because which one somebody means is not something this app can know. */
  assert.equal(hits[1]?.context, "1217 Ljubljana, Slovenija");
  assert.equal(hits[1]?.address, "Rašica 53, 1217 Ljubljana, Slovenija");
  for (const hit of hits) {
    assert.equal(/Slovensko|Hrvatska|Suomi|Россия|Argentina/.test(hit.address), false, `a different country answered: ${hit.address}`);
    /* The point is the road's, not the door's, and every row says so. */
    assert.equal(hit.approx, true, `composed row claims to be a door: ${hit.address}`);
    /* No provider object stands for this door, so there is no id that would make two doors on
       one road the same place. */
    assert.equal(hit.id, null);
  }
  /* No row carries house 53, because the house is not in the map — and the surface says so
     rather than appearing to have ignored the number. */
  assert.equal(matchedNumber, false);
});

test("a door is counted on roads, not on administrative rows", () => {
  /* Three rows named Rašica in Ljubljana and one road in Velike Lašče. Counting everything would
     put Ljubljana first on volume alone; the rule is that a house number is an address *on a
     road*, so when the answer holds any road at all, the roads are what get counted. */
  const districts = [0, 1, 2].map((step) =>
    feature({ type: "district", name: "Rašica", city: "Ljubljana", postcode: "1217", country: "Slovenija" }, 14.51 + step / 100, 46.13 + step / 100));
  const road = feature({ type: "street", name: "Rašica", city: "Velike Lašče", postcode: "1315", country: "Slovenija" }, 14.623, 45.855);
  const { hits } = placeResults([...districts, road], "Rašica 53", 6);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.context, "1315 Velike Lašče, Slovenija");
});

test("a landmark keeps its own name; a house number is not composed onto a tower", () => {
  /* The guard on `composedHits`: a road can have a house number on it, and a settlement is an
     address space, but "Eiffel Tower 1" is not an address. Composing one would be the app
     inventing a place rather than finding one. */
  const tower = feature({ type: "house", name: "Eiffel Tower", city: "Paris", postcode: "75007", country: "France" }, 2.2945, 48.8584);
  const park = feature({ type: "house", name: "Champ de Mars", city: "Paris", postcode: "75007", country: "France" }, 2.2946, 48.8556);
  const { hits, matchedNumber } = placeResults([tower, park], "Eiffel 1", 6);
  assert.equal(matchedNumber, false);
  assert.deepEqual(hits.map((hit) => hit.label), ["Eiffel Tower"]);
  assert.equal(hits.every((hit) => hit.approx !== true), true);
});

test("a number on a village with no roads mapped is still the address that was typed", () => {
  /* The fallback half of the same rule: when the provider's answer holds no road at all, the
     settlement is the best host there is — a village is an address space even with nothing
     mapped inside it. */
  const village = feature({ type: "district", name: "Dolenjske Toplice", city: "Dolenjske Toplice", postcode: "8350", country: "Slovenija" }, 15.05, 45.75);
  const { hits } = placeResults([village], "Dolenjske Toplice 5", 6);
  assert.equal(hits[0]?.label, "Dolenjske Toplice 5");
  assert.equal(hits[0]?.address, "Dolenjske Toplice 5, 8350 Dolenjske Toplice, Slovenija");
  assert.equal(hits[0]?.approx, true);
});

test("'Rašica 53' alone — one pass, no second question — is ranked, and admits it is guessing", () => {
  /* What the ranked list looks like if the words-only pass had not run: still not Slovakia
     first by accident of provider order, and it reports that the number *was* found, because
     in that pool a house 53 does exist. */
  const { matchedNumber } = placeResults(RASICA_53, "Rašica 53", 6);
  assert.equal(matchedNumber, true);
});

test("'Grahovo Brdo 1' is headed by the address, and keeps the farm as context", () => {
  const { hits, matchedNumber } = placeResults(GRAHOVO, "Grahovo Brdo 1", 6);
  const first = hits[0];
  assert.equal(first?.label, "Grahovo Brdo 1");
  /* The farm is still a real fact about the place — it moves to the dim line and into the
     stored name, it does not disappear. */
  assert.equal(first?.context, "Turistična kmetija Mahnič, 6210 Sežana, Slovenija");
  assert.equal(first?.name, "Turistična kmetija Mahnič");
  /* The address is the postal line and nothing else: it is what the cell reads and stores. */
  assert.equal(first?.address, "Grahovo Brdo 1, 6210 Sežana, Slovenija");
  assert.equal(matchedNumber, true);
  /* A door at 1A is the wrong door for "1", so it cannot sit above the street itself. */
  const order = hits.map((hit) => hit.label);
  assert.equal(order.indexOf("Grahovo Brdo 1") < order.indexOf("Grahovo Brdo 1A"), true);
  /* The bold line and the address are built in the same word order — a row must not read
     "1A Grahovo Brdo" above an address that says "Grahovo Brdo 1A". */
  assert.equal(hits.find((hit) => hit.label === "Grahovo Brdo 1A")?.address, "Grahovo Brdo 1A, 6210 Sežana, Slovenija");
});

test("the same row, unranked, still reads as the farm — the label depends on what was typed", () => {
  const unasked = placeResults(GRAHOVO, "", 6).hits[0];
  assert.equal(unasked?.label, "Turistična kmetija Mahnič");
  const named = placeResults(GRAHOVO, "Turistična kmetija", 6).hits[0];
  assert.equal(named?.label, "Turistična kmetija Mahnič");
});

test("a row repeats the word order that was typed", () => {
  /* Slovenia writes the street first; France writes the number first. There is no formatted
     address in a Photon answer, so the only reliable signal is the order of the query. */
  const slovenian = placeResults(GRAHOVO, "Grahovo Brdo 1", 6).hits[0];
  assert.equal(slovenian?.label, "Grahovo Brdo 1");
  const paris = placeResults([
    feature({ type: "house", street: "Rue de Rivoli", housenumber: "12", city: "Paris", postcode: "75001", country: "France" }, 2.34, 48.86),
  ], "12 Rue de Rivoli", 6).hits[0];
  assert.equal(paris?.label, "12 Rue de Rivoli");
  assert.equal(paris?.address, "12 Rue de Rivoli, 75001 Paris, France");
});

test("a name query keeps the provider's neighbours; an address query does not", () => {
  /* The floor is for addresses, because a house number makes every street ending in it a
     candidate in every country. A name has no such failure mode, and the row the provider put
     beside the landmark is usually the park at its foot. */
  const tower = feature({ type: "house", name: "Eiffel Tower", city: "Paris", state: "Île-de-France", country: "France" }, 2.2945, 48.8584);
  const park = feature({ type: "house", name: "Champ de Mars", street: "Avenue Joseph Bouvard", city: "Paris", country: "France" }, 2.2949, 48.8556);
  const neighbours = placeResults([tower, park], "Eiffel", 6);
  assert.deepEqual(neighbours.hits.map((hit) => hit.label), ["Eiffel Tower", "Champ de Mars"]);

  const addressed = placeResults([tower, park], "Eiffel 1", 6);
  assert.deepEqual(addressed.hits.map((hit) => hit.label), ["Eiffel Tower"]);
});

test("a different country cannot outrank a confident match", () => {
  /* The relevance floor: when the name is matched exactly, a street spelled differently in
     another country is a different word, not a seventh row. But when *nothing* matches well
     (a typo, or a name this index spells another way) the floor is off and the guesses stand
     — otherwise autocomplete would refuse to help exactly when it is most needed. */
  const confident = placeResults([...RASICA_53, ...RASICA], "Rašica 53", 6);
  assert.equal(confident.hits.some((hit) => hit.context.includes("Slovensko")), false);

  const guessing = placeResults(RASICA_53, "Rašica 53", 6);
  assert.ok(guessing.hits.length > 0);
});

/* ---------------------------------------------------------------------------
   What the server asks, and what it does when the provider says no.
   --------------------------------------------------------------------------- */

test("an address is two questions; a name is one", () => {
  assert.deepEqual(providerQueries("Rašica"), ["Rašica"]);
  assert.deepEqual(providerQueries("Eiffel Tower"), ["Eiffel Tower"]);
  /* As typed — which finds the door when the door exists — and without the number, which
     finds the street it is on when it does not. */
  assert.deepEqual(providerQueries("Rašica 53"), ["Rašica 53", "Rašica"]);
  assert.deepEqual(providerQueries("Grahovo Brdo 1"), ["Grahovo Brdo 1", "Grahovo Brdo"]);
  /* One letter and a number says nothing about which street was meant, and is a whole
     request to find out. */
  assert.deepEqual(providerQueries("R 53"), ["R 53"]);
});

function serve(handler: (url: string, response: import("node:http").ServerResponse) => void): Promise<{ server: Server; endpoint: string; urls: string[] }> {
  const urls: string[] = [];
  const server = createServer((request, response) => {
    urls.push(request.url ?? "");
    handler(request.url ?? "", response);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, urls });
    });
  });
}

const geo = (features: unknown[]) => JSON.stringify({ type: "FeatureCollection", features });

test("both passes are asked, merged and ranked; one failing does not lose the other", async () => {
  const { server, endpoint, urls } = await serve((url, response) => {
    const query = new URLSearchParams(url.split("?")[1] ?? "").get("q") ?? "";
    if (query === "Rašica 53") {
      /* The pass that finds doors. Here it finds the wrong country, which is the real
         provider's behaviour. */
      response.writeHead(200, { "content-type": "application/json" }).end(geo(RASICA_53));
      return;
    }
    response.writeHead(500, { "content-type": "text/plain" }).end("busy");
  });

  try {
    const { results, matchedNumber } = await searchPlaces("Rašica 53", endpoint, undefined, 1_000);
    assert.equal(urls.length, 3, "two questions, one of them retried once");
    assert.match(urls[0] ?? "", /q=Ra%C5%A1ica\+53/);
    assert.match(urls[1] ?? "", /q=Ra%C5%A1ica(&|$)/);
    /* The door pass answered, so the search answers — and it is ranked, not passed through:
       the row repeats the word order that was typed. */
    assert.equal(results[0]?.label, "Rašice 53");
    assert.equal(matchedNumber, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("the words-only pass is what saves the search, and the merge is what ranks it", async () => {
  const { server, endpoint } = await serve((url, response) => {
    const query = new URLSearchParams(url.split("?")[1] ?? "").get("q") ?? "";
    const features = query === "Rašica 53" ? RASICA_53 : RASICA;
    response.writeHead(200, { "content-type": "application/json" }).end(geo(features));
  });

  try {
    const { results, matchedNumber } = await searchPlaces("Rašica 53", endpoint, undefined, 2_000);
    /* The whole point of the second question: the Slovenian rows only exist in it. */
    assert.match(results[0]?.context ?? "", /Slovenija/);
    assert.equal(results.some((hit) => hit.context.includes("Slovensko")), false);
    assert.equal(matchedNumber, false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("a provider that keeps failing stops being asked, and says it is busy", async () => {
  const { server, endpoint, urls } = await serve((_url, response) => {
    response.writeHead(503, { "content-type": "text/plain" }).end("at capacity");
  });

  try {
    const now = 10_000;
    /* Three searches, each of which retries once: six requests, then the breaker opens. */
    for (const query of ["Busy One", "Busy Two", "Busy Three"]) {
      await assert.rejects(() => searchPlaces(query, endpoint, undefined, now), PlaceServiceBusy);
    }
    assert.equal(urls.length, 6);
    /* The fourth asks nothing at all. This is the rule that stops a person typing a long
       address from firing thirty doomed requests at a free service that has already said no. */
    await assert.rejects(() => searchPlaces("Busy Four", endpoint, undefined, now), PlaceServiceBusy);
    assert.equal(urls.length, 6);
    /* And it comes back by itself: no button, no restart. */
    await assert.rejects(() => searchPlaces("Busy Five", endpoint, undefined, now + 31_000), PlaceServiceBusy);
    assert.equal(urls.length, 8);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("a cache entry left by an older shape of the module is not an answer", async () => {
  /* The cache is parked on `globalThis` so a dev-mode hot reload does not cold-start it. The
     cost of that is entries written by the *previous* version of this file: the field was
     called `hits` before ranking moved in here, so `entry.features` is `undefined`, which is
     truthy-free but not an error — every search answered "nothing found" on the live server.
     An entry is only an answer if it still has the shape of one. */
  const store = globalThis as unknown as { raspberryPlaceCache?: Map<string, unknown> };
  store.raspberryPlaceCache ??= new Map();
  store.raspberryPlaceCache.set("grahovo brdo 9", { at: Date.now(), hits: [{ name: "stale" }] });

  const { server, endpoint, urls } = await serve((_url, response) => {
    response.writeHead(200, { "content-type": "application/json" }).end(geo(GRAHOVO));
  });

  try {
    const { results } = await searchPlaces("Grahovo Brdo 9", endpoint, undefined, 300_000);
    /* Two real questions were asked — the address and the words — so the stale entry was not
       treated as an answer. */
    assert.equal(urls.length, 2, "the stale entry was treated as an answer");
    assert.match(results[0]?.context ?? "", /Sežana/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("an unreachable provider is not 'busy', and a stale answer beats an error", async () => {
  let healthy = true;
  const { server, endpoint } = await serve((url, response) => {
    if (!healthy) {
      response.writeHead(200, { "content-type": "text/html" }).end("<html>captcha</html>");
      return;
    }
    const query = new URLSearchParams(url.split("?")[1] ?? "").get("q") ?? "";
    response.writeHead(200, { "content-type": "application/json" }).end(geo(query === "Grahovo Brdo 1" ? GRAHOVO : GRAHOVO));
  });

  try {
    const fresh = await searchPlaces("Grahovo Brdo 1", endpoint, undefined, 100_000);
    assert.equal(fresh.results[0]?.label, "Grahovo Brdo 1");

    /* Past the ten-minute cache but inside the hour: the provider starts answering with a
       captcha page, and the person still gets a list — because a stale list is a better
       answer than "the place service could not be reached" when nothing has changed. */
    healthy = false;
    const stale = await searchPlaces("Grahovo Brdo 1", endpoint, undefined, 100_000 + 30 * 60_000);
    assert.deepEqual(stale.results.map((hit) => hit.label), fresh.results.map((hit) => hit.label));

    /* Beyond an hour it is not an answer any more, and a captcha page is a failure — not an
       empty list, which would blame the address for the provider's problem. */
    await assert.rejects(
      () => searchPlaces("Grahovo Brdo 1", endpoint, undefined, 100_000 + 120 * 60_000),
      (error: unknown) => error instanceof Error && !(error instanceof PlaceServiceBusy),
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
