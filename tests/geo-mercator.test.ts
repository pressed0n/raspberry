import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ZOOM,
  TILE_SIZE,
  clampLatitude,
  isValidTile,
  mapLink,
  project,
  tileGrid,
  tileSrc,
  tileUrl,
  wrapLongitude,
} from "../src/lib/geo/mercator";
import { MAP_PREVIEW_HEIGHT, MAP_PREVIEW_WIDTH, DOOR_ZOOM, ROAD_ZOOM, previewGrid, previewZoom } from "../src/lib/geo/preview";

/* ---------------------------------------------------------------------------
   The arithmetic under the map preview.
   ---------------------------------------------------------------------------
   Every number here was checked against something that is not this file: the OSM wiki's
   tile-number formula, and the answer OpenStreetMap's own tile server gives for the Eiffel
   Tower. A projection is exactly the kind of code that looks right and puts Slovenia in the
   Sahara, so the assertions are about *where things land*, not about the shape of the output.
   --------------------------------------------------------------------------- */
const EIFFEL = { lat: 48.8584, lng: 2.2945 };

test("the Eiffel Tower projects to the tile OpenStreetMap serves it from", () => {
  /* `https://tile.openstreetmap.org/16/33185/22545.png` is the tower at zoom 16 — fetched while
     this was written, and the same numbers the wiki's formula produces. */
  const point = project(EIFFEL, 16);
  assert.equal(Math.floor(point.x / TILE_SIZE), 33185);
  assert.equal(Math.floor(point.y / TILE_SIZE), 22545);
});

test("the north-west corner of the world is the origin of every zoom", () => {
  const corner = project({ lat: 90, lng: -180 }, 0);
  assert.ok(Math.abs(corner.x) < 1e-9, `x ${corner.x}`);
  assert.ok(Math.abs(corner.y) < 1e-6, `y ${corner.y}`);
  const middle = project({ lat: 0, lng: 0 }, 0);
  assert.ok(Math.abs(middle.x - 128) < 1e-9 && Math.abs(middle.y - 128) < 1e-9);
  /* Y grows south, which is why the equator is 128 and the pole is 0 — not the other way round. */
  const south = project({ lat: -90, lng: 0 }, 1);
  assert.ok(Math.abs(south.y - 512) < 1e-6, `south ${south.y}`);
});

test("a coordinate projects to the same place at every zoom, scaled", () => {
  /* Two zooms are the same world at two sizes. A projection that drifted between them would put
     the pin in one place at 16 and another at 15, which is exactly what a "zoom out" does. */
  const coarse = project(EIFFEL, 15);
  const fine = project(EIFFEL, 16);
  assert.ok(Math.abs(fine.x - coarse.x * 2) < 1e-6);
  assert.ok(Math.abs(fine.y - coarse.y * 2) < 1e-6);
});

test("latitude is clamped to the edge of the Mercator world, not refused and not infinite", () => {
  assert.equal(clampLatitude(91), clampLatitude(90));
  assert.equal(clampLatitude(-91), clampLatitude(-90));
  assert.ok(Number.isFinite(project({ lat: 90, lng: 0 }, 3).y));
  assert.ok(Number.isFinite(project({ lat: -90, lng: 0 }, 3).y));
});

test("longitude wraps, and the antimeridian is one meridian", () => {
  assert.equal(wrapLongitude(0), 0);
  assert.equal(wrapLongitude(181), -179);
  assert.equal(wrapLongitude(-181), 179);
  assert.equal(wrapLongitude(540), -180);
  assert.equal(project({ lat: 0, lng: 180 }, 2).x, project({ lat: 0, lng: -180 }, 2).x);
});

test("the tiles cover the box, corner to corner", () => {
  const grid = tileGrid(EIFFEL, 16, MAP_PREVIEW_WIDTH, MAP_PREVIEW_HEIGHT);
  assert.ok(grid.tiles.length >= 2 && grid.tiles.length <= 4, `${grid.tiles.length} tiles`);
  const corners = [[0, 0], [grid.width - 1, 0], [0, grid.height - 1], [grid.width - 1, grid.height - 1]];
  for (const [x, y] of corners) {
    const covered = grid.tiles.some((tile) => x >= tile.left && x < tile.left + TILE_SIZE && y >= tile.top && y < tile.top + TILE_SIZE);
    assert.ok(covered, `the corner ${x},${y} is not on any tile`);
  }
});

