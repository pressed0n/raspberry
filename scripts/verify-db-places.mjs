// The Place cell: a field that searches, a list that answers, and nothing lost when it cannot.
//
// Usage:
//   BASE=http://127.0.0.1:3108 PAGE=<page id> DB=<database id> PLACE=<property id> \
//     node scripts/verify-db-places.mjs [width] [height]
//   …or end to end on a disposable copy:  powershell -File scripts\run-places-probe.ps1
//
// WHY IT RUNS ITS OWN GEOCODER
// The feature is a network round trip, and a probe that called photon.komoot.io would be three
// bad things at once: non-deterministic, dependent on the internet being up, and a stream of
// keystrokes to somebody else's server on every run. Instead this file starts a fixture on
// loopback and the disposable instance is booted with `RASPBERRY_PLACES_URL` pointing at it, so
// every claim below is about *this app's* path — debounce, route, mapper, list, commit — and
// none of it is about a provider's ranking. The fixture also records what it was asked, which
// is how "the request came from the server and not from the browser" is measurable: it answers
// with the user-agent it saw, and a browser's is not ours.
//
// WHY IT WRITES
// "Picking a place stores its point" is a claim about what the server holds, and a cell that
// only painted a label would pass every DOM assertion here. So the pick is read back from
// `/api/databases`. Nothing is seeded but this run's own database, and the runner deletes it
// with the copy (docs/TESTING.md).
import { createServer } from "node:http";
import { openBrowser } from "./browser-session.mjs";

