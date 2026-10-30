/* The six-dot grip and the plus — one definition, used by every gutter.
   ---------------------------------------------------------------------------
   These two glyphs are BlockNote's own side-menu icons, copied path-for-path rather
   than approximated. They existed already, private to `editor/object-menu.tsx`, and the
   database's row gutter re-drew them with lucide's `GripVertical` and `Plus` instead.
   Two shapes for one job is the whole problem: lucide's dots are hairlines where these
   are filled, so a 14px lucide grip sitting beside an 18px filled grip reads as a
   different control, not as the same control at a different size.

   So they live here, at the top of `components/`, next to `page-glyph.tsx` — the other
   file that exists because "the icon for a thing" must have exactly one answer.

   If you are about to draw a grip or a plus anywhere in this app, import this. */

/** The six dots a row, a block or a frame is held by. */
export function GripGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={22} fill="currentColor" stroke="none" aria-hidden focusable="false">
      <path fill="none" d="M0 0h24v24H0V0z" />
      <path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
    </svg>
  );
}

/** The plus that inserts an object directly below the one it hangs next to. */
export function AddGlyph() {
  return (
    <svg viewBox="0 0 1024 1024" width={18} height={22} fill="currentColor" stroke="none" aria-hidden focusable="false">
      <path d="M482 152h60q8 0 8 8v704q0 8-8 8h-60q-8 0-8-8V160q0-8 8-8Z" />
      <path d="M192 474h672q8 0 8 8v60q0 8-8 8H160q-8 0-8-8v-60q0-8 8-8Z" />
    </svg>
  );
}

/* The two glyphs are 18x22 and every host reveals them inside a button of the same
   height, so a gutter, a callout and a block all present the pair identically. The
   button's own dimensions are in the stylesheet (`.gutter-pair`), not here: geometry
   that a dozen call sites have to agree on belongs in one place with the CSS variables
   it uses. */
