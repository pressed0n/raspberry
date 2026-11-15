import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { formatCell } from "../src/lib/database/properties";
import {
  placeAddress,
  placeCard,
  placeCoordinates,
  placeHit,
  placeHits,
  placeProperty,
  placeReading,
  placeValueOf,
} from "../src/lib/database/property-types/place";
import { PlaceServiceError, placesEndpoint, searchPlaces } from "../src/server/places";

/* The owner's ask: "whenever a user clicks on a cell a dropdown appears. The cell is now
   basically a search engine for addresses and locations ... the queries show immediately as
   a new letter hits the cell." And the constraint underneath it: "later we will add a map
   view for the database so this is an important part to build the right infrastructure".

   So this file tests the two halves that a screenshot cannot: what a place *is* once it is
   stored (the map view's input, and the reason a picked place carries a point), and how the
   provider's GeoJSON becomes a list of rows (the reason a search result is not a wall of
   comma-spliced text). The third half — the network — is tested against a fixture server on
   loopback, so no keystroke and no assertion ever leaves this machine. */

const place = (config: Record<string, unknown> = {}) => ({ type: "place" as const, config });
const render = (value: unknown, config: Record<string, unknown> = {}) => formatCell(place(config), value as never);

const feature = (properties: Record<string, unknown>, coordinates: unknown[] = [2.2945, 48.8584]) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates },
  properties,
});

const eiffel = feature({ name: "Eiffel Tower", city: "Paris", state: "Île-de-France", country: "France", osm_id: 5013364, osm_type: "W" });

test("a place reads as its address, whichever of the two shapes it is stored in", () => {
  /* Typed by hand: the value is the string, because there was nothing to attach to it. */
  assert.equal(render("12 Rue de Rivoli, Paris"), "12 Rue de Rivoli, Paris");
  /* Picked from a search: the value is a record, and the cell still reads one line. This is
     the assertion that stops a JSON blob appearing in a cell the first time somebody uses the
     new feature — `asText` would have stringified it. */
  assert.equal(render({ address: "Eiffel Tower, Paris, France", lat: 48.8584, lng: 2.2945 }), "Eiffel Tower, Paris, France");
  assert.equal(placeAddress({ address: "Eiffel Tower", lat: 48.8584, lng: 2.2945 }), "Eiffel Tower");
  assert.equal(render(null), "");
});

test("a typed address is stored as a string; a picked one is stored with its point", () => {
  /* The shape rule from the file header, and the reason today's bytes do not change: an
     object means "this place has a location". A record that carries no point is the same
     place as the string, and storing both spellings would make a filter and a map disagree. */
  assert.equal(placeProperty.coerce("  12 Rue de Rivoli, Paris  ", {}), "12 Rue de Rivoli, Paris");
  assert.equal(placeProperty.coerce({ address: "12 Rue de Rivoli, Paris" }, {}), "12 Rue de Rivoli, Paris");
  assert.equal(placeProperty.coerce("", {}), null);
  assert.equal(placeProperty.coerce({ address: "   " }, {}), null);
  assert.equal(placeProperty.coerce([], {}), null);

  const stored = placeProperty.coerce({ address: "Eiffel Tower", lat: 48.8584, lng: 2.2945, name: "Eiffel Tower" }, {});
  /* `name` equal to the address is not a second fact. */
  assert.deepEqual(stored, { address: "Eiffel Tower", lat: 48.8584, lng: 2.2945 });
});

test("a point that is not on Earth is dropped, not plotted", () => {
  /* 0,0 is in the Gulf of Guinea, and a map that draws an unparseable address there is
     lying confidently. Coordinates are range-checked on the way in and on the way out. */
  assert.equal(placeProperty.coerce({ address: "Nowhere", lat: 91, lng: 2 }, {}), "Nowhere");
  assert.equal(placeProperty.coerce({ address: "Nowhere", lat: 48.8, lng: 200 }, {}), "Nowhere");
  assert.deepEqual(placeProperty.coerce({ address: "Nowhere", lat: "48.8", lng: "2.29" }, {}), { address: "Nowhere", lat: 48.8, lng: 2.29 });
  assert.equal(placeCoordinates({ address: "Nowhere", lat: 48.8, lng: 200 }), null);
});

