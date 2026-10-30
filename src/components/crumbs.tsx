"use client";
/* Raspberry — breadcrumb trail (B24)
   ---------------------------------------------------------------------------
   The trail is chrome, not document. It sits on its own row in `.topbar`,
   directly under the tab strip, and does not scroll away with the page.

   That is a reversal of the first build, which put the trail at the top of the
   document. Two things were wrong with that and only one of them was taste:

   - Placement: the document is a centred 708px column, so on a wide window the
     trail floated far to the right of the tab strip, reading as a caption on
     the page rather than as "you are here" on the tab you just opened.
   - Honesty: an ancestor path is navigation between the page and its parent.
     Scrolling it off the top removes it exactly when a long document makes it
     useful.

   The cost of pinning it is a second row in the header. That cost used to be
   avoided by hiding the row at the root, but the row now carries the page you
   are on, so a root page shows one crumb instead of nothing. A page that is not
   in the loaded list yet still renders nothing — there is no title to show.

   Clicking a crumb reuses the current tab, matching the sidebar rule from B22.
   Ctrl/Cmd/Shift-click appends, so a trail can be walked without losing the
   page you started on. An ancestor that is already open in another tab is
   activated rather than duplicated — `openTab` handles that.

   The last crumb is the current page and is deliberately not a control. */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { COLLAPSE_AT, COLLAPSE_AT_NARROW, collapseTrail, crumbTrail, type Crumb } from "@/lib/crumbs";
import type { PageSummary } from "@/lib/document";

/** Matches the point where the tab strip also gives up detail (`tabs.css`). */
const NARROW = "(max-width: 560px)";

type Props = {
  pageId: string;
  pages: readonly PageSummary[];
  onOpen: (id: string, mode?: "replace" | "append") => void;
};

export default function Crumbs({ pageId, pages, onOpen }: Props) {
  const trail = crumbTrail(pages, pageId);
  const [budget, setBudget] = useState(COLLAPSE_AT);
  const { head, hidden, tail } = collapseTrail(trail, budget);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const query = window.matchMedia(NARROW);
    const sync = () => setBudget(query.matches ? COLLAPSE_AT_NARROW : COLLAPSE_AT);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  /* A floating menu is dismissed by the next press anywhere, on resize, or on
     Escape. Same contract as the tab menu, so the two feel like one product. */
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(null); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", key);
    };
  }, [menu]);

  if (!trail.length) return null;

  const open = (event: React.MouseEvent, id: string) => {
    setMenu(null);
    const append = event.metaKey || event.ctrlKey || event.shiftKey;
    onOpen(id, append ? "append" : "replace");
  };

  const crumb = (item: Crumb) => (
    <li key={item.id} className={`crumb-slot${item.current ? " is-current" : ""}`}>
      {item.current ? (
        /* Not a button: you are already on this page, so a control here would
           be a dead end. `aria-current` is what says "this is you" to a screen
           reader, which is the whole job of the last crumb. */
        <span className="crumb is-current" title={item.title} aria-current="page">{item.label}</span>
      ) : (
        <button
          type="button"
          className="crumb"
          title={item.title}
          onMouseDown={(event) => { if (event.button === 1) event.preventDefault(); }}
          onClick={(event) => open(event, item.id)}
          onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); setMenu(null); onOpen(item.id, "append"); } }}
        >
          {item.label}
        </button>
      )}
    </li>
  );

  return (
    <div className="subbar">
      <nav className="crumbs" aria-label="Breadcrumb">
        <ol className="crumb-list">
          {head.map(crumb)}

          {hidden.length > 0 && (
            <li className="crumb-slot is-more">
              <button
                type="button"
                className="crumb is-more"
                aria-label={`${hidden.length} hidden parent page${hidden.length > 1 ? "s" : ""}`}
                aria-haspopup="menu"
                aria-expanded={menu !== null}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setMenu(menu ? null : { x: rect.left, y: rect.bottom + 6 });
                }}
              >
                <MoreHorizontal size={13} />
              </button>
            </li>
          )}

          {tail.map(crumb)}
        </ol>
      </nav>

      {/* Portalled to the body on purpose. `.topbar` carries a `backdrop-filter`,
          and a filtered ancestor becomes the containing block for `position:
          fixed` descendants — the menu is placed from viewport coordinates
          (`getBoundingClientRect`), so inside the header it would have landed a
          full sidebar-width to the right. */}
      {menu && createPortal(
        <div
          className="crumb-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          /* Without this the window listener closes the menu on pointerdown,
             before the click on an item can land. */
          onPointerDown={(event) => event.stopPropagation()}
        >
          {hidden.map((item) => (
            <button key={item.id} type="button" role="menuitem" className="menu-item" onClick={(event) => open(event, item.id)}>
              {item.title}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
