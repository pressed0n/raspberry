/* Raspberry — sidebar drag model (B28)
   ---------------------------------------------------------------------------
   What a pointer position over the page tree *means*, and what to ask the server to
   do about it. No React, no DOM: the browser measures rows and passes plain numbers
   in, so every rule below is testable without a browser.

   The tree gives you three drop meanings and they are all in this file:

     · hover the middle of a row   → "inside"  — become that page's last child
     · hover the top edge of a row → "before"  — become its previous sibling
     · hover the bottom edge       → "after"   — become its next sibling

   Two rules that look like details and are not:

   1. A page can never be dropped into its own subtree. The server refuses it too
      (`assertMovable`), but a refused drop that the UI drew as legal is worse than no
      drop: the page snaps back with an error nobody can act on. So the dragged subtree
      is removed from hit testing *and* from every computed index.

   2. "After X" means after X's whole visible block, not after X's row. If X is expanded
      its children sit under it, so the line the user sees when the gap is below X's last
      child has to produce the same result as the gap below X's own row. `dropAnchor`
      resolves that; without it a drop under an expanded page lands in a place the
      indicator never pointed at.
*/

export type DropKind = "before" | "after" | "inside";
/** `id` is the anchor row: the page the pointer is over. */
export type DropTarget = { kind: DropKind; id: string };
/** A visible row, measured in the scroll container's coordinate space. */
export type DragRow = { id: string; parentId: string | null; depth: number; top: number; height: number };
export type DragPage = { id: string; parentId: string | null };
/** What the server needs: a parent and a slot among that parent's children. */
export type DropSite = { parentId: string | null; index: number };

/** Share of a row's height at each end that reads as "between" rather than "inside".
    0.3 of 28px is ~8px of gap band and ~11px of nest band — small enough that aiming
    at a page still nests, large enough to hit the gap without pixel hunting. */
const EDGE_BAND = 0.3;

export function subtreeIds(pages: readonly DragPage[], id: string): Set<string> {
  const found = new Set<string>([id]);
  /* Breadth-first over the page list rather than recursion over the tree: `pages` is
     flat and unordered here, so repeatedly scanning for children is the only traversal
     that does not assume the array was pre-sorted. */
  let grew = true;
  while (grew) {
    grew = false;
    for (const page of pages) {
      if (page.parentId && found.has(page.parentId) && !found.has(page.id)) { found.add(page.id); grew = true; }
    }
  }
  return found;
}

function siblingsOf(pages: readonly DragPage[], parentId: string | null, excluded: Set<string>): DragPage[] {
  /* Array order *is* sibling order: the caller builds `pages` from the server's list,
     which is ordered by position. Filtering here (rather than sorting) keeps that single
     source of truth — a second ordering rule would eventually disagree with the first. */
  return pages.filter((page) => page.parentId === parentId && !excluded.has(page.id));
}

/**
 * Which drop the pointer is offering, or null when it offers none.
 *
 * `rows` must be the *visible* rows in draw order, as measured before the drag started:
 * hit testing against a live layout is what made the tab drag jitter, because a swap
 * moves the boundaries that decided the swap.
 */
export function dropTarget(rows: readonly DragRow[], pointerY: number, blocked: ReadonlySet<string>): DropTarget | null {
  const live = rows.filter((row) => !blocked.has(row.id));
  if (!live.length) return null;
  const first = live[0], last = live[live.length - 1];
  if (pointerY < first.top) return { kind: "before", id: first.id };
  if (pointerY >= last.top + last.height) return { kind: "after", id: last.id };
  for (const [index, row] of live.entries()) {
    if (pointerY < row.top || pointerY >= row.top + row.height) continue;
    const fraction = (pointerY - row.top) / (row.height || 1);
    /* A row's own children, or a row inside the dragged subtree, cannot receive an
       "inside" drop — but the pointer may still be in the middle of it, so the drop
       degrades to the nearest legal gap rather than disappearing. A target that flickers
       in and out as you move down the list is unusable. */
    if (fraction < EDGE_BAND) return { kind: "before", id: row.id };
    if (fraction > 1 - EDGE_BAND) {
      const next = live[index + 1];
      /* Below the last visible child of a page: the gap sits between two rows that are
         not siblings, and the only thing it can mean is "first child of the row above". */
      return next && next.parentId === row.id ? { kind: "before", id: next.id } : { kind: "after", id: row.id };
    }
    return { kind: "inside", id: row.id };
  }
  return null;
}

/**
 * The row whose *block* ends where an "after" gap is drawn — the last visible descendant
 * of `id`, or `id` itself when it has none. Used to place the insertion line.
 */
export function blockEnd(rows: readonly DragRow[], id: string): DragRow | null {
  const at = rows.findIndex((row) => row.id === id);
  if (at === -1) return null;
  const base = rows[at];
  let end = base;
  for (let index = at + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.depth <= base.depth) break;
    end = row;
  }
  return end;
}

/** Turn a drop target into the parent+slot the API takes, or null if it is not legal. */
export function resolveDrop(pages: readonly DragPage[], target: DropTarget | null, dragged: string): DropSite | null {
  if (!target || target.id === dragged) return null;
  const excluded = subtreeIds(pages, dragged);
  if (excluded.has(target.id)) return null;
  if (target.kind === "inside") {
    /* Append as the last child: the page appears at the bottom of the subtree it was
       dropped on, which is where the pointer was. */
    return { parentId: target.id, index: siblingsOf(pages, target.id, excluded).length };
  }
  const anchor = pages.find((page) => page.id === target.id);
  if (!anchor) return null;
  const siblings = siblingsOf(pages, anchor.parentId, excluded);
  const at = siblings.findIndex((page) => page.id === anchor.id);
  if (at === -1) return null;
  return { parentId: anchor.parentId, index: target.kind === "before" ? at : at + 1 };
}

/** True when a drop site would not move the page — calling the API then is a wasted
    revision bump that can conflict with the page's own autosave.

    `index` is always expressed against the destination list *without* the dragged page,
    because that is what the server splices into after removing it. So a same-parent drop
    that leaves the order untouched is exactly the one landing back in its own slot —
    `from`. Landing at `from + 1` is a real one-slot move down, not a no-op. */
export function isNoop(pages: readonly DragPage[], dragged: string, site: DropSite | null): boolean {
  if (!site) return true;
  const page = pages.find((item) => item.id === dragged);
  if (!page || page.parentId !== site.parentId) return false;
  const siblings = siblingsOf(pages, site.parentId, new Set());
  const from = siblings.findIndex((item) => item.id === dragged);
  if (from === -1) return true;
  return site.index === from;
}

/**
 * Keyboard equivalent (Alt+↑ / Alt+↓): walk one slot among the page's own siblings.
 *
 * Drag is the requested interaction, not the only one that should work. This is the same
 * model the pointer uses, so the two cannot drift apart, and it is what the probe uses to
 * assert reordering without synthesising a gesture.
 */
export function keyboardMove(pages: readonly DragPage[], dragged: string, direction: "up" | "down"): DropSite | null {
  const page = pages.find((item) => item.id === dragged);
  if (!page) return null;
  const siblings = siblingsOf(pages, page.parentId, new Set());
  const at = siblings.findIndex((item) => item.id === dragged);
  if (at === -1) return null;
  const to = direction === "up" ? at - 1 : at + 1;
  if (to < 0 || to >= siblings.length) return null;
  /* `to` is already the index in the list without the moving page — the same frame the
     server splices into after removing it. */
  return { parentId: page.parentId, index: to };
}
