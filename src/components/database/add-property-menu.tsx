"use client";
/* `+ Add Property` — the table header's one menu.
   ---------------------------------------------------------------------------
   The menu is generated from the registry, not from a list written here: sixteen
   types were asked for, and a menu that has to be edited by hand every time a type
   is added is a menu that will drift from the vocabulary. `resolveProperty(type).label`
   is the same string the column header falls back to, so the menu cannot offer a
   type the table does not know how to draw.

   It renders in a portal, because the table sits in a `overflow-x: auto` box and a
   popover inside that box would be scrolled and clipped by it.
   */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AddGlyph } from "@/components/grip-glyphs";
import { resolveProperty } from "@/lib/database/properties";
import { propertyTypes, type PropertyType } from "@/lib/database/types";

/* Grouped for scanning, not for logic: the order inside a group is the vocabulary's
   order, so the menu reads the same as `types.ts`. A type missing from every group is
   appended rather than hidden — the menu is a view of the registry, and hiding a type
   here would be the drift this file exists to prevent. */
const groups: { title: string; types: PropertyType[] }[] = [
  { title: "Basic", types: ["text", "number", "select", "multiSelect", "status", "date", "checkbox"] },
  { title: "Text & links", types: ["url", "email", "phone", "place", "person"] },
  { title: "Media", types: ["files"] },
  { title: "Computed", types: ["formula", "createdTime", "button"] },
];
const grouped = new Set(groups.flatMap((group) => group.types));
const rest = propertyTypes.filter((type) => !grouped.has(type) && propertyTypes.includes(type));

export function AddPropertyMenu({ onPick }: { onPick: (type: PropertyType) => void }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState({ top: 0, bottom: undefined as number | undefined, left: 0, maxHeight: 420 });
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const box = button.current.getBoundingClientRect();
    /* Sixteen types do not fit in a short window. Rather than let the list run off the
       bottom of the screen, it flips above the header and takes whatever height is
       actually available — the menu is the same element either way. */
    const below = window.innerHeight - box.bottom - 12;
    const above = box.top - 12;
    const flip = below < 260 && above > below;
    setAt({
      top: flip ? 0 : box.bottom + 4,
      bottom: flip ? window.innerHeight - box.top + 4 : undefined,
      left: Math.max(8, Math.min(box.left, window.innerWidth - 248)),
      maxHeight: Math.max(160, Math.min(420, flip ? above : below)),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (menu.current?.contains(event.target as Node) || button.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    /* Capture, for the same reason `useMenuDismiss` uses it: `.db-block` stops presses on
       its inert areas before they bubble. */
    document.addEventListener("mousedown", away, true);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", away, true); document.removeEventListener("keydown", escape); };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className="db-add-property"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Add a property"
        /* Opens on mousedown, not click. This button lives inside BlockNote's editor,
           and the block's own selection handling runs between mousedown and click —
           `preventDefault` keeps the caret out of the block, and toggling here means
           the menu opens even when that handling would have swallowed the click. */
        onMouseDown={(event) => { event.preventDefault(); setOpen((was) => !was); }}
      >
        <AddGlyph />
        {/* Named, not just a glyph (B40g). A bare `+` in a column of icons is the one
            control in the table whose meaning has to be guessed, and the guess is
            "add a row" — which is the button at the foot of the table. */}
        <span>Add property</span>
      </button>
      {open ? createPortal(
        <div className="db-menu" role="menu" ref={menu} style={{ top: at.top || undefined, bottom: at.bottom, left: at.left, maxHeight: at.maxHeight }}>
          {[...groups, ...(rest.length ? [{ title: "More", types: rest }] : [])].map((group) => (
            <div className="db-menu-group" key={group.title}>
              <p className="db-menu-title">{group.title}</p>
              {group.types.map((type) => (
                <button
                  key={type}
                  type="button"
                  role="menuitem"
                  className="db-menu-item"
                  /* Chosen on mousedown, for the same reason the header's `+` opens on
                     mousedown: the menu lives in this editor, and anything that waits
                     for `click` has a BlockNote handler in between that can move the
                     selection and take the click with it. */
                  onMouseDown={(event) => { event.preventDefault(); setOpen(false); onPick(type); }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setOpen(false);
                    onPick(type);
                  }}
                >
                  {resolveProperty({ type }).label}
                </button>
              ))}
            </div>
          ))}
        </div>,
        document.body,
      ) : null}
    </>
  );
}
