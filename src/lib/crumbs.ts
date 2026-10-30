/* Raspberry — breadcrumb trail (B24)
   ---------------------------------------------------------------------------
   The trail is the path of the open page: ancestors on the left, the page you
   are on as the final crumb on the right. The current page is marked, not
   linked — you are already there, so it is a label rather than a target. A root
   page therefore renders exactly one crumb: itself.

   Titles are cut to CRUMB_MAX_CHARS here rather than by CSS. A pixel cap
   truncated earlier on a phone than on a desktop, which is what made the trail
   feel arbitrarily sliced; a character count cuts in the same place at every
   width. CSS still ellipsises as a last resort when a narrow row genuinely
   cannot fit the crumbs it has — that is overflow, not the rule.

   Pure on purpose — no React, no DOM. The rules that are easy to get wrong are
   all here, so a test can state them: cycles in corrupt data, an ancestor that
   is not in the loaded list (trashed, or not yet fetched), a blank title.

   The list arrives already flat (`PageSummary[]`), carrying `parentId`, so the
   trail is a walk over an in-memory index. No request, no loading state. */

export type CrumbSource = { id: string; parentId: string | null; title: string };
export type Crumb = {
  id: string;
  /** The untruncated title, kept for the hover tooltip. */
  title: string;
  /** What the crumb actually shows. */
  label: string;
  /** The page you are on: rendered as text, not as a link. */
  current: boolean;
};

/** A corrupt `parentId` chain must not hang the render. */
export const MAX_DEPTH = 12;

/** Above this many slots the middle collapses behind a menu. */
export const COLLAPSE_AT = 4;

/** Narrow screens get one fewer visible slot. */
export const COLLAPSE_AT_NARROW = 3;

/** How many characters a crumb shows before it truncates. Fixed rather than
    responsive on purpose — see the note at the top of this file. */
export const CRUMB_MAX_CHARS = 25;

const label = (title: string): string => title.trim() || "Untitled";

/** A crumb's display text: the title, cut to `max` characters with an ellipsis.

    Counted in code points via spread rather than `slice`, so an emoji in a
    title cannot be sliced down the middle into a replacement character. A
    title that is exactly `max` long is not truncated — the cut only happens
    past the limit. */
export function crumbLabel(title: string, max = CRUMB_MAX_CHARS): string {
  const glyphs = [...label(title)];
  if (glyphs.length <= max) return glyphs.join("");
  return `${glyphs.slice(0, max).join("").trimEnd()}…`;
}

/**
 * The trail for `id`: ancestors root-first, then the page itself.
 *
 * Stops at the first ancestor that is missing from `pages` — a trashed or
 * still-loading parent ends the trail rather than inventing a gap. A cycle
 * stops at the first repeat, so the trail is always finite and ordered. An
 * empty list (page not fetched yet) yields nothing, and the row is not drawn.
 */
export function crumbTrail(
  pages: readonly CrumbSource[],
  id: string | null,
  limit = MAX_DEPTH
): Crumb[] {
  if (!id) return [];
  const byId = new Map(pages.map((page) => [page.id, page]));
  const start = byId.get(id);
  if (!start) return [];

  const seen = new Set<string>([id]);
  const ancestors: Crumb[] = [];
  let parentId = start.parentId;

  while (parentId && ancestors.length < limit && !seen.has(parentId)) {
    const parent = byId.get(parentId);
    if (!parent) break;
    seen.add(parentId);
    ancestors.unshift({
      id: parent.id,
      title: label(parent.title),
      label: crumbLabel(parent.title),
      current: false,
    });
    parentId = parent.parentId;
  }

  return [...ancestors, {
    id: start.id,
    title: label(start.title),
    label: crumbLabel(start.title),
    current: true,
  }];
}

/**
 * Splits a trail into the parts a row can show.
 *
 * The first slot is kept because it is the top of the hierarchy — the one fact
 * that tells you where you are. The last two are kept because they are the
 * immediate parent and (after assembly) the page itself. Everything between
 * folds into the menu.
 *
 * The budget counts *ancestors*, and the current page is appended outside it.
 * That is deliberate: the row shows "you are here" without taking a slot away
 * from the path that got you here, so adding the current crumb did not make the
 * trail one ancestor shallower on a phone.
 */
export function collapseTrail(
  trail: readonly Crumb[],
  max = COLLAPSE_AT
): { head: Crumb[]; hidden: Crumb[]; tail: Crumb[] } {
  const self = trail.at(-1)?.current ? trail[trail.length - 1] : null;
  const ancestors = self ? trail.slice(0, -1) : [...trail];

  if (max < 3 || ancestors.length <= max) {
    return { head: ancestors, hidden: [], tail: self ? [self] : [] };
  }
  const tailStart = ancestors.length - (max - 2);
  return {
    head: ancestors.slice(0, 1),
    hidden: ancestors.slice(1, tailStart),
    tail: self ? [...ancestors.slice(tailStart), self] : ancestors.slice(tailStart),
  };
}
