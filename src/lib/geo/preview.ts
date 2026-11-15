import { tileGrid, type MapPoint, type TileGrid } from "./mercator";

/**
 * The map preview inside a Place cell — the box, and how close it stands.
 * ---------------------------------------------------------------------------
 * The owner's reference was Notion: "when I do select a location ... the dropdown gets
 * overwritten by a map with a pin on my selected location". So this file is the *policy* of
 * that box (how big, how close), kept apart from `mercator.ts`, which is the *arithmetic* of
 * it. The separation is what lets the database's map view reuse the arithmetic with a
 * different policy — a full-screen box at whatever zoom the person has scrolled to.
 *
 * **The width is derived, not chosen.** The surface is `MENU_WIDTH` (252) from `menu.tsx`,
 * minus its 1px border and 4px padding each side (242), minus the card's 8px padding each
 * side (226). Writing 226 here as a fresh number would be the fourth place in the app that
 * knows how wide a dropdown is; the comment is the only thing holding them together, so the
 * arithmetic is spelled out instead. `previewGrid` returns the size it used, and the component
 * writes it inline, so the tiles and the box cannot disagree.
 *
 * **Two zooms, because the app knows two precisions.** A picked door is a point: at z16 the
 * box is ~375m across, which is the street and its neighbours. A *composed* address — the
 * house number the map data does not have, placed on the road it is on (B51) — is a road, so
 * the box opens out to z15 (~750m) and the pin is drawn as a ring rather than a dot. A map
 * that showed both at the same scale would be claiming the same confidence twice.
 */
export const MAP_PREVIEW_WIDTH = 226; /* 252 − 2 border − 8 surface padding − 16 card padding */
export const MAP_PREVIEW_HEIGHT = 150;

export const DOOR_ZOOM = 16;
export const ROAD_ZOOM = 15;

export function previewZoom(approximate: boolean): number {
  return approximate ? ROAD_ZOOM : DOOR_ZOOM;
}

export function previewGrid(point: MapPoint, approximate: boolean): TileGrid {
  return tileGrid(point, previewZoom(approximate), MAP_PREVIEW_WIDTH, MAP_PREVIEW_HEIGHT);
}