test("the map view's whole entry point: a point, or nothing", () => {
  assert.deepEqual(placeCoordinates({ address: "Eiffel Tower", lat: 48.8584, lng: 2.2945 }), { lat: 48.8584, lng: 2.2945 });
  /* A typed address is a row the map cannot plot, and it must say so rather than invent a
     location for it. */
  assert.equal(placeCoordinates("12 Rue de Rivoli, Paris"), null);
  assert.equal(placeCoordinates(null), null);
});

test("a search hit becomes a value, and re-reading that value changes nothing", () => {
  const hit = placeHit(eiffel);
  assert.ok(hit);
  const value = placeValueOf(hit);
  assert.deepEqual(value, {
    address: "Eiffel Tower, Paris, Île-de-France, France",
    /* The short label rides along beside the full address: it is what a map marker or a
       chip will have room for, and re-deriving it from the address later would be a guess. */
    name: "Eiffel Tower",
    lat: 48.8584,
    lng: 2.2945,
    id: "W:5013364",
  });
  /* Idempotent through the server's own coercion: what the cell commits is what the database
     keeps. A second pass that changed it would mean the row on screen and the row on disk
     disagree the moment a view re-read it. */
  assert.deepEqual(placeProperty.coerce(value, {}), value);
});

test("`[lng, lat]` is read that way round", () => {
  /* GeoJSON is longitude-first, and reading it the other way puts Paris at 2.29° north,
     somewhere in the Sahara. The numbers are chosen so a swap is unmistakable. */
  const hit = placeHit(eiffel);
  assert.ok(hit);
  assert.equal(hit.lat, 48.8584);
  assert.equal(hit.lng, 2.2945);
  /* The owner's own coordinate system, in the southern hemisphere, to prove it is not
     accidentally symmetric. */
  assert.equal(placeHit(feature({ name: "Sydney" }, [151.2093, -33.8688]))?.lat, -33.8688);
});

test("a row has a name and a context, and neither repeats the other", () => {
  const tower = placeHit(eiffel);
  assert.equal(tower?.name, "Eiffel Tower");
  assert.equal(tower?.context, "Paris, Île-de-France, France");

  /* Photon returns a city with the city as its own `name` — the naive join reads
     "Paris, Paris, France", which looks like a bug in the app rather than in the data. */
  const paris = placeHit(feature({ city: "Paris", state: "Paris", country: "France" }));
  assert.equal(paris?.name, "Paris");
  assert.equal(paris?.context, "France");

  /* A house with no name of its own: the street line is the name, and the city is the context. */
  const house = placeHit(feature({ housenumber: "221B", street: "Baker Street", city: "London", country: "United Kingdom" }));
  assert.equal(house?.name, "221B Baker Street");
  assert.equal(house?.context, "London, United Kingdom");

  /* A postcode belongs to its city, not on a line of its own. */
  const rivoli = placeHit(feature({ housenumber: "12", street: "Rue de Rivoli", postcode: "75001", city: "Paris", country: "France" }));
  assert.equal(rivoli?.name, "12 Rue de Rivoli");
  assert.equal(rivoli?.context, "75001 Paris, France");
  assert.equal(rivoli?.address, "12 Rue de Rivoli, 75001 Paris, France");
});

test("a feature that is not a place is not a row", () => {
  /* No coordinates at all: a map view could not plot it and a list cannot describe it. */
  assert.equal(placeHit({ type: "Feature", properties: { name: "Atlantis" } }), null);
  /* Coordinates that are not numbers, and coordinates that are not on Earth. */
  assert.equal(placeHit(feature({ name: "Atlantis" }, ["a", "b"])), null);
  assert.equal(placeHit(feature({ name: "Atlantis" }, [2.29, 91])), null);
  /* Nothing to call it: a row reading ", , France" is worse than one row fewer. */
  assert.equal(placeHit(feature({ country: "" })), null);
  /* And something that is not a feature at all — the endpoint answering with an error body. */
  assert.equal(placeHit({ error: "nope" }), null);
  assert.equal(placeHit(null), null);
});