test("neighbouring tiles are exactly 256 apart, at integer offsets", () => {
  /* The integer half is the one that matters: the browser rounds a fractional position itself,
     per layer, and two independent roundings of adjacent edges is a 1px seam of background. */
  const grid = tileGrid({ lat: 45.85663, lng: 14.62152 }, 16, MAP_PREVIEW_WIDTH, MAP_PREVIEW_HEIGHT);
  for (const tile of grid.tiles) {
    assert.ok(Number.isInteger(tile.left) && Number.isInteger(tile.top), `${tile.key} sits at ${tile.left},${tile.top}`);
  }
  const row = grid.tiles.filter((tile) => tile.top === grid.tiles[0].top).sort((a, b) => a.left - b.left);
  for (let i = 1; i < row.length; i++) assert.equal(row[i].left - row[i - 1].left, TILE_SIZE);
  const column = grid.tiles.filter((tile) => tile.left === grid.tiles[0].left).sort((a, b) => a.top - b.top);
  for (let i = 1; i < column.length; i++) assert.equal(column[i].top - column[i - 1].top, TILE_SIZE);
});

test("the pin is the middle of the box, by construction", () => {
  for (const point of [EIFFEL, { lat: 45.85663, lng: 14.62152 }, { lat: -33.8688, lng: 151.2093 }, { lat: 0, lng: 0 }]) {
    const grid = tileGrid(point, 16, MAP_PREVIEW_WIDTH, MAP_PREVIEW_HEIGHT);
    assert.ok(Math.abs(grid.pin.left - MAP_PREVIEW_WIDTH / 2) <= 0.5, `left ${grid.pin.left}`);
    assert.ok(Math.abs(grid.pin.top - MAP_PREVIEW_HEIGHT / 2) <= 0.5, `top ${grid.pin.top}`);
  }
});

test("a box wider than the world draws each square once", () => {
  /* Zoom 0 is one tile for the whole planet. A box 600px wide over it would otherwise produce the
     same tile three times, which React renders as three keys that are all the same key. */
  const grid = tileGrid({ lat: 0, lng: 0 }, 0, 600, 600);
  assert.equal(grid.tiles.length, 1);
  assert.equal(new Set(grid.tiles.map((tile) => tile.key)).size, grid.tiles.length);
});

test("a tile index outside the pyramid is not a tile", () => {
  assert.ok(isValidTile(0, 0, 0));
  assert.ok(isValidTile(MAX_ZOOM, 2 ** MAX_ZOOM - 1, 2 ** MAX_ZOOM - 1));
  assert.ok(!isValidTile(-1, 0, 0));
  assert.ok(!isValidTile(MAX_ZOOM + 1, 0, 0));
  assert.ok(!isValidTile(4, 16, 0));
  assert.ok(!isValidTile(4, -1, 0));
  assert.ok(!isValidTile(4.5, 0, 0));
  assert.ok(!isValidTile(4, 0.5, 0));
});

test("tile URLs are built without a doubled slash, and the app's route is our own", () => {
  assert.equal(tileUrl("https://tile.openstreetmap.org", 16, 33185, 22545), "https://tile.openstreetmap.org/16/33185/22545.png");
  assert.equal(tileUrl("http://127.0.0.1:3119/", 15, 1, 2), "http://127.0.0.1:3119/15/1/2.png");
  assert.equal(tileSrc(16, 33185, 22545), "/api/places/tile?z=16&x=33185&y=22545");
});

test("the way out of the app is Google Maps, asked in coordinates rather than in address text", () => {
  /* The address is the provider's sentence, and Google would re-geocode it against its own
     database — a second opinion that can land somewhere other than the pin drawn a pixel
     earlier. `maps/search/?api=1&query=lat,lng` is Google's documented keyless form, so the
     assertion is on the whole string: the host, the API parameter and the pair in that order. */
  assert.equal(mapLink(EIFFEL), "https://www.google.com/maps/search/?api=1&query=48.858400,2.294500");
  /* Latitude and longitude are clamped first: the top of the world is a point, `91` is not. */
  assert.equal(mapLink({ lat: 91, lng: 200 }), "https://www.google.com/maps/search/?api=1&query=85.051129,-160.000000");
  /* And the address text must not be in it — the mistake this test exists to prevent is
     `query=Eiffel%20Tower`, which looks more helpful and opens whatever Google decides. */
  const query = mapLink(EIFFEL).split("query=")[1];
  assert.equal(query, "48.858400,2.294500", "two numbers, separated by the comma Google expects");
  assert.equal(/[%+]/.test(query), false, "nothing to escape, so nothing escaped");
});

test("a door is drawn closer than a road", () => {
  assert.equal(previewZoom(false), DOOR_ZOOM);
  assert.equal(previewZoom(true), ROAD_ZOOM);
  assert.ok(ROAD_ZOOM < DOOR_ZOOM);
  const door = previewGrid(EIFFEL, false);
  const road = previewGrid(EIFFEL, true);
  assert.equal(door.zoom, 16);
  assert.equal(road.zoom, 15);
  assert.equal(door.width, MAP_PREVIEW_WIDTH);
  assert.equal(door.height, MAP_PREVIEW_HEIGHT);
});
