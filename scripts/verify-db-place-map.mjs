// The picked-place card: a Place cell whose dropdown becomes a map of what was chosen.
//
// Usage:
//   BASE=http://127.0.0.1:3109 PAGE=<page id> DB=<database id> PLACE=<property id> \
//     node scripts/verify-db-place-map.mjs [width] [height]
//   …or end to end on a disposable copy:  powershell -File scripts\run-place-map-probe.ps1
//
// WHY IT RUNS ITS OWN GEOCODER *AND* ITS OWN TILE SERVER
// The card is two network-shaped things at once — a search that answers with a coordinate, and
// four images that are supposed to come from *our* route. A probe pointed at the real tile
// server would be slower, non-deterministic, and would send the owner's chosen addresses to a
// stranger on every run; worse, it could not tell "the map drew" from "the map drew from
// somebody else's host", which is the one thing about this feature that is not visible on
// screen. So both ends are fixtures on loopback (ports 3118 and 3119), and the tile fixture
// encodes each square's own `z/x/y` into its pixels — which turns "the tiles are in the right
// places" into a measurement instead of a diagram.
//
// WHY IT WRITES
// "Picking a place stores its point" is a claim about what the server holds, and a card that
// only painted a map would pass every DOM assertion here. So every pick is read back from
// `/api/databases`. Nothing is seeded but this run's own database, and the runner deletes it
// with the copy (docs/TESTING.md).
import { createServer } from "node:http";
import { deflateSync } from "node:zlib";
import { openBrowser } from "./browser-session.mjs";

const width = Number(process.argv[2] ?? 1400);
const height = Number(process.argv[3] ?? 900);
const BASE = process.env.BASE ?? "http://127.0.0.1:3109";
const FIXTURE_PORT = Number(process.env.FIXTURE_PORT ?? 3118);
const TILE_PORT = Number(process.env.TILE_PORT ?? 3119);
const pageId = process.env.PAGE;
const databaseId = process.env.DB;
const placeId = process.env.PLACE;
if (!pageId || !databaseId || !placeId) {
  throw new Error("PAGE=<page id> DB=<database id> PLACE=<place property id> are required — run scripts/seed-qa-places.mjs first");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------------------------------------------------------------------------
   The fixture geocoder. Deterministic, on loopback, and it remembers every question.
   A subset of `verify-db-places.mjs`'s fixture: two rows for "Eiffel", one for "Riv…", and the
   Rašica set, because the card needs one picked door, one place that is *not* the first answer,
   and one composed address whose point is a road.
   --------------------------------------------------------------------------- */
const asked = [];
const feature = (properties, coordinates) => ({ type: "Feature", geometry: { type: "Point", coordinates }, properties });
const EIFFEL = feature(
  { name: "Eiffel Tower", city: "Paris", state: "Île-de-France", country: "France", osm_id: 5013364, osm_type: "W" },
  [2.2945, 48.8584],
);
const CHAMP = feature(
  { name: "Champ de Mars", street: "Avenue Joseph Bouvard", city: "Paris", country: "France", osm_id: 2, osm_type: "W" },
  [2.2949, 48.8556],
);
const TOWER_POINT = { lat: 48.8584, lng: 2.2945 };

const RASICA_VILLAGE = feature(
  { type: "district", name: "Rašica", city: "Velike Lašče", postcode: "1315", country: "Slovenija", osm_id: 9002, osm_type: "R" },
  [14.62, 45.85],
);
const RASICA_ROADS = [
  feature({ type: "street", name: "Rašica", city: "Velike Lašče", district: "Rašica", postcode: "1315", country: "Slovenija", osm_id: 9102, osm_type: "W" }, [14.623, 45.855]),
  feature({ type: "street", name: "Rašica", city: "Velike Lašče", district: "Dolščaki", postcode: "1314", country: "Slovenija", osm_id: 9103, osm_type: "W" }, [14.603, 45.859]),
  feature({ type: "street", name: "Rašica", city: "Ljubljana", district: "Rašica", postcode: "1217", country: "Slovenija", osm_id: 9103, osm_type: "W" }, [14.506, 46.135]),
];
const fold = (text) => text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();

const geocoder = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const q = url.searchParams.get("q") ?? "";
  asked.push({ q, agent: String(request.headers["user-agent"] ?? "") });
  const lower = fold(q);
  const features = lower.includes("eiffel")
    ? [EIFFEL, CHAMP]
    : lower.includes("riv")
      ? [CHAMP]
      : lower.includes("rasica 53")
        ? []
        : lower.includes("rasica")
          ? [RASICA_VILLAGE, ...RASICA_ROADS]
          : [];
  response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ type: "FeatureCollection", features }));
});
await new Promise((resolve, reject) => {
  geocoder.once("error", reject);
  geocoder.listen(FIXTURE_PORT, "127.0.0.1", resolve);
});