test("the list is de-duplicated and capped", () => {
  /* Three rows for one tower, in the three ways OSM produces it: the same object twice, the
     same address formatted two ways, and the same place as a `way` and a `node` two metres
     apart. All three read as one row. */
  const twice = placeHits([
    eiffel,
    feature({ name: "Eiffel Tower", city: "Paris", state: "Île-de-France", country: "France", osm_id: 5013364, osm_type: "W" }, [2.2945, 48.8584]),
    feature({ name: "Eiffel Tower", city: "Paris", country: "France", osm_id: 5013364, osm_type: "W" }, [2.2945, 48.8584]),
    feature({ name: "Eiffel Tower", city: "Paris", country: "France", osm_id: 1, osm_type: "N" }, [2.29451, 48.85841]),
  ]);
  assert.equal(twice.length, 1);

  /* Two genuinely different places that happen to share a name are two rows: the key rounds
     the point to ~11m, and Lyon is further than that. */
  const namesakes = placeHits([
    feature({ name: "Springfield", city: "Illinois", country: "United States" }, [-89.6501, 39.7817]),
    feature({ name: "Springfield", city: "Missouri", country: "United States" }, [-93.2923, 37.2089]),
  ]);
  assert.equal(namesakes.length, 2);
  assert.equal(namesakes[0]?.context, "Illinois, United States");

  const many = placeHits(Array.from({ length: 9 }, (_, index) => feature({ name: `Place ${index}` })), 6);
  assert.equal(many.length, 6);
  assert.equal(placeHits(undefined).length, 0);
  assert.equal(placeHits("not features").length, 0);
});

test("a composition keeps its `approx` through the server; a door carries no flag at all", () => {
  /* A house number the map data does not have is answered by the address that was typed,
     placed on the road it would be on. The point is therefore the road's, not the door's, and
     the difference is *stored* rather than inferred: a coordinate's decimals say nothing about
     how precise the search was, and the map view is going to draw these two differently. */
  const composed = placeValueOf({
    id: null,
    label: "Rašica 53",
    name: "Rašica",
    context: "1315 Velike Lašče, Slovenija",
    address: "Rašica 53, 1315 Velike Lašče, Slovenija",
    lat: 45.855,
    lng: 14.623,
    approx: true,
  });
  assert.deepEqual(composed, {
    address: "Rašica 53, 1315 Velike Lašče, Slovenija",
    name: "Rašica",
    lat: 45.855,
    lng: 14.623,
    approx: true,
  });
  /* The server's own coercion sits on the path from the cell to the file. A `coerce` that
     dropped the flag would turn a road back into a doorstep on the way through, silently. */
  assert.deepEqual(placeProperty.coerce(composed, {}), composed);
  assert.equal(placeReading(composed).approximate, true);
  assert.deepEqual(placeCoordinates(composed), { lat: 45.855, lng: 14.623 });
  /* The cell reads the address either way — an approximation is still the address typed, and
     marking it inside the field would be this app editing what somebody wrote. */
  assert.equal(render(composed), "Rašica 53, 1315 Velike Lašče, Slovenija");

  /* A real door carries no flag at all, so a stored value only differs when there is something
     to say. */
  const door = placeProperty.coerce({ address: "Palmejeva ulica 28, 1000 Ljubljana, Slovenija", lat: 46.0819, lng: 14.5155 }, {});
  assert.equal(placeReading(door).approximate, false);
  assert.equal(placeReading("Rašica, Velike Lašče").approximate, false);
  assert.equal(placeReading(null).approximate, false);
  /* And nothing but `true` can make a value approximate — a stray string is not a flag. */
  assert.equal(placeReading(placeProperty.coerce({ address: "Paris", lat: 48.8, lng: 2.3, approx: "yes" }, {})).approximate, false);
});

test("a filter reads the address, not the record", () => {
  /* This was the bug the value widening would have caused silently: `fits` used to pass the
     *value* to `matchesText`, which stringifies a record — so "is Paris" stopped matching a
     picked place the moment places started being picked. */
  const picked = { address: "Paris", lat: 48.8566, lng: 2.3522 };
  assert.equal(placeProperty.fits("is", picked, "Paris", {}), true);
  assert.equal(placeProperty.fits("contains", picked, "par", {}), true);
  assert.equal(placeProperty.fits("is", picked, "Lyon", {}), false);
  assert.equal(placeProperty.fits("isEmpty", null, "", {}), true);
  assert.equal(placeProperty.fits("isNotEmpty", picked, "", {}), true);
});