const width = Number(process.argv[2] ?? 1400);
const height = Number(process.argv[3] ?? 900);
const BASE = process.env.BASE ?? "http://127.0.0.1:3108";
const FIXTURE_PORT = Number(process.env.FIXTURE_PORT ?? 3117);
const pageId = process.env.PAGE;
const databaseId = process.env.DB;
const placeId = process.env.PLACE;
if (!pageId || !databaseId || !placeId) {
  throw new Error("PAGE=<page id> DB=<database id> PLACE=<place property id> are required — run scripts/seed-qa-places.mjs first");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* The two widths share one app process, and the server caches a query for ten minutes — so the
   second width must ask a question the first did not. Otherwise "five keystrokes are one
   request" measures the cache instead of the network, and reports 0 requests as a failure of
   the debounce. Both strings hit the same fixture branch, so every later assertion is identical. */
const typedQuery = width === 1400 ? "Eiffel" : "Eiffel Tower";

/* ---------------------------------------------------------------------------
   The fixture geocoder. Deterministic, on loopback, and it remembers every question.
   --------------------------------------------------------------------------- */
const asked = [];
const feature = (properties, coordinates) => ({ type: "Feature", geometry: { type: "Point", coordinates }, properties });

const EIFFEL = feature(
  { name: "Eiffel Tower", city: "Paris", state: "Île-de-France", country: "France", osm_id: 5013364, osm_type: "W" },
  [2.2945, 48.8584],
);
/* The same landmark recorded twice, the way OSM really returns it: a `way` and a `node` two
   metres apart, with the address formatted two different ways. The list must read as one row,
   and that is a claim about the mapper, not about the provider. */
const EIFFEL_AGAIN = feature(
  { name: "Eiffel Tower", city: "Paris", country: "France", osm_id: 1, osm_type: "N" },
  [2.29451, 48.85841],
);
const CHAMP = feature(
  { name: "Champ de Mars", street: "Avenue Joseph Bouvard", city: "Paris", country: "France", osm_id: 2, osm_type: "W" },
  [2.2949, 48.8556],
);

/* Recorded on 2026-11-01 from photon.komoot.io, then confirmed against OpenStreetMap itself
   with Overpass, because "the provider ranked it oddly" and "the address does not exist" are
   two very different problems and only one of them is ours to fix.

   `?q=Rašica 53` answered with ten streets ending in 53 in five countries and *not* with the
   Slovenian village — the top row was `53 Rašice` in Slovakia. In OSM, the street `Rašica` in
   Velike Lašče has exactly two mapped addresses, 40 and 12a: house 53 is not in the data, so
   no OSM geocoder can return it and the honest answer is the village.

   `?q=Grahovo Brdo 1` answered correctly and *displayed* wrongly: the node is tagged
   `name=Turistična kmetija Mahnič`, so the row was headed by the farm instead of the address. */
const RASICE_53 = feature(
  { type: "house", street: "Rašice", housenumber: "53", city: "Rašice", postcode: "982 62", country: "Slovensko", osm_id: 9001, osm_type: "W" },
  [19.9, 48.6],
);
const RASICA_VILLAGE = feature(
  { type: "district", name: "Rašica", city: "Velike Lašče", postcode: "1315", country: "Slovenija", osm_id: 9002, osm_type: "R" },
  [14.62, 45.85],
);
const RASICA_LJUBLJANA = feature(
  { type: "district", name: "Rašica", city: "Ljubljana", postcode: "1217", country: "Slovenija", osm_id: 9003, osm_type: "R" },
  [14.57, 46.09],
);
const MAHNIC = feature(
  { type: "house", name: "Turistična kmetija Mahnič", street: "Grahovo Brdo", housenumber: "1", city: "Sežana", postcode: "6210", country: "Slovenija", osm_id: 9004, osm_type: "N" },
  [13.8957, 45.7463],
);
const MAHNIC_1A = feature(
  { type: "house", street: "Grahovo Brdo", housenumber: "1A", city: "Sežana", postcode: "6210", country: "Slovenija", osm_id: 9005, osm_type: "N" },
  [13.896, 45.7464],
);

/* The roads called Rašica, as the words-only pass really answers them: four in Velike Lašče
   (1315 twice, 1314, 1311) and two in Ljubljana (1217 twice). They are what decides *where* a
   composed address is offered — a house number is an address **on a road**, so the roads are
   what gets counted, not the districts — and four against two is the whole reason `Rašica 53`
   comes back at 1315. Both houses the map really does have on that road (40 and 12a) are 1315
   as well, which is the check that the count is measuring something. */
const RASICA_ROADS = [
  feature({ type: "street", name: "Rašica", city: "Ljubljana", district: "Rašica", postcode: "1217", country: "Slovenija", osm_id: 9101, osm_type: "W" }, [14.506, 46.135]),
  feature({ type: "street", name: "Rašica", city: "Velike Lašče", district: "Rašica", postcode: "1315", country: "Slovenija", osm_id: 9102, osm_type: "W" }, [14.623, 45.855]),
  feature({ type: "street", name: "Rašica", city: "Velike Lašče", district: "Dolščaki", postcode: "1314", country: "Slovenija", osm_id: 9103, osm_type: "W" }, [14.603, 45.859]),
  feature({ type: "street", name: "Rašica", city: "Ljubljana", district: "Rašica", postcode: "1217", country: "Slovenija", osm_id: 9104, osm_type: "W" }, [14.508, 46.136]),
  feature({ type: "street", name: "Rašica", city: "Velike Lašče", district: "Rašica", postcode: "1311", country: "Slovenija", osm_id: 9105, osm_type: "W" }, [14.621, 45.856]),
  feature({ type: "street", name: "Rašica", city: "Velike Lašče", district: "Rašica", postcode: "1315", country: "Slovenija", osm_id: 9106, osm_type: "W" }, [14.622, 45.854]),
];

/** The provider's own folding, so the fixture answers "Rašica" however it is spelled. */
const fold = (text) => text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();

const fixture = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const q = url.searchParams.get("q") ?? "";
  asked.push({ q, agent: String(request.headers["user-agent"] ?? ""), limit: url.searchParams.get("limit") });
  const lower = fold(q);
  const features = lower.includes("eiffel")
    ? [EIFFEL, EIFFEL_AGAIN, CHAMP]
    : lower.includes("rivoli")
      ? [CHAMP]
      : lower.includes("rasica 53")
        /* The door pass, answering exactly as the real provider did: the wrong country, and
           with a house number that does match. */
        ? [RASICE_53]
        : lower.includes("rasica")
          /* The words-only pass. This is the answer the search was missing: the villages, and
             the six roads a house number could be on. */
          ? [RASICA_VILLAGE, RASICA_LJUBLJANA, ...RASICA_ROADS]
          : lower.includes("grahovo brdo")
            ? [MAHNIC, MAHNIC_1A]
            : [];
  response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ type: "FeatureCollection", features }));
});

