/* Moving one entry in a list, by id.
   ---------------------------------------------------------------------------
   Reordering a tag list is two lines of `splice` and one off-by-one. The
   off-by-one is invisible in a screenshot — the list is still four tags in *an*
   order — and it is the difference between a drag that lands where the pointer
   drew the line and one that lands a place away from it. So it lives here,
   pure and tested, instead of inside a component's closure where the only way to
   prove it is to drive a browser.

   Both functions speak **ids**, for a reason that is not stylistic: the tag menu
   drops into `matches`, which is a *filtered* projection of the config. An index
   into a filtered list is not an index into the property, so a reorder that took
   indices would move the wrong tag the moment someone typed in the search box.

   `null` means "no move" — the caller writes nothing, which is what keeps a
   press on a grip that never travelled from producing a write. */

/** `id` removed and reinserted beside `targetId`: after it when it was above,
 *  before it when it was below. That is the direction the pointer was travelling,
 *  and the direction "move down one" means, from the same two lines.
 *
 *  The reinsertion is at the target's *pre-removal* index, which is what makes
 *  both directions come out right: removing the moved entry shifts everything
 *  after it one place earlier, so splicing at `to` lands after a target that was
 *  below and before one that was above. */
export function moveRelative(ids: readonly string[], id: string, targetId: string): string[] | null {
  const from = ids.indexOf(id);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return null;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** The same move, one place at a time, for the `⋯` panel's Move up / Move down.
 *  Out of range is `null` rather than a clamp: the menu item is disabled at the
 *  ends, and a clamp would silently turn a stray call into a no-op write. */
export function moveBySteps(ids: readonly string[], id: string, delta: number): string[] | null {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
