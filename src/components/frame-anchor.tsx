"use client";
/* The `+`-and-grip pair, in exactly one place.
   ---------------------------------------------------------------------------
   BlockNote's own side menu is a plus above a six-dot grip, 39x30 split between two
   equal halves, revealed on hover. Every object on a page has it, so every object
   that needs one must render *this* — not a second pair drawn to match.

   It was drawn twice before. The second copy lived in the database's row gutter: same
   two glyphs, same two jobs, hand-rolled buttons and hand-derived geometry, 20x30
   instead of 19.5x30 and grip-then-plus instead of plus-then-grip. Each pixel of
   difference was individually defensible and together they read as a different
   control. `AGENTS.md` records it under "Reuse before you write"; this file is the
   index entry that makes the rule followable.

   Two hosts, two positions:
     - floating (default) — `.frame-anchor`'s own `position: absolute`, hanging off the
       left edge of the block it belongs to. The editor's side menu.
     - `inline` — the host lays the pair out itself (`.frame-anchor--inline`). A
       database row does this so the pair can hang in the page margin *outside* the
       table's own box. */

import type { PointerEvent as ReactPointerEvent, ReactNode, Ref } from "react";
import { AddGlyph, GripGlyph } from "@/components/grip-glyphs";

/** The handlers a grip needs when it is a drag source rather than a button that opens
 *  something. Passed through untouched so the caller owns the gesture. */
export type GripPointerHandlers = {
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
};

export type FrameAnchorProps = {
  /** What the `+` does. Always required: a pair without it is the one object on the
   *  page you cannot add below. */
  onAdd: () => void;
  addLabel: string;
  addTest?: string;
  /** Press of the grip. Omit when the grip is a drag handle (`gripPointer`). */
  onGrip?: () => void;
  gripLabel: string;
  gripTest?: string;
  /** The grip's own state, for `aria-expanded` and the `is-open` tick. */
  gripOpen?: boolean;
  /** Extra class on the grip — `db-grip` for a drag handle, `is-inert` for one that
   *  cannot do its job in this view. */
  gripClass?: string;
  gripPointer?: GripPointerHandlers;
  /** The host positions the pair; it does not float on the block's left edge. */
  inline?: boolean;
  anchorRef?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

export function FrameAnchor({
  onAdd,
  addLabel,
  addTest,
  onGrip,
  gripLabel,
  gripTest,
  gripOpen = false,
  gripClass,
  gripPointer,
  inline = false,
  anchorRef,
  children,
}: FrameAnchorProps) {
  return (
    <div
      className={`frame-anchor${inline ? " frame-anchor--inline" : ""}`}
      ref={anchorRef}
      contentEditable={false}
    >
      {/* Same pair, same order, same size as BlockNote's own side menu: `+` then grip.
          The order is part of the component: a pair rendered grip-then-plus is the
          same two glyphs mirrored, which is how the gutter drifted once already. */}
      <button
        type="button"
        className="frame-grip frame-add"
        aria-label={addLabel}
        title={addLabel}
        data-test={addTest}
        onMouseDown={(event) => {
          // The editor would otherwise move the caret into the block we are acting on.
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onAdd();
        }}
      >
        <AddGlyph />
      </button>
      <button
        type="button"
        className={`frame-grip${gripOpen ? " is-open" : ""}${gripClass ? ` ${gripClass}` : ""}`}
        aria-label={gripLabel}
        title={gripLabel}
        aria-expanded={onGrip ? gripOpen : undefined}
        data-test={gripTest}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={
          onGrip
            ? (event) => {
                event.preventDefault();
                event.stopPropagation();
                onGrip();
              }
            : undefined
        }
        {...gripPointer}
      >
        <GripGlyph />
      </button>
      {children}
    </div>
  );
}