await new Promise((resolve, reject) => {
  fixture.once("error", reject);
  fixture.listen(FIXTURE_PORT, "127.0.0.1", resolve);
});

/* The property and the cells as the server holds them. The only source a storage claim trusts. */
async function stored() {
  const response = await fetch(`${BASE}/api/databases/${databaseId}`, { headers: { origin: BASE } });
  if (!response.ok) throw new Error(`GET /api/databases/${databaseId} → ${response.status}`);
  const payload = await response.json();
  const database = payload.database ?? payload;
  const property = database.properties.find((candidate) => candidate.id === placeId);
  if (!property) throw new Error(`property ${placeId} is not in the payload`);
  const rows = Object.fromEntries(database.rows.map((row) => [row.title, row.cells?.[placeId] ?? null]));
  return { config: property.config ?? {}, rows };
}

const b = await openBrowser({ url: `${BASE}/#${pageId}`, width, height });

/** A row, found the way a person reads it — by the name in its title cell. */
const ROW = (title) => `[...document.querySelectorAll('tr[data-row-id]')].find((node) => {
  const name = node.querySelector('.db-name-cell input')?.value
    ?? node.querySelector('.db-name-cell .db-cell-text')?.textContent
    ?? '';
  return name.trim() === ${JSON.stringify(title)};
})`;

const CELL = (title) => `${ROW(title)}?.querySelector('td[data-property-id="${placeId}"]') ?? null`;

/** The cell's field, measured and described. `focused` is the claim that a press on this cell
 *  still puts a caret in it — the URL cell had to keep that, and this one must too. */
const fieldOf = (title) => b.evaluate(`(() => {
  const cell = ${CELL(title)};
  const field = cell?.querySelector('input');
  if (!field) return { missing: "field" };
  field.scrollIntoView({ block: "nearest", inline: "nearest" });
  const r = field.getBoundingClientRect();
  const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
  const hit = document.elementFromPoint(x, y);
  return {
    x, y,
    value: field.value,
    placeholder: field.placeholder,
    role: field.getAttribute("role"),
    expanded: field.getAttribute("aria-expanded"),
    controls: field.getAttribute("aria-controls"),
    focused: document.activeElement === field,
    reachable: !!hit && (hit === field || field.contains(hit)),
  };
})()`);

/** The last open surface, described by what a person could read off it. */
const surface = () => b.evaluate(`(() => {
  const all = [...document.querySelectorAll('[data-db-popover]')];
  const node = all[all.length - 1];
  if (!node) return null;
  const r = node.getBoundingClientRect();
  return {
    role: node.getAttribute("role"),
    id: node.id,
    left: Math.round(r.left), right: Math.round(r.right),
    top: Math.round(r.top), bottom: Math.round(r.bottom),
    width: Math.round(r.width),
    scroll: node.scrollHeight - node.clientHeight,
    inside: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
    rows: [...node.querySelectorAll(".db-place-row")].map((row) => ({
      name: row.querySelector(".db-place-name")?.textContent ?? "",
      context: row.querySelector(".db-place-context")?.textContent ?? "",
      selected: row.getAttribute("aria-selected") === "true",
      ticked: !!row.querySelector(".db-place-check"),
    })),
    use: node.querySelector(".db-place-use")?.textContent?.trim() ?? null,
    note: node.querySelector(".db-place-note")?.textContent?.trim() ?? null,
    /* The surface has two shapes since B52: a list of rows, and — for a cell that already holds a
       point — a card with a map in it. This probe is about the list, so it needs to be able to say
       which one it is looking at rather than reading a card as an empty list. */
    isCard: !!node.querySelector(".db-place-card"),
    card: node.querySelector(".db-place-card")
      ? { address: node.querySelector(".db-place-card-address")?.textContent ?? "" }
      : null,
  };
})()`);

/** Press the Nth row of the last open surface, at the row's own centre. */
const pickRow = (index) => b.evaluate(`(() => {
  const all = [...document.querySelectorAll('[data-db-popover]')];
  const node = all[all.length - 1];
  const row = node?.querySelectorAll('.db-place-row')[${index}];
  if (!row) return null;
  const r = row.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), name: row.querySelector('.db-place-name')?.textContent ?? '' };
})()`);