test("the endpoint is Photon by default, and `off` means off", () => {
  const original = process.env.RASPBERRY_PLACES_URL;
  try {
    delete process.env.RASPBERRY_PLACES_URL;
    assert.match(String(placesEndpoint()), /^https:\/\/photon\.komoot\.io\//);
    /* Whitespace is not a URL, and an empty variable is not an instruction. */
    process.env.RASPBERRY_PLACES_URL = "   ";
    assert.match(String(placesEndpoint()), /^https:\/\//);
    for (const off of ["off", "OFF", " none ", "disabled"]) {
      process.env.RASPBERRY_PLACES_URL = off;
      assert.equal(placesEndpoint(), null, `"${off}" should switch the search off`);
    }
    process.env.RASPBERRY_PLACES_URL = "http://127.0.0.1:9/";
    assert.equal(placesEndpoint(), "http://127.0.0.1:9/");
  } finally {
    if (original === undefined) delete process.env.RASPBERRY_PLACES_URL;
    else process.env.RASPBERRY_PLACES_URL = original;
  }
});

test("searching: one identified request, an empty answer cached, a failure not", async () => {
  const seen: { url: string; agent: string }[] = [];
  let answer: "geojson" | "empty" | "html" = "geojson";
  const server = createServer((request, response) => {
    seen.push({ url: request.url ?? "", agent: String(request.headers["user-agent"] ?? "") });
    if (answer === "html") {
      response.writeHead(200, { "content-type": "text/html" }).end("<html>captcha</html>");
      return;
    }
    const features = answer === "geojson" ? [eiffel] : [];
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ type: "FeatureCollection", features }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

  try {
    const { results: hits } = await searchPlaces("Eiffel Tower", endpoint);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.label, "Eiffel Tower");
    /* The provider's policy asks for an identifiable client; a default fetch user-agent
       would have been a browser's. */
    assert.match(seen[0]?.agent ?? "", /Raspberry\//);
    assert.match(seen[0]?.url ?? "", /[?&]q=Eiffel(%20|\+)Tower/);
    assert.match(seen[0]?.url ?? "", /[?&]limit=\d+/);

    /* The same question again — with different case and spacing — is answered from the cache:
       one request, not two. This is the half of the rate-limit policy that matters most,
       because backspacing over a word and retyping it asks the same question four times. */
    await searchPlaces("  eiffel TOWER ", endpoint);
    assert.equal(seen.length, 1);

    /* A search that found nothing is a real answer and is cached as one. */
    answer = "empty";
    assert.equal((await searchPlaces("Nowhere at all", endpoint)).results.length, 0);
    assert.equal((await searchPlaces("Nowhere at all", endpoint)).results.length, 0);
    assert.equal(seen.length, 2);

    /* A 200 that is not GeoJSON is a failure, not an empty list: "no places match" would blame
       the address for the provider's captcha page. And a failure is never cached — the next
       keystroke is allowed to succeed. */
    answer = "html";
    await assert.rejects(() => searchPlaces("Somewhere", endpoint), PlaceServiceError);
    await assert.rejects(() => searchPlaces("Somewhere", endpoint), PlaceServiceError);
    assert.equal(seen.length, 4);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("an unreachable provider is a `PlaceServiceError`, not an empty list", async () => {
  /* Port 9 is the discard port: nothing answers. The caller must be able to tell this apart
     from "nothing found", because the person's next move is different. */
  await assert.rejects(() => searchPlaces("Paris", "http://127.0.0.1:9/"), PlaceServiceError);
});

test("the cell's control is a search box, not one more text field", () => {
  /* A source guard, in the spirit of `frame-anchor.test.ts`: the rules that make this column
     different from Text live in `place-cell.tsx`, and the three that matter are one import
     and two words. If a later turn "simplifies" this back into the shared field, the search
     silently becomes a plain text box and every probe here still passes. */
  const source = readFileSync("src/components/database/place-cell.tsx", "utf8");
  assert.match(source, /role="combobox"/);
  assert.match(source, /aria-autocomplete="list"/);
  /* `"listbox"` rather than the whole attribute: the surface is a `dialog` when it is a map. */
  assert.match(source, /"listbox"/);
  /* The surface must be the shared one. A fourth hand-rolled portalled dropdown is exactly
     what `docs/MAP.md` §4 exists to prevent. */
  assert.match(source, /<MenuSurface/);
  assert.equal(/\bcreatePortal\b/.test(source), false);
});

/* ---------------------------------------------------------------------------
   The card: when the surface is a map, and when it is a list.
   ---------------------------------------------------------------------------
   The owner's ask: "when I do select a location in notion, the dropdown gets overwritten by a
   map with a pin on my selected location". The rule that decides it is three conditions, and each
   one is a bug if it is missing — which is why it is a function in `place.ts` and not a flag in a
   component that only a browser can inspect.
   --------------------------------------------------------------------------- */
const selected = {
  address: "Eiffel Tower, Paris, Île-de-France, France",
  name: "Eiffel Tower",
  lat: 48.8584,
  lng: 2.2945,
  id: "W:5013364",
};

test("a place with a point opens as a map, in front of its own address", () => {
  const card = placeCard(selected, null, selected.address);
  assert.equal(card?.point.lat, 48.8584);
  assert.equal(card?.point.lng, 2.2945);
  assert.equal(card?.address, selected.address);
  assert.equal(card?.approximate, false);
});

test("a typed address has no map to draw", () => {
  /* The other stored shape, and the reason it stays a bare string: there is no point, so there is
     nothing to draw. A card here would be a map of the Gulf of Guinea. */
  const typed = "12 Rue de Rivoli, Paris";
  assert.equal(placeCard(typed, null, typed), null);
});

test("one keystroke turns the map back into a list", () => {
  assert.equal(placeCard(selected, null, "Eiffel To"), null);
  assert.equal(placeCard(selected, null, ""), null);
  assert.equal(placeCard(selected, null, ` ${selected.address} `)?.address, selected.address, "whitespace is not a question");
});

test("a pick whose write is still in flight draws the picked place, not the previous one", () => {
  /* The value the server has not echoed back yet is still the old one. Reading it for that frame
     would show the previous place's map and then swap — which reads as the app changing its mind. */
  const previous = { address: "Champ de Mars, Paris", lat: 48.8556, lng: 2.2949 };
  const justPicked = placeReading(selected);
  assert.equal(placeCard(previous, justPicked, selected.address)?.address, selected.address);
  /* And once the person types, the local pick stops standing in for the value. */
  assert.equal(placeCard(previous, justPicked, "Champ"), null);
});

test("a point that the draft no longer names is not a card", () => {
  assert.equal(placeCard(selected, null, "somewhere else entirely"), null);
});

test("a composed address is drawn as approximate, whichever shape it arrived in", () => {
  const composed = { address: "Rašica 53, 1315 Velike Lašče, Slovenija", lat: 45.855, lng: 14.623, approx: true as const };
  assert.equal(placeCard(composed, null, composed.address)?.approximate, true);
});

test("the card's map comes from our own route, and the browser never names a tile host", () => {
  /* The one claim no screenshot can make: `<img src="https://tile.openstreetmap.org/…">` and
     `<img src="/api/places/tile?…">` are the same pixels, and only one of them tells a stranger
     which address somebody just picked. */
  const card = readFileSync("src/components/database/place-cell.tsx", "utf8");
  assert.match(card, /role=\{card \? "dialog" : "listbox"\}/);
  assert.match(card, /<PlaceMap /);
  const map = readFileSync("src/components/database/place-map.tsx", "utf8");
  assert.match(map, /src=\{tileSrc\(/);
  assert.equal(/openstreetmap\.org\/(?:tile|\d)/.test(map), false, "the map component must not fetch tiles itself");
  assert.match(map, /© OpenStreetMap contributors/, "the licence requires the attribution");
  /* The way out is `mapLink(point)` — the function the geo tests pin — and not an inline URL. A
     template here is how `query=${label}` gets written, which hands Google the address to
     re-geocode and lets its pin land somewhere other than the one this card just drew. */
  assert.match(map, /href=\{mapLink\(point\)\}/);
  assert.equal(/google\.com/.test(map), false, "the Google URL is built in `mapLink`, not spelled here");
});