/* ---------------------------------------------------------------------------
   The fixture tile server.
   Each square is a solid colour whose red channel is its column and whose green channel is its
   row, in steps of 8 (`R = 8 + 8·(x mod 30)`), so a screenshot can name the tile it landed on
   without a palette table and with room for a channel being off by one or two.
   --------------------------------------------------------------------------- */
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};
function solidPng(size, [r, g, b]) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const at = row + 1 + x * 3;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const swatch = (x, y) => [8 + 8 * (((x % 30) + 30) % 30), 8 + 8 * (((y % 30) + 30) % 30), 40];
const decodeSwatch = (pixel) => ({
  x: Math.round((pixel.r - 8) / 8),
  y: Math.round((pixel.g - 8) / 8),
  exact: Math.abs((pixel.r - 8) / 8 - Math.round((pixel.r - 8) / 8)) < 0.4
    && Math.abs((pixel.g - 8) / 8 - Math.round((pixel.g - 8) / 8)) < 0.4,
});

const tilesServed = [];
const tileServer = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const match = /^\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(url.pathname);
  if (!match) {
    response.writeHead(404).end("not a tile");
    return;
  }
  const z = Number(match[1]);
  const x = Number(match[2]);
  const y = Number(match[3]);
  tilesServed.push({ z, x, y, agent: String(request.headers["user-agent"] ?? "") });
  response.writeHead(200, { "content-type": "image/png" }).end(solidPng(256, swatch(x, y)));
});
await new Promise((resolve, reject) => {
  tileServer.once("error", reject);
  tileServer.listen(TILE_PORT, "127.0.0.1", resolve);
});

/* ---------------------------------------------------------------------------
   Reading the app
   --------------------------------------------------------------------------- */
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

const ROW = (title) => `[...document.querySelectorAll('tr[data-row-id]')].find((node) => {
  const name = node.querySelector('.db-name-cell input')?.value
    ?? node.querySelector('.db-name-cell .db-cell-text')?.textContent
    ?? '';
  return name.trim() === ${JSON.stringify(title)};
})`;