const anySurface = () => b.evaluate("!!document.querySelector('[data-db-popover]')");

async function press(title, what = `the ${title} cell`) {
  const field = await fieldOf(title);
  if (field.missing) throw new Error(`nothing to press for ${what}`);
  if (!field.reachable) throw new Error(`${what} is at ${field.x},${field.y} but something else is on top of it`);
  await b.mouse(field.x, field.y);
  await sleep(200);
  return field;
}

/** Read the surface until *the state named here* is on it.
 *
 *  This used to wait for "a `.db-place-note` exists", which the idle panel satisfies the instant
 *  it opens — so the probe read "Type a place or address" and reported it as the answer to a
 *  search that had not come back yet. A wait has to name the state it is waiting for, not the
 *  element the state happens to be drawn with. On a timeout the last surface is printed, so a
 *  failure says what was actually on screen. */
async function until(predicate, label, timeoutMs = 8000) {
  const steps = Math.ceil(timeoutMs / 200);
  let last = null;
  for (let i = 0; i < steps; i++) {
    last = await surface();
    if (last && predicate(last)) return last;
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${label}; last surface ${JSON.stringify(last)}`);
}

try {
  /* The block fetches its rows, so the table arrives a moment after the page. Every probe that
     skipped this line has reported the app broken at cold start at least once. */
  await b.waitFor("!!document.querySelector('.db-table tbody tr')", { label: "the table", timeoutMs: 25000 });
  b.check("the table is on screen", await b.evaluate(`!!document.querySelector('tr[data-row-id]')`), "no rows");

  /* §1 — what a place reads at rest. */
  const typed = await fieldOf("Typed");
  b.check(
    "a typed address reads as one line",
    typed.value === "12 Rue de Rivoli, Paris",
    `read ${JSON.stringify(typed.value)}`,
  );
  const picked = await fieldOf("Picked");
  b.check(
    "a picked place reads as its address, not as JSON",
    picked.value === "Eiffel Tower, Paris, Île-de-France, France",
    `read ${JSON.stringify(picked.value)}`,
  );
  b.check(
    "an empty cell says what it is for",
    (await fieldOf("Search")).placeholder === "Search a place…",
    `placeholder ${JSON.stringify((await fieldOf("Search")).placeholder)}`,
  );

  /* §2 — the press. The owner's ask, first clause: "whenever a user clicks on a cell a dropdown
     appears". It must appear *and* the caret must stay, or the search cannot be typed into. */
  await press("Search");
  const opened = await until((state) => state.note === "Type a place or address", "the idle surface");
  b.check("pressing a place cell opens a dropdown", opened !== null, "no surface");
  b.check(
    "and the caret is still in the cell, so the search can be typed",
    (await fieldOf("Search")).focused,
    `activeElement focused=${(await fieldOf("Search")).focused}`,
  );
  b.check(
    "the surface is the shared listbox, not a fourth hand-rolled menu",
    opened?.role === "listbox" && opened?.width === 252,
    `role ${opened?.role}, width ${opened?.width}`,
  );
  b.check(
    "the field points at the list it controls, and says it is open",
    (await fieldOf("Search")).controls === opened?.id && (await fieldOf("Search")).expanded === "true",
    `controls ${JSON.stringify((await fieldOf("Search")).controls)} vs id ${JSON.stringify(opened?.id)}, expanded ${JSON.stringify((await fieldOf("Search")).expanded)}`,
  );
  b.check(
    "an empty search says what to do instead of showing nothing",
    opened?.note === "Type a place or address",
    `note ${JSON.stringify(opened?.note)}`,
  );
  await b.shot(`place-idle-${width}`);

  /* §3 — the search. `b.type` sends one real key event per character, so this also tests the
     debounce: five keystrokes must be *one* request. */
  const before = asked.length;
  await b.type(typedQuery);
  const found = await until((state) => state.rows.length > 0, "the result list");
  const mine = asked.slice(before);
  b.check(
    "a word typed at speed is one request, not one per letter",
    mine.length === 1,
    `${mine.length} requests: ${JSON.stringify(mine.map((entry) => entry.q))}`,
  );
  b.check(
    "the query that reached the provider is the one that was typed, in full",
    mine[0]?.q === typedQuery && mine[0]?.limit !== null,
    `q ${JSON.stringify(mine[0]?.q)} (typed ${JSON.stringify(typedQuery)}), limit ${JSON.stringify(mine[0]?.limit)}`,
  );
  b.check(
    "the request came from the server, not from the browser",
    /^Raspberry\//.test(mine[0]?.agent ?? ""),
    `user-agent ${JSON.stringify(mine[0]?.agent)}`,
  );
  b.check(
    "a row reads as a name over the place it is in",
    found?.rows[0]?.name === "Eiffel Tower" && found?.rows[0]?.context === "Paris, Île-de-France, France",
    `first row ${JSON.stringify(found?.rows[0])}`,
  );
  b.check(
    "the same landmark returned twice is one row",
    found?.rows.length === 2,
    `${found?.rows.length} rows: ${JSON.stringify(found?.rows.map((row) => row.name))}`,
  );
  b.check(
    "and the escape hatch is offered beside the results, because nothing is lost without it",
    (found?.use ?? "").includes("Eiffel"),
    `use row ${JSON.stringify(found?.use)}`,
  );
  b.check(
    "no row is ticked, because this cell holds nothing",
    found?.rows.every((row) => row.ticked === false),
    `ticks ${JSON.stringify(found?.rows.map((row) => row.ticked))}`,
  );
  b.check(
    "the list fits its own surface without scrolling",
    found?.scroll === 0 && found?.inside === true,
    `scroll ${found?.scroll}, inside ${found?.inside}, rect ${found?.left}..${found?.right} x ${found?.top}..${found?.bottom}`,
  );
  /* Photographed with the list open, because the thing being built here is a surface and a
     row layout, and every assertion above would pass just as happily on an ugly one. */
  await b.shot(`place-list-${width}`);

  /* §4 — the keyboard. A combobox keeps the focus in its field and moves a *highlight*, so the
     arrows must walk the list and not the table. */
  await b.key("ArrowDown", { keyCode: 40 });
  await sleep(120);
  const second = await surface();
  b.check(
    "ArrowDown moves the highlight down the list, not down the table",
    second?.rows[1]?.selected === true && second?.rows[0]?.selected === false,
    `selected ${JSON.stringify(second?.rows.map((row) => row.selected))}`,
  );
  await b.key("ArrowUp", { keyCode: 38 });
  await sleep(120);
  b.check(
    "ArrowUp comes back",
    (await surface())?.rows[0]?.selected === true,
    `selected ${JSON.stringify((await surface())?.rows.map((row) => row.selected))}`,
  );

  await b.key("Enter", { keyCode: 13 });
  for (let i = 0; i < 20; i++) {
    await sleep(150);
    if ((await stored()).rows.Search !== null) break;
  }
  const committed = (await stored()).rows.Search;
  b.check(
    "Enter takes the highlighted row and stores it with its point",
    committed?.address === "Eiffel Tower, Paris, Île-de-France, France"
      && committed?.lat === 48.8584
      && committed?.lng === 2.2945
      && committed?.id === "W:5013364",
    `stored ${JSON.stringify(committed)}`,
  );
  b.check(
    "the point is stored lat/lng, not GeoJSON's lng/lat",
    committed?.lat === 48.8584 && Math.abs(committed.lng - 2.2945) < 0.0001,
    `lat ${committed?.lat}, lng ${committed?.lng}`,
  );
  for (let i = 0; i < 15; i++) {
    if ((await fieldOf("Search")).value === "Eiffel Tower, Paris, Île-de-France, France") break;
    await sleep(100);
  }
  b.check(
    "and the cell reads the address it was given",
    (await fieldOf("Search")).value === "Eiffel Tower, Paris, Île-de-France, France",
    `read ${JSON.stringify((await fieldOf("Search")).value)}`,
  );
  b.check(
    "picking a place replaces the list with the card that maps it",
    (await surface())?.role === "dialog" && (await surface())?.card?.address === "Eiffel Tower, Paris, Île-de-France, France",
    `surface ${JSON.stringify((await surface())?.role)}, address ${JSON.stringify((await surface())?.card?.address)}`,
  );

  /* §5 — reopening a cell that holds a point. The caret never left this field, so this press
     changes no focus: it is the check that "a press opens the surface" is a press and not a focus
     event, which is the difference between a cell you can reopen and one you cannot.
     Since B52 the reopened surface is the *card* — a map of the stored point — and it costs no
     request at all, because a point is not a question. */
  const askedBeforeReopen = asked.length;
  await press("Search");
  const again = await b.waitFor("!!document.querySelector('.db-place-card')", { label: "the card for a stored place", timeoutMs: 8000 })
    .then(() => surface())
    .catch(() => null);
  b.check(
    "reopening a stored place shows its map, not a list of guesses",
    again?.role === "dialog" && again?.card?.address === "Eiffel Tower, Paris, Île-de-France, France",
    `role ${JSON.stringify(again?.role)}, address ${JSON.stringify(again?.card?.address)}`,
  );
  b.check(
    "and it asks the provider nothing to draw it",
    asked.length === askedBeforeReopen,
    `${asked.length - askedBeforeReopen} questions: ${JSON.stringify(asked.slice(askedBeforeReopen).map((entry) => entry.q))}`,
  );
  await b.key("Escape", { keyCode: 27 });
  await sleep(150);

  /* §5b — the tick in the list still exists, it has just moved to the cells it can happen in: a
     cell that holds a *typed* address shows the list, and any row whose address is that text is
     the row this cell already holds. */
  await press("Typed");
  const listed = await until((state) => state.rows.length > 0 || state.note !== null, "the list under a typed address");
  b.check(
    "a typed address opens the list, not a card — there is no point to draw",
    listed?.isCard === false && listed?.role === "listbox",
    `card ${listed?.isCard}, role ${JSON.stringify(listed?.role)}`,
  );
  await b.key("Escape", { keyCode: 27 });
  await sleep(150);

  /* §6 — Escape is a two-step, and neither step loses the value. */
  await press("Typed");
  await b.type("zzz");
  await sleep(320);
  await b.key("Escape", { keyCode: 27 });
  await sleep(200);
  b.check(
    "the first Escape dismisses the list and leaves the caret where it was",
    (await anySurface()) === false && (await fieldOf("Typed")).focused === true,
    `surface ${await anySurface()}, focused ${(await fieldOf("Typed")).focused}`,
  );
  await b.key("Escape", { keyCode: 27 });
  await sleep(250);
  b.check(
    "the second Escape gives the cell back its value, and writes nothing",
    (await fieldOf("Typed")).value === "12 Rue de Rivoli, Paris"
      && (await stored()).rows.Typed === "12 Rue de Rivoli, Paris",
    `field ${JSON.stringify((await fieldOf("Typed")).value)}, stored ${JSON.stringify((await stored()).rows.Typed)}`,
  );
  b.check("and the caret has left the cell", (await fieldOf("Typed")).focused === false, "still focused");

  /* §7 — "nothing found" is about the world, and the typed text is still storable. */
  await press("Spare");
  await b.type("Nowhere at all");
  const empty = await until((state) => (state.note ?? "").startsWith("Nothing found"), "the nothing-found surface");
  b.check(
    "a search that finds nothing names the query it searched for",
    empty?.note === "Nothing found for “Nowhere at all”",
    `note ${JSON.stringify(empty?.note)}`,
  );
  b.check("with no rows to choose", (empty?.rows.length ?? 0) === 0, `${empty?.rows.length} rows`);
  await b.key("Enter", { keyCode: 13 });
  for (let i = 0; i < 20; i++) {
    await sleep(150);
    if ((await stored()).rows.Spare !== null) break;
  }
  b.check(
    "Enter on a search that found nothing stores what was typed, as a string",
    (await stored()).rows.Spare === "Nowhere at all",
    `stored ${JSON.stringify((await stored()).rows.Spare)}`,
  );

  /* §7b — the owner's own two searches, through the real route and the real list.
     "Querrying 'Rašica 53' — on Notion the first result is 'Rašica 53, 1315 Velike Lašče,
     Slovenia'; on Raspberry the first result is '53 Rašice' in Slovakia."
     The unit tests prove the ranking against the recorded rows; this proves the path a person
     actually uses — two provider questions, the merge, the label, and the note. */
  await press("Village");
  const passBefore = asked.length;
  await b.type("Rašica 53");
  const ranked = await until((state) => state.rows.length > 0 && (state.note ?? "") !== "Searching…", "the ranked surface");

  /* The two-pass claim is only measurable on the first width: both widths share one app
     process and the server caches a question for ten minutes, so the second width is answered
     from that cache. Both are real paths and both are asserted — but the request count is only
     a fact the first time. */
  if (width === 1400) {
    const askedNow = asked.slice(passBefore).map((entry) => fold(entry.q));
    b.check(
      "an address is asked as typed and again without the house number",
      askedNow.includes("rasica 53") && askedNow.includes("rasica"),
      `asked ${JSON.stringify(askedNow)}`,
    );
  } else {
    b.check("the second width is answered from the server's cache, and still ranked", ranked.rows.length > 0, `${ranked.rows.length} rows`);
  }

  b.check(
    "the house number is kept: the first row is the address that was typed",
    ranked.rows[0]?.name === "Rašica 53",
    `first row ${JSON.stringify(ranked.rows[0])}`,
  );
  /* Velike Lašče first is measured, not preferred. Four of the six roads called Rašica in the
     answer are in that village and two are in Ljubljana; the two houses the map really does
     have on that road — 40 and 12a — are both 1315. */
  b.check(
    "and it is placed in the village most of those roads are in",
    ranked.rows[0]?.context === "1315 Velike Lašče, Slovenija",
    `context ${JSON.stringify(ranked.rows[0]?.context)}`,
  );
  /* The other village stays on the list. Which one somebody means is not knowable from here, so
     the app offers both rather than picking silently and being wrong half the time. */
  b.check(
    "the other village is on the list too, rather than silently dropped",
    ranked.rows[1]?.name === "Rašica 53" && ranked.rows[1]?.context === "1217 Ljubljana, Slovenija",
    `second row ${JSON.stringify(ranked.rows[1])}`,
  );
  b.check(
    "and no row is headed by the street in another country",
    ranked.rows.every((row) => !/Slovensko/.test(`${row.name} ${row.context}`)),
    `rows ${JSON.stringify(ranked.rows.map((row) => row.name))}`,
  );
  /* The house is not in the map. Saying so is the difference between "this app ignores my
     number" and "this number is not mapped" — a fact about the data, not about the search. */
  b.check(
    "the list admits that the house number is not in the map, and where the point came from",
    ranked.note === "No house 53 in the map data — it is placed on the road, not the door",
    `note ${JSON.stringify(ranked.note)}`,
  );
  await b.shot(`place-ranked-${width}`);

  /* §7c — the claim the owner actually made, taken all the way to storage. A surface can paint
     the right label and store nothing; the value is read back from the server. */
  const target = await pickRow(0);
  b.check("the composed row is pressable", target !== null && target.name === "Rašica 53", `row ${JSON.stringify(target)}`);
  if (target) await b.mouse(target.x, target.y);
  let composedStored = await stored();
  for (let i = 0; i < 40 && composedStored.rows.Village?.approx !== true; i++) {
    await sleep(150);
    composedStored = await stored();
  }
  const village = composedStored.rows.Village;
  b.check(
    "picking it stores the address that was typed, with a point",
    village?.address === "Rašica 53, 1315 Velike Lašče, Slovenija"
      && typeof village?.lat === "number" && typeof village?.lng === "number",
    `stored ${JSON.stringify(village)}`,
  );
  /* And the value says the point is the road's. A map that drew this the same way as a real
     door would be claiming a precision the map data does not have. */
  b.check(
    "and the stored value says the point is the road's, not the door's",
    village?.approx === true,
    `stored ${JSON.stringify(village)}`,
  );
  /* What the cell reads afterwards is the same address, because an approximation is still the
     address that was typed. */
  const settled = await fieldOf("Village");
  b.check(
    "the cell then reads the address, and the list has been replaced by the card",
    settled.value === "Rašica 53, 1315 Velike Lašče, Slovenija" && (await surface())?.isCard === true,
    `cell ${JSON.stringify(settled.value)}, card ${(await surface())?.isCard}`,
  );
  await b.key("Escape", { keyCode: 27 });
  await sleep(150);

  await press("Address");
  await b.type("Grahovo Brdo 1");
  const address = await until((state) => state.rows.length > 0 && (state.note ?? "") !== "Searching…", "the address surface");
  b.check(
    "an address-shaped search is headed by the address, not by the name of the thing at it",
    address.rows[0]?.name === "Grahovo Brdo 1",
    `first row ${JSON.stringify(address.rows[0])}`,
  );
  b.check(
    "and the farm's name moves to the dim line instead of disappearing",
    address.rows[0]?.context === "Turistična kmetija Mahnič, 6210 Sežana, Slovenija",
    `context ${JSON.stringify(address.rows[0]?.context)}`,
  );
  b.check(
    "a door that was found is not reported as missing",
    address.note === null,
    `note ${JSON.stringify(address.note)}`,
  );
  b.check(
    "a door at 1A cannot outrank the door at 1",
    (address.rows.findIndex((row) => row.name === "Grahovo Brdo 1A") > 0)
      || address.rows.findIndex((row) => row.name === "Grahovo Brdo 1A") === -1,
    `rows ${JSON.stringify(address.rows.map((row) => row.name))}`,
  );
  await b.key("Escape", { keyCode: 27 });
  await sleep(150);
  await b.key("Escape", { keyCode: 27 });
  await sleep(200);

  /* §8 — the provider is down. This is the state the whole design exists for: the column was
     freeform text before it was a search box, and it has to keep being able to hold an address
     when there is no network. The fixture is *this* process's, so stopping it is exact. */
  await new Promise((resolve) => fixture.close(resolve));
  await press("Offline");
  await b.type("Rivoli");
  const down = await until((state) => state.note === "The place service could not be reached", "the failed surface");
  b.check(
    "an unreachable provider says so, and does not blame the address",
    down?.note === "The place service could not be reached",
    `note ${JSON.stringify(down?.note)}`,
  );
  b.check(
    "and the typed address can still be stored",
    (down?.use ?? "").includes("Rivoli"),
    `use row ${JSON.stringify(down?.use)}`,
  );
  await b.key("Enter", { keyCode: 13 });
  for (let i = 0; i < 30; i++) {
    await sleep(150);
    if ((await stored()).rows.Offline !== null) break;
  }
  b.check(
    "which is what Enter does when the list has nothing to pick",
    (await stored()).rows.Offline === "Rivoli",
    `stored ${JSON.stringify((await stored()).rows.Offline)}`,
  );

  /* §9 — the gesture the owner complained about two turns ago, in this new field: a press
     inside a cell must never leave the page. */
  const before_hash = await b.evaluate("location.hash");
  const box = await fieldOf("Offline");
  await b.doubleMouse(box.x, box.y);
  await sleep(300);
  b.check(
    "a double press in a place cell does not open its row's page",
    (await b.evaluate("location.hash")) === before_hash && (await b.evaluate(`!!document.querySelector('tr[data-row-id]')`)),
    `hash ${await b.evaluate("location.hash")} (was ${before_hash})`,
  );
  await b.key("Escape", { keyCode: 27 });
  await sleep(150);
  await b.key("Escape", { keyCode: 27 });
  await sleep(200);

  await b.shot(`place-${width}`);
  b.check(
    "the probe wrote nothing outside the disposable instance's own database",
    (await b.blockedWrites()).length === 0 || !b.guarded,
    `blocked ${JSON.stringify(await b.blockedWrites())}`,
  );
} catch (error) {
  /* A probe that catches its own exception and then reports the score prints OK for a run that
     died at step one. Recorded as a failure, by name (docs/TESTING.md). */
  b.check("the probe itself ran to the end without throwing", false, String(error?.stack ?? error));
} finally {
  await new Promise((resolve) => (fixture.listening ? fixture.close(resolve) : resolve()));
  await b.report();
}
