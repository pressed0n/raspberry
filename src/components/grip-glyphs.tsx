"use client";
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

/* The grip as a pressable control, in exactly one place.
   ---------------------------------------------------------------------------
   The glyph is only half of a grip. The other half is the button that carries it: the
   `mousedown` that stops a press turning into a text selection, the `is-open`/aria
   pairing, and the pointer handlers a drag needs. `FrameAnchor` had all of that inline,
   so the moment a second host needed a grip on its own — the tag menu's reorder handle —
   copying it was the *only* option, and a copy is how the row gutter ended up with
   lucide's hairlines in the first place.

   So the button is here too. The difference between the pair's grip and a menu row's
   grip is one modifier class — `.db-option-grip` — added *alongside* `.frame-grip`, never
   instead of it: same glyph, same press semantics, same transition and hover lift, a
   different box. That is what "the same control at a different size" means; two shapes
   would be two controls, and a host that replaced the base class would quietly lose three
   of the behaviours the shared rule was carrying. */

import type { PointerEvent as ReactPointerEvent } from "react";

export type GripPointerHandlers = {
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
};

export type GripButtonProps = {
  label: string;
  /** The host's modifier class, applied *alongside* `frame-grip` — never instead of it.
   *  `.db-grip` (the row gutter) and `.db-option-grip` (a menu row) are the two so far.
   *  A host that replaced the base class would lose the shared transition, the hover lift
   *  and the `(hover: none)` visibility, and would look like a different control the moment
   *  the pointer arrived — which is the drift `docs/MAP.md` §4 warns about. */
  extraClass?: string;
  /** Adds `is-open` and `aria-expanded`; only meaningful with `onPress`. */
  open?: boolean;
  onPress?: () => void;
  pointer?: GripPointerHandlers;
  test?: string;
  /** A drag handle is not a menu item: keep it out of the arrow-key ring. */
  tabIndex?: number;
};

export function GripButton({
  label,
  extraClass,
  open = false,
  onPress,
  pointer,
  test,
  tabIndex,
}: GripButtonProps) {
  return (
    <button
      type="button"
      className={`frame-grip${open ? " is-open" : ""}${extraClass ? ` ${extraClass}` : ""}`}
      aria-label={label}
      title={label}
      aria-expanded={onPress ? open : undefined}
      data-test={test}
      tabIndex={tabIndex}
      /* A press must not select the row's text or reach the surface underneath it. */
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={
        onPress
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              onPress();
            }
          : undefined
      }
      {...pointer}
    >
      <GripGlyph />
    </button>
  );
}