const CELL = (title) => `${ROW(title)}?.querySelector('td[data-property-id="${placeId}"]') ?? null`;

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
    expanded: field.getAttribute("aria-expanded"),
    controls: field.getAttribute("aria-controls"),
    focused: document.activeElement === field,
    reachable: !!hit && (hit === field || field.contains(hit)),
  };
})()`);

/** The last open surface, described by what a person could read off it — list or card. */
const surface = () => b.evaluate(`(() => {
  const all = [...document.querySelectorAll('[data-db-popover]')];
  const node = all[all.length - 1];
  if (!node) return null;
  const r = node.getBoundingClientRect();
  const card = node.querySelector('.db-place-card');
  const box = card?.querySelector('[data-db-place-map]');
  const boxRect = box?.getBoundingClientRect();
  const pin = card?.querySelector('.db-place-pin');
  const pinRect = pin?.getBoundingClientRect();
  const round = (value) => Math.round(value * 100) / 100;
  return {
    role: node.getAttribute("role"),
    id: node.id,
    left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom),
    width: Math.round(r.width),
    inside: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
    scroll: node.scrollHeight - node.clientHeight,
    isCard: !!card,
    card: card ? {
      address: card.querySelector('.db-place-card-address')?.textContent ?? "",
      addressTitle: card.querySelector('.db-place-card-address')?.getAttribute('title') ?? null,
      meta: [...card.querySelectorAll('.db-place-card-meta')].map((meta) => meta.textContent.trim()),
      hasClear: !!card.querySelector('.db-place-card-clear'),
      map: boxRect ? {
        left: round(boxRect.left), top: round(boxRect.top),
        width: Math.round(boxRect.width), height: Math.round(boxRect.height),
      } : null,
      pin: pinRect ? {
        cx: round(pinRect.left + pinRect.width / 2), cy: round(pinRect.top + pinRect.height / 2),
        width: Math.round(pinRect.width), approx: pin.hasAttribute('data-approx'),
        background: getComputedStyle(pin).backgroundColor,
      } : null,
      tiles: [...card.querySelectorAll('.db-place-tile')].map((img) => {
        const rect = img.getBoundingClientRect();
        return {
          src: img.getAttribute('src'),
          left: Math.round(rect.left), top: Math.round(rect.top),
          width: Math.round(rect.width), height: Math.round(rect.height),
          styleLeft: img.style.left, styleTop: img.style.top,
          painted: img.complete && img.naturalWidth === 256,
        };
      }),
      credit: (() => {
        const link = card.querySelector('.db-place-credit');
        return link ? { text: link.textContent.trim(), href: link.getAttribute('href'), hidden: link.hidden } : null;
      })(),
      open: (() => {
        const link = card.querySelector('.db-place-map-open');
        return link ? { href: link.getAttribute('href'), target: link.getAttribute('target'), label: link.getAttribute('aria-label') } : null;
      })(),
      blankNote: card.querySelector('.db-place-map-note')?.textContent?.trim() ?? null,
    } : null,
    rows: [...node.querySelectorAll(".db-place-row")].map((row) => ({
      name: row.querySelector(".db-place-name")?.textContent ?? "",
      context: row.querySelector(".db-place-context")?.textContent ?? "",
      selected: row.getAttribute("aria-selected") === "true",
      ticked: !!row.querySelector(".db-place-check"),
    })),
    use: node.querySelector(".db-place-use")?.textContent?.trim() ?? null,
    note: node.querySelector(".db-place-note")?.textContent?.trim() ?? null,
  };
})()`);

const anySurface = () => b.evaluate("!!document.querySelector('[data-db-popover]')");

/** Press the Nth row of the last open surface, at the row's own centre. */
const rowAt = (index) => b.evaluate(`(() => {
  const all = [...document.querySelectorAll('[data-db-popover]')];
  const node = all[all.length - 1];
  const row = node?.querySelectorAll('.db-place-row')[${index}];
  if (!row) return null;
  const r = row.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), name: row.querySelector('.db-place-name')?.textContent ?? '' };
})()`);

const centreOf = (selector) => b.evaluate(`(() => {
  const node = document.querySelector('[data-db-popover] ' + ${JSON.stringify(selector)});
  if (!node) return null;
  const r = node.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);

async function press(title) {
  const field = await fieldOf(title);
  if (field.missing) throw new Error(`nothing to press for the ${title} cell`);
  if (!field.reachable) throw new Error(`the ${title} cell is at ${field.x},${field.y} but something else is on top of it`);
  await b.mouse(field.x, field.y);
  await sleep(180);
  return field;
}

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

/** The same wait, for the thing being *tested* rather than a precondition.
 *
 *  It returns the last state instead of throwing, because a probe whose first claim about the new
 *  feature times out is a probe that printed no verdicts at all — and "the run died" cannot be
 *  told from "the feature is missing" by anyone reading the log. Every claim below is then either
 *  checked or named as a failure. */
async function softUntil(predicate, timeoutMs = 6000) {
  /* A string here does not fail loudly: `Math.ceil("label" / 200)` is `NaN`, the loop runs zero
     times, and the wait returns `null` — which reads on the next line as "the feature is
     missing". That happened to this file exactly once, on its first `-Before` run, and the log
     blamed the app for 23 seconds. */
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs)) {
    throw new Error("softUntil takes milliseconds, not a label — a non-number makes the wait run zero times");
  }
  const steps = Math.ceil(timeoutMs / 200);
  let last = null;
  for (let i = 0; i < steps; i++) {
    last = await surface();
    if (last && predicate(last)) return last;
    await sleep(200);
  }
  if (process.env.DEBUG_SURFACE) console.log("  … unmatched wait, last surface:", JSON.stringify(last));
  return last;
}

