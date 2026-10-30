/* Raspberry — menu placement (B37)
   ---------------------------------------------------------------------------
   Where a portalled dropdown goes, as arithmetic. Two ways to point a menu at
   something on screen, and they are not interchangeable:

     align: "end"    a button anchor. The menu's right edge meets the button's
                     right edge. This is the `⋯` case, and it is not cosmetic —
                     the button sits 8px from the right edge of a 264px sidebar,
                     so a left-aligned menu would hang off the screen.

     align: "start"  a pointer anchor. The menu's top-left corner sits exactly
                     on the click, the way a native context menu does. Here the
                     click *is* the target indicator, so `gap` must be 0: a 6px
                     offset would leave a strip of row visible between the thing
                     you aimed at and the menu that answers it.

   Flipping upward when the menu would leave the bottom is shared by both. There
   is deliberately no horizontal flip: clamping slides the menu sideways instead,
   which is one rule instead of two and cannot produce a menu that jumps to the
   other side of the cursor between two adjacent clicks.

   Pure on purpose — the React component reads the rects, this decides the
   numbers, and the tests cover the edge cases the browser suite would have to
   be very lucky to visit (a menu taller than the space above *and* below it).
*/

export type MenuAnchor = {
  /** Viewport x of the anchor's left edge — or of the pointer, for "start". */
  x: number;
  y: number;
  width: number;
  height: number;
  align?: "end" | "start";
  /** Space between the anchor and the menu. Defaults to 6px, i.e. button spacing. */
  gap?: number;
};

export type MenuSize = { width: number; height: number };
export type Viewport = { width: number; height: number };

/** Minimum distance from any viewport edge. Never violated, even when the menu
    is too wide for the screen — it is clipped from the right, not pushed off the
    left where the first items would be unreachable. */
export const GUTTER = 8;

const BUTTON_GAP = 6;

/** Same evaluation order as the original inline math (`max(lo, min(v, hi))`):
    when the menu is wider than the viewport, the low bound wins. Written out
    because `Math.min(Math.max(...))` — the more natural-looking form — would
    quietly change what happens in exactly that case. */
function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}

export function placeMenu(anchor: MenuAnchor, size: MenuSize, viewport: Viewport): { left: number; top: number } {
  const gap = anchor.gap ?? BUTTON_GAP;

  const rightMost = viewport.width - size.width - GUTTER;
  const wanted = (anchor.align ?? "end") === "start"
    ? anchor.x
    : anchor.x + anchor.width - size.width;
  const left = clamp(wanted, GUTTER, rightMost);

  const below = anchor.y + anchor.height + gap;
  /* No high bound on the flipped position, matching the behaviour this replaced:
     a menu taller than the viewport has nowhere valid to go, and pinning it to
     the top gutter would put its first item under the pointer that just clicked. */
  const top = below + size.height > viewport.height - GUTTER
    ? Math.max(GUTTER, anchor.y - size.height - gap)
    : below;

  return { left: Math.round(left), top: Math.round(top) };
}

/** A pointer anchor at the click. `gap: 0` is not a default worth overriding —
    it is the difference between a context menu and a menu that misses. */
export function atPointer(x: number, y: number): MenuAnchor {
  return { x, y, width: 0, height: 0, align: "start", gap: 0 };
}

/** The anchor rect for a DOM rect, in the shape `placeMenu` wants. */
export function atRect(rect: { x: number; y: number; width: number; height: number }): MenuAnchor {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}
