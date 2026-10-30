"use client";
/* Raspberry — sidebar page menu (B25)
   ---------------------------------------------------------------------------
   The portalled `⋯` dropdown that each sidebar row opens.

   Portalled for the same reason the crumb menu is: `.topbar`'s backdrop-filter
   makes it a containing block for fixed children, and the sidebar scrolls — a
   menu anchored inside a scrolling box gets clipped by it. Anchoring to a
   measured rect on <body> costs one layout read and makes both problems go away.

   Placement lives in `lib/menu-place.ts` and is flipped upward when it would
   leave the viewport. Right-aligned by default, because the `⋯` sits at the
   right edge of a 264px sidebar — but the same menu opened by a right-click is
   anchored at the pointer instead (B37), so both entry points share one
   component and one item list rather than forking a second dropdown.
*/

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Ellipsis, ExternalLink, FolderInput, Pencil, Star, Trash2 } from "lucide-react";
import { menuItemsFor, type SidebarVerbId } from "@/lib/sidebar-menu";
import { placeMenu, type MenuAnchor } from "@/lib/menu-place";

const ICONS: Record<SidebarVerbId, typeof Star> = {
  favorite: Star, tab: ExternalLink, rename: Pencil, duplicate: Copy, move: FolderInput, trash: Trash2,
};

export type PageMenuProps = {
  page: { title: string; favorite: boolean };
  /** Read at open time: a button rect for `⋯`, a point for a right-click. */
  anchor: MenuAnchor;
  onPick: (verb: SidebarVerbId) => void;
  onClose: () => void;
};

export default function PageMenu({ page, anchor, onPick, onClose }: PageMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState(false);

  /* Measure after mount, before paint: the height is only known once the items
     exist, and flipping has to happen in the same frame or the menu is seen in
     the wrong place first. */
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const { left, top } = placeMenu(anchor, rect, { width: window.innerWidth, height: window.innerHeight });
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
    setPlaced(true);
  }, [anchor, anchor.x, anchor.y, anchor.width, anchor.height, anchor.align, anchor.gap]);

  useEffect(() => {
    const node = ref.current;
    node?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const down = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
      if (!items.length) return;
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
      items[next].focus();
    };
    /* A menu pinned to viewport coordinates does not travel with the row it
       belongs to, so scrolling or resizing while it is open has to close it —
       the alternative is a menu floating several rows away from its anchor. */
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className="crumb-menu page-menu" role="menu" aria-label={`Options for ${page.title}`} style={{ visibility: placed ? "visible" : "hidden" }}>
      {menuItemsFor(page).map((item) => {
        const Icon = ICONS[item.id];
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={`menu-item${item.danger ? " is-danger" : ""}`}
            onClick={() => onPick(item.id)}
          >
            <Icon size={14} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