/** The OSM wiki's tile-number formula, computed here rather than imported: a probe that asked
 *  the app where the tile is would be agreeing with the code it is meant to check. */
function referenceTile(lat, lng, z) {
  const n = 2 ** z;
  const radians = (lat * Math.PI) / 180;
  return {
    x: Math.floor((n * ((lng + 180) / 360)) % n),
    y: Math.floor((n * (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI)) / 2),
  };
}

const tileOf = (src) => {
  const params = new URL(src, BASE).searchParams;
  return { z: Number(params.get("z")), x: Number(params.get("x")), y: Number(params.get("y")) };
};

/** Do these squares cover this box, corner to corner? A box is covered when all four of its
 *  corners are inside *some* square — the one claim that does not depend on how many squares a
 *  particular coordinate happens to need. */
function covers(map, tiles) {
  const corners = [
    [map.left, map.top],
    [map.left + map.width - 0.5, map.top],
    [map.left, map.top + map.height - 0.5],
    [map.left + map.width - 0.5, map.top + map.height - 0.5],
  ];
  return corners.every(([x, y]) => tiles.some((tile) => x >= tile.left && x < tile.left + tile.width && y >= tile.top && y < tile.top + tile.height));
}

try {
  await b.waitFor("!!document.querySelector('.db-table tbody tr')", { label: "the table", timeoutMs: 25000 });
  b.check("the table is on screen", await b.evaluate("!!document.querySelector('tr[data-row-id]')"), "no rows");
  const tilesServedAtStart = tilesServed.length;

  /* §1 — a place that was picked *yesterday* opens as a map, from the stored value alone.
     The "no search" claim is the interesting half: a card that re-searched the saved address on
     every open would be a request per click, and on a rate-limited provider that is the
     difference between a feature and a way to get cut off. */
  const beforeOpen = b.requestCount();
  await press("Picked");
  /* Waits for the squares to have actually *painted*, not merely to exist: an `<img>` that is
     about to fail is in the DOM for a frame, and every claim below is about a picture. */
  const card = await softUntil(
    (state) => state.isCard === true && (state.card?.tiles ?? []).length >= 2 && state.card.tiles.every((tile) => tile.painted),
  );
  const searchedOnOpen = b.requests("/api/places/search", beforeOpen);
  b.check(
    "opening a place that already has a point shows a map instead of a list",
    card?.isCard === true && card?.rows.length === 0 && card?.role === "dialog",
    `card ${card?.isCard}, role ${JSON.stringify(card?.role)}, rows ${card?.rows.length}`,
  );
  b.check(
    "and it did not search for the saved address to draw it",
    searchedOnOpen.length === 0,
    `${searchedOnOpen.length} searches: ${JSON.stringify(searchedOnOpen.map((entry) => entry.url))}`,
  );
  b.check(
    "the card is headed by the address the cell stores",
    card?.card?.address === "Eiffel Tower, Paris, Île-de-France, France" && card?.card?.addressTitle === "Eiffel Tower, Paris, Île-de-France, France",
    `address ${JSON.stringify(card?.card?.address)}`,
  );
  b.check(
    "the cell still reads the address while its map is open",
    (await fieldOf("Picked")).value === "Eiffel Tower, Paris, Île-de-France, France",
    `field ${JSON.stringify((await fieldOf("Picked")).value)}`,
  );
  b.check(
    "the card says how wide the map is, and it is the box the tiles were laid out for",
    card?.card?.map?.width === 226 && card?.card?.map?.height === 150,
    `map ${JSON.stringify(card?.card?.map)}`,
  );
  b.check(
    "the squares cover the box corner to corner, and every one is our own route",
    card?.card != null && covers(card.card.map, card.card.tiles)
      && card.card.tiles.length >= 2 && card.card.tiles.length <= 4
      && card.card.tiles.every((tile) => tile.src.startsWith("/api/places/tile?")),
    `${card?.card?.tiles.length} tiles ${JSON.stringify(card?.card?.tiles.map((tile) => tile.src))}`,
  );

  /* §2 — the arithmetic, against the reference formula and against the picture.
     `filter` off first: the dark-map inversion is a *paint* stage, and a probe sampling a colour
     to decide *which square* it is cannot also be reading a colour the stylesheet transformed. */
  const grid = (card?.card?.tiles ?? []).map((tile) => ({ ...tileOf(tile.src), left: tile.left, top: tile.top, width: tile.width }));
  const expected = referenceTile(TOWER_POINT.lat, TOWER_POINT.lng, 16);
  const xs = [...new Set(grid.map((tile) => tile.x))].sort((a, b) => a - b);
  const ys = [...new Set(grid.map((tile) => tile.y))].sort((a, b) => a - b);
  b.check(
    "the squares are the 2×2 block around the coordinate OpenStreetMap's own formula gives",
    grid.every((tile) => tile.z === 16)
      && xs.length === 2 && ys.length === 2 && xs[1] === xs[0] + 1 && ys[1] === ys[0] + 1
      && xs[0] <= expected.x && expected.x <= xs[1] && ys[0] <= expected.y && expected.y <= ys[1],
    `tiles ${JSON.stringify(grid.map((tile) => `${tile.z}/${tile.x}/${tile.y}`))}, reference ${expected.x}/${expected.y}`,
  );
  b.check(
    "neighbours are exactly 256 apart, so no background can show between them",
    grid.length >= 2
      && grid.every((tile) => tile.width === 256)
      && grid.filter((tile) => tile.top === grid[0].top).sort((a, b) => a.left - b.left).every((tile, index, row) => index === 0 || tile.left - row[index - 1].left === 256)
      && grid.filter((tile) => tile.left === grid[0].left).sort((a, b) => a.top - b.top).every((tile, index, column) => index === 0 || tile.top - column[index - 1].top === 256),
    `tiles ${JSON.stringify(grid.map((tile) => [tile.left, tile.top, tile.width]))}`,
  );
  b.check(
    "the pin is on the point, which is the middle of the box",
    card?.card?.pin != null
      && Math.abs(card.card.pin.cx - (card.card.map.left + card.card.map.width / 2)) <= 1
      && Math.abs(card.card.pin.cy - (card.card.map.top + card.card.map.height / 2)) <= 1,
    `pin ${JSON.stringify(card?.card?.pin)} in map ${JSON.stringify(card?.card?.map)}`,
  );

  /* Read *before* the override below: the filter is a paint stage, and the colour samples under
     it are about which square is which, not about the theme. */
  const mapFilter = await b.evaluate("(() => { const tile = document.querySelector('.db-place-tile'); return tile ? getComputedStyle(tile).filter : ''; })()");
  b.check(
    "the dark-map filter is on, so a light basemap is not a white hole in a dark app",
    typeof mapFilter === "string" && mapFilter.includes("invert"),
    `filter ${JSON.stringify(mapFilter)}`,
  );
  await b.evaluate("document.documentElement.style.setProperty('--db-map-filter', 'none')");
  await sleep(250);
  /* Sample each square *inside the part of it the box shows*.
     Two corrections came out of measuring rather than reasoning. A 256px square is bigger than
     the 226×150 window, so its centre is often off the edge of the map — sampling there read the
     page behind the card and reported four greys. And the attribution label sits over the
     bottom-left corner, so a single point there reads the *label* rather than the tile (it
     reported rgb(44,130,36), which is neither square's colour). Hence three points per square,
     two of which must agree: a 9px line of text is not a tile, and one overlay should not be
     able to fail a claim about four images. */
  const sampled = [];
  for (const tile of grid) {
    const left = Math.max(tile.left, card.card.map.left) + 2;
    const right = Math.min(tile.left + card.card.map.width, card.card.map.left + card.card.map.width) - 2;
    const top = Math.max(tile.top, card.card.map.top) + 2;
    const bottom = Math.min(tile.top + card.card.map.height, card.card.map.top + card.card.map.height) - 2;
    const expected = { x: tile.x % 30, y: tile.y % 30 };
    if (right - left < 5 || bottom - top < 5) {
      sampled.push({ expected, points: [], votes: 0 });
      continue;
    }
    const points = [];
    for (const [fx, fy] of [[0.25, 0.3], [0.55, 0.55], [0.8, 0.75]]) {
      const x = Math.round(left + (right - left) * fx);
      const y = Math.round(top + (bottom - top) * fy);
      const pixel = await b.pixel(x, y);
      points.push({ x, y, pixel, got: decodeSwatch(pixel) });
    }
    const votes = points.filter((point) => point.got.exact && point.got.x === expected.x && point.got.y === expected.y).length;
    sampled.push({ expected, points, votes });
  }
  b.check(
    "every square is painted, and its pixels name the square its URL asked for",
    grid.length >= 2
      && sampled.length === grid.length
      && sampled.every((entry) => entry.votes >= 2)
      && sampled.every((entry) => entry.points.every((point) => point.pixel.b < 60)),
    `samples ${JSON.stringify(sampled.map((entry) => `${entry.votes}/3 → ${entry.expected.x},${entry.expected.y} from ${entry.points.map((point) => `rgb(${point.pixel.r},${point.pixel.g},${point.pixel.b})`).join(" ")}`))}`,
  );
  /* What the tile server saw *during this run*. The second width asks for the same squares, and
     by then the app's own cache is warm — so "the fixture was asked" is not an invariant; "the
     fixture was never asked for anything this card is not showing, and never by a browser" is. */
  const servedThisRun = tilesServed.slice(tilesServedAtStart);
  const expectedKeys = new Set(grid.map((tile) => `${tile.z}/${tile.x}/${tile.y}`));
  b.check(
    "the tile server was asked only for these squares, only by this app — or not at all, when the cache is warm",
    servedThisRun.every((served) => expectedKeys.has(`${served.z}/${served.x}/${served.y}`) && /^Raspberry\//.test(served.agent))
      && (servedThisRun.length === 0 || servedThisRun.length >= grid.length),
    `${servedThisRun.length} served: ${JSON.stringify(servedThisRun.map((tile) => `${tile.z}/${tile.x}/${tile.y} ${tile.agent.slice(0, 12)}`))}`,
  );

  /* §3 — what the card offers besides the picture. */
  b.check(
    "the map is credited to OpenStreetMap, with a link to their licence",
    card?.card?.credit?.text === "© OpenStreetMap contributors" && card?.card?.credit?.href === "https://www.openstreetmap.org/copyright",
    `credit ${JSON.stringify(card?.card?.credit)}`,
  );
  b.check(
    "and there is a way out to the real map — Google Maps, asked in coordinates, opening beside the app",
    card?.card?.open?.target === "_blank"
      && card?.card?.open?.href === "https://www.google.com/maps/search/?api=1&query=48.858400,2.294500"
      && /Google Maps/.test(card?.card?.open?.label ?? "")
      /* Not `query=Eiffel Tower`: Google would re-geocode the address against its own data and
         could put its pin somewhere other than the one this card drew. */
      && !/Eiffel|%20|\+/.test(card?.card?.open?.href ?? ""),
    `open ${JSON.stringify(card?.card?.open)}`,
  );

  /* §4 — nothing left the machine. This is the claim the whole server-side tile route exists
     for, and it is not visible in any rectangle: an `<img>` pointed at somebody else's host draws
     exactly the same picture. */
  const page = b.requests();
  const foreign = page.filter((entry) => {
    const url = new URL(entry.url);
    return url.host !== `127.0.0.1:${new URL(BASE).port}` && url.protocol !== "data:" && url.protocol !== "blob:";
  });
  b.check(
    "every request the page made stayed on this machine",
    foreign.length === 0,
    `foreign ${JSON.stringify(foreign.map((entry) => entry.url).slice(0, 4))}`,
  );
  b.check(
    "and the map went through our route rather than an <img> at a tile server",
    page.some((entry) => entry.url.includes("/api/places/tile")) && page.every((entry) => !entry.url.includes("tile.openstreetmap.org")),
    `${page.filter((entry) => entry.url.includes("tile")).length} tile requests`,
  );
  await b.shot(`place-map-${width}`);

  /* §5 — the pick. "The dropdown gets overwritten by a map" is about the surface *staying open*:
     a card that only appeared on the next click would be a different feature. */
  await b.key("Escape", { keyCode: 27 });
  await sleep(150);
  await press("Search");
  await b.type("Eiffel");
  const list = await until((state) => state.rows.length > 0, "the results for Eiffel");
  b.check("typing over an empty cell lists places", list?.isCard === false && list?.role === "listbox", `card ${list?.isCard}, role ${JSON.stringify(list?.role)}`);
  const tile = await rowAt(0);
  await b.mouse(tile.x, tile.y);
  const afterPick = await softUntil((state) => state.isCard === true);
  b.check(
    "picking a place replaces the list with its map, without a second click",
    afterPick?.card?.address === "Eiffel Tower, Paris, Île-de-France, France" && afterPick?.role === "dialog",
    `card ${JSON.stringify(afterPick?.card?.address)}, role ${JSON.stringify(afterPick?.role)}`,
  );
  for (let i = 0; i < 20; i++) {
    if ((await stored()).rows.Search !== null) break;
    await sleep(150);
  }
  const committed = (await stored()).rows.Search;
  b.check(
    "and the map is of the point that was stored",
    committed?.lat === TOWER_POINT.lat && Math.abs(committed?.lng - TOWER_POINT.lng) < 0.0001,
    `stored ${JSON.stringify(committed)}`,
  );
  b.check(
    "the pin sits on that coordinate, not on the corner of the card",
    afterPick?.card?.pin != null
      && Math.abs(afterPick.card.pin.cx - (afterPick.card.map.left + afterPick.card.map.width / 2)) <= 1,
    `pin ${JSON.stringify(afterPick?.card?.pin)} in map ${JSON.stringify(afterPick?.card?.map)}`,
  );

  /* §6 — typing over the card asks a new question, so the list comes back. */
  await press("Search");
  await b.type("zz");
  const back = await until((state) => state.isCard === false, "the list back under a typed-over card");
  b.check(
    "typing over the card brings the list back",
    back?.isCard === false && back?.role === "listbox" && back?.card === null,
    `card ${back?.isCard}, role ${JSON.stringify(back?.role)}`,
  );
  /* Two Escapes: the first dismisses the list, the second gives the cell back the value it had
     (`"…France"` plus the two letters), so §7 starts from a cell that was not left dirty. */
  await b.key("Escape", { keyCode: 27 });
  await sleep(150);
  await b.key("Escape", { keyCode: 27 });
  await sleep(200);
  await press("Spare");
  await b.type("Eiffel");
  await until((state) => state.rows.length > 0, "results in the Spare cell");
  const spareTile = await rowAt(0);
  await b.mouse(spareTile.x, spareTile.y);
  await softUntil((state) => state.isCard === true);
  const clearAt = await centreOf(".db-place-card-clear");
  b.check("the card offers a control for clearing it", clearAt !== null, "no clear control");
  /* Without a control there is nothing to press, and the two claims that follow are still claims:
     they are reported as failures with their reason rather than skipped, so a run on the pre-fix
     tree says *three* things about clearing instead of one. */
  const cleared = clearAt === null ? null : await (async () => {
    await b.mouse(clearAt.x, clearAt.y);
    return softUntil((state) => state.isCard === false);
  })();
  for (let i = 0; i < (clearAt === null ? 0 : 20); i++) {
    if ((await stored()).rows.Spare === null) break;
    await sleep(150);
  }
  b.check(
    "clearing empties the cell, and the server agrees",
    clearAt !== null && (await fieldOf("Spare")).value === "" && (await stored()).rows.Spare === null,
    clearAt === null ? "there was no card to clear" : `field ${JSON.stringify((await fieldOf("Spare")).value)}, stored ${JSON.stringify((await stored()).rows.Spare)}`,
  );
  b.check(
    "and the caret is back in the field, ready for the next search",
    (await fieldOf("Spare")).focused === true && cleared?.role === "listbox",
    `focused ${(await fieldOf("Spare")).focused}, role ${JSON.stringify(cleared?.role)}`,
  );

  /* §8 — a composed address: the point is a road, and the card must say so rather than draw the
     same dot as a door. */
  await press("Address");
  await b.type("Rašica 53");
  const composed = await until((state) => state.rows.length > 0, "the composed address");
  b.check(
    "a house number the map data does not have is offered as an address anyway",
    /^Rašica 53/.test(composed?.rows[0]?.name ?? ""),
    `first row ${JSON.stringify(composed?.rows[0])}`,
  );
  const composedAt = await rowAt(0);
  await b.mouse(composedAt.x, composedAt.y);
  const approx = await softUntil((state) => state.isCard === true);
  b.check(
    "its pin is a ring, not a dot",
    approx?.card?.pin?.approx === true && approx?.card?.pin?.width === 15,
    `pin ${JSON.stringify(approx?.card?.pin)}`,
  );
  b.check(
    "and the card says the point is the road, not the door",
    (approx?.card?.meta ?? []).includes("Placed on the road, not the door"),
    `meta ${JSON.stringify(approx?.card?.meta)}`,
  );
  const approxTiles = (approx?.card?.tiles ?? []).map((entry) => tileOf(entry.src));
  b.check(
    "a road is drawn further out than a door, because the point is less certain",
    approxTiles.length >= 2 && approxTiles.every((entry) => entry.z === 15),
    `tiles ${JSON.stringify(approxTiles.map((entry) => `${entry.z}/${entry.x}/${entry.y}`))}`,
  );

  /* §9 — the switch. The route is made to answer `503 tiles_off` *inside the browser*, which is
     the same bytes the real switch produces: the card must say that the tiles are off rather
     than that the map is broken, and must keep the pin. */
  await b.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/places/tile*" }] });
  const fulfil = (method, params) => {
    if (method !== "Fetch.requestPaused") return;
    const body = Buffer.from(JSON.stringify({ error: { code: "tiles_off", message: "Map tiles are switched off." } })).toString("base64");
    b.send("Fetch.fulfillRequest", {
      requestId: params.requestId,
      responseCode: 503,
      responseHeaders: [{ name: "content-type", value: "application/json" }],
      body,
    });
  };
  b.onEvent(fulfil);
  await b.key("Escape", { keyCode: 27 });
  await sleep(150);
  await press("Picked");
  const off = await softUntil((state) => state.card?.blankNote === "Map tiles are switched off");
  b.check(
    "with tiles switched off the card says so, and does not call the map broken",
    off?.card?.blankNote === "Map tiles are switched off",
    `note ${JSON.stringify(off?.card?.blankNote)}`,
  );
  b.check(
    "and the pin is still on the point it knows",
    off?.card?.pin != null
      && Math.abs(off.card.pin.cx - (off.card.map.left + off.card.map.width / 2)) <= 1,
    `pin ${JSON.stringify(off?.card?.pin)}`,
  );
  b.onEvent(null);
  await b.send("Fetch.disable");
  await b.key("Escape", { keyCode: 27 });
  await sleep(150);

  /* §10 — the surface at a narrow window: the card must fit, not hang off the edge. */
  await press("Picked");
  const narrow = await softUntil((state) => state.isCard === true);
  b.check(
    "the card is inside the window at this width",
    narrow?.inside === true,
    `rect ${narrow?.left}..${narrow?.right} in ${width}, scroll ${narrow?.scroll}`,
  );
  await b.shot(`place-map-card-${width}`);
  await b.key("Escape", { keyCode: 27 });
  await sleep(150);
  b.check("Escape closes the card and leaves the cell alone", (await anySurface()) === false && (await fieldOf("Picked")).focused === true, `surface ${await anySurface()}`);
  await press("Picked");
  const reopened = await softUntil((state) => state.isCard === true);
  b.check("and a press reopens it, because the field kept the caret", reopened?.isCard === true, `card ${reopened?.isCard}`);

  await b.report();
} finally {
  geocoder.close();
  tileServer.close();
  await b.close();
}
