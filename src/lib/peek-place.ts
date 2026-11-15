/* Raspberry — where a hover preview goes (B54)
   ---------------------------------------------------------------------------
   A peek is not a menu, and the difference is arithmetic. A menu is *anchored*
   to its trigger and must stay attached to it; a peek is *beside* the thing it
   describes, on the side where the row it belongs to is not.

   Three rules, and each one is a bug that a simpler formula produces:

   1. **Right first, left second.** A file row lives in a dropdown hanging off a
      table cell. The room beside a cell is on the right, so that is where the
      peek goes — until it would leave the viewport, at which point it flips. A
      peek that slides sideways over the row it describes covers the name it is
      meant to illustrate.

   2. **Vertically centred on the row, then clamped.** Centred reads as "this
      belongs to that line". Clamped is what keeps the first and last rows of a
      long list from hanging a preview off the screen.

   3. **No pointer offset.** `menu-place.ts` has an `atPointer` anchor for a
      context menu, because there the click *is* the target. A peek is the
      opposite: it appears 300ms after a hover and must not trail the cursor,
      or it twitches every time the mouse moves within the row.

   Pure on purpose, like `menu-place.ts`: the React component reads one rect,
   this decides the numbers, and the tests can visit the corners of the screen
   that a browser suite would have to be lucky to reach.
*/

/** Space between the row and the peek. Wide enough to read as "next to", narrow
    enough that the eye does not lose the connection across it. */
export const PEEK_GAP = 10;

/** Minimum distance from any viewport edge, the same 8px every surface in this
    app keeps. */
export const PEEK_GUTTER = 8;

export type PeekAnchor = { x: number; y: number; width: number; height: number };
export type PeekSize = { width: number; height: number };
export type PeekViewport = { width: number; height: number };

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}

/**
 * Where the peek's top-left corner goes, for an anchor rect and a box that is
 * already the size it will be drawn at. Returns whole pixels: a preview at
 * `left: 312.5` blurs its own border against the surface behind it.
 */
export function placePeek(anchor: PeekAnchor, size: PeekSize, viewport: PeekViewport): { left: number; top: number } {
  const right = anchor.x + anchor.width + PEEK_GAP;
  const left = anchor.x - PEEK_GAP - size.width;

  /* `<=` against the gutter, not `<`: a peek whose right edge lands exactly on
     the gutter is inside the screen, and flipping it there would put it over
     the row for one pixel's sake. */
  const placed =
    right + size.width <= viewport.width - PEEK_GUTTER
      ? right
      : left >= PEEK_GUTTER
        ? left
        : viewport.width - size.width - PEEK_GUTTER;

  /* When neither side fits — a viewport narrower than the box itself — the
     third branch goes over the row, flush right. Overlapping is not good, but
     it is the only answer that keeps the peek on screen and its left edge
     unclipped, which is where the picture starts. */
  const centred = anchor.y + anchor.height / 2 - size.height / 2;
  const top = clamp(centred, PEEK_GUTTER, Math.max(PEEK_GUTTER, viewport.height - size.height - PEEK_GUTTER));

  return { left: Math.round(Math.max(PEEK_GUTTER, placed)), top: Math.round(top) };
}
