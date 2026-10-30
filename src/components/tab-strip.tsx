"use client";
/* Raspberry — page tabs (B22)
   ---------------------------------------------------------------------------
   Presentation and input only: every state transition is delegated to
   `lib/tabs.ts`, which is where the rules live and where they are tested.

   Two things worth knowing before editing:

   1. With exactly one tab open the strip renders as plain icon + title, with no
      pill and no close button. The affordances appear from the second tab, so a
      single-page session looks like a page header rather than new chrome.
   2. Reordering is live: the strip reports a new order on every pointer move and
      the parent re-renders. The dragged tab keeps its DOM node throughout (React
      keys by page id), so pointer capture and the measurement of neighbours both
      survive the reorder.
   --------------------------------------------------------------------------- */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import type { PageSummary } from "@/lib/document";
import { nearestIndex } from "@/lib/tabs";
import { PageGlyph } from "./page-glyph";

type Props = {
  ids: string[];
  active: string | null;
  pages: PageSummary[];
  /** Page ids with edits the server has not confirmed. */
  dirty: ReadonlySet<string>;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  /** Closes without saving — offered in the context menu only for a dirty tab. */
  onDiscard: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseRight: (id: string) => void;
  /** Opens the "which page?" picker. Not "new page": a second tab is not a second blank document. */
  onOpenPicker: () => void;
  onReorder: (from: number, to: number) => void;
};

type DragState = {
  id: string;
  startX: number;
  active: boolean;
  /** The tab the press started on; the element that takes pointer capture once a drag begins. */
  element: HTMLDivElement;
};

const DRAG_THRESHOLD = 4;

export default function TabStrip({ ids, active, pages, dirty, onActivate, onClose, onDiscard, onCloseOthers, onCloseRight, onOpenPicker, onReorder }: Props) {
  const strip = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const justDragged = useRef(false);
  /* Pointer-down slot centres for the gesture in progress. See `onPointerDown`. */
  const slots = useRef<number[]>([]);
  /* Left edge of every tab as of the previous commit. Drives the reorder FLIP. */
  const previousLeft = useRef<Map<string, number> | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [overflows, setOverflows] = useState(false);
  const solo = ids.length === 1;

  const titleOf = useCallback((id: string) => pages.find((page) => page.id === id) ?? null, [pages]);

  /* The edge fade is only honest while there is something past the edge. */
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    const measure = () => setOverflows(element.scrollWidth > element.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ids, pages]);

  // Keep the active tab in view when it changes by keyboard or by opening from
  // the sidebar — a tab opened off the right edge would otherwise be invisible.
  useEffect(() => {
    const element = strip.current?.querySelector<HTMLElement>(`[data-tab="${active}"]`);
    element?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("resize", close); };
  }, [menu]);

  /* Layout centres, with any in-flight FLIP offset subtracted.
   *
   * `getBoundingClientRect` honours transforms, so mid-glide it reports the
   * position a tab is *passing through*, not the one it is going to. Feeding that
   * back into hit testing makes the tab under the pointer flip between two slots
   * until the glide ends: the reorder moves the tab out from under the cursor,
   * but visually it has not arrived yet, so the next measurement still names the
   * other one. Subtracting the live translate recovers the resting layout, which
   * is what the gesture is actually about. */
  const centres = () =>
    [...(strip.current?.querySelectorAll<HTMLElement>("[data-tab]") ?? [])].map((element) => {
      const box = element.getBoundingClientRect();
      const raw = getComputedStyle(element).transform;
      const offset = raw === "none" ? 0 : new DOMMatrixReadOnly(raw).m41;
      return box.left - offset + box.width / 2;
    });

  /* ---------- reorder FLIP ----------
   * `lib/tabs.ts` owns the order, so a reorder arrives as one React commit and
   * the tabs would teleport. This measures where each tab *was* one commit ago,
   * offsets it back to that spot as an inline transform, then releases the
   * offset so the stylesheet's `transform` transition carries it home.
   *
   * A transition rather than a spring library because a drag re-triggers the
   * reorder on every pointermove once a tab crosses a neighbour: a CSS
   * transition retargets from the current computed value, which is precisely
   * what a continuous drag needs. Nothing carries velocity across the
   * interruption, because this drag is positional — the tab rides in a slot, it
   * is not thrown.
   *
   * New and departing tabs are skipped: they have no previous left edge, and
   * sliding something in from nowhere would imply a move that did not happen. */
  const order = ids.join("|");
  useLayoutEffect(() => {
    const track = strip.current;
    if (!track) return;
    const nodes = [...track.querySelectorAll<HTMLElement>("[data-tab]")];
    const next = new Map<string, number>();
    let moved = false;
    for (const node of nodes) {
      const id = node.dataset.tab ?? "";
      const left = node.getBoundingClientRect().left;
      next.set(id, left);
      const was = previousLeft.current?.get(id);
      if (was === undefined || Math.abs(was - left) < 1) continue;
      node.style.transition = "none";
      node.style.transform = `translateX(${was - left}px)`;
      moved = true;
    }
    previousLeft.current = next;
    if (!moved) return;
    // Commit the offset as the starting style, then drop it in the same frame so
    // the transition has something to travel from.
    void track.offsetWidth;
    for (const node of nodes) {
      node.style.transition = "";
      node.style.transform = "";
    }
  }, [order]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>, id: string) => {
    if (event.button !== 0) return;
    // Ignore presses that start on the close button.
    if ((event.target as HTMLElement).closest("[data-tab-close]")) return;
    /* Capture is deliberately NOT taken here.
     *
     * While a pointer is captured, every pointer event is retargeted to the
     * capturing element — so `pointerup` lands on the tab wrapper instead of the
     * button inside it, and the browser then dispatches `click` at the nearest
     * common ancestor of the press and the release, which is the wrapper. The
     * button's onClick therefore never ran, and clicking a tab did nothing at
     * all. Capture is taken below instead, at the moment a drag actually starts,
     * which leaves an ordinary click as an ordinary click. */
    /* Slot centres are frozen here, once per gesture.
     *
     * Re-read on every move they would be measured *after* the previous swap,
     * and with variable-width tabs each swap relocates the boundaries — so one
     * pointer position can sit in slot 1 or slot 2 depending on the order it is
     * read in. That is a two-cycle: the tab jitters between the last two slots
     * for as long as the pointer travels through the band where both layouts
     * disagree. Measured once, the strip is a fixed left-to-right partition and
     * the target index only ever increases as the pointer moves right.
     *
     * The cost is that the landing slot's visual centre can sit up to half a tab
     * away from the pointer when the tabs are different widths. That is a still
     * frame nobody notices; the jitter is the one they would. */
    slots.current = centres();
    drag.current = { id, startX: event.clientX, active: false, element: event.currentTarget };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    if (!state.active) {
      if (Math.abs(event.clientX - state.startX) < DRAG_THRESHOLD) return;
      state.active = true;
      setDragging(state.id);
      /* Capture now, not on pointerdown: from here the pointer may leave the
         tab, and a drag that stops reporting partway through would jump. */
      try { state.element.setPointerCapture(event.pointerId); } catch { /* Pointer already gone. */ }
    }
    const from = ids.indexOf(state.id);
    if (from === -1) return;
    const to = nearestIndex(slots.current, event.clientX);
    if (to !== from) onReorder(from, to);
  };

  const endDrag = () => {
    if (drag.current?.active) {
      // A drag must not also count as a click on the tab.
      justDragged.current = true;
      window.setTimeout(() => { justDragged.current = false; }, 0);
      setDragging(null);
    }
    drag.current = null;
  };

  /* A press that is released outside the strip never reaches the tab's handler.
     Without this, the drag would stay armed and the next pointermove anywhere
     over a tab would reorder. Registered here rather than on the tab so that it
     also catches pointercancel, which fires when the browser takes the gesture. */
  useEffect(() => {
    const stop = () => endDrag();
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => { window.removeEventListener("pointerup", stop); window.removeEventListener("pointercancel", stop); };
  }, []);

  const activate = (id: string) => {
    if (justDragged.current) return;
    onActivate(id);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, id: string) => {
    const index = ids.indexOf(id);
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const next = ids[(index + (event.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length];
      onActivate(next);
      strip.current?.querySelector<HTMLElement>(`[data-tab="${next}"] button`)?.focus();
    }
  };

  return (
    <div className={`tabstrip${solo ? " is-solo" : ""}${dragging ? " is-dragging" : ""}`} role="tablist" aria-label="Open pages">
      <div className={`tabstrip-track${overflows ? " is-scrollable" : ""}`} ref={strip}>
        {ids.map((id) => {
          const page = titleOf(id);
          const isActive = id === active;
          return (
            <div
              key={id}
              data-tab={id}
              className={`tab${isActive ? " is-active" : ""}${dirty.has(id) ? " is-dirty" : ""}${id === dragging ? " is-dragging" : ""}`}
              onPointerDown={(event) => onPointerDown(event, id)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); onClose(id); } }}
              onContextMenu={(event) => { event.preventDefault(); setMenu({ id, x: event.clientX, y: event.clientY }); }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                className="tab-main"
                title={page?.title || "Untitled"}
                onClick={() => activate(id)}
                onKeyDown={(event) => onKeyDown(event, id)}
              >
                {page && <span className="tab-icon"><PageGlyph icon={page.icon} size={13} /></span>}
                <span className="tab-label">{page?.title || "Untitled"}</span>
                {dirty.has(id) && <span className="tab-dot" aria-label="Unsaved changes" />}
              </button>
              {!solo && (
                <button
                  type="button"
                  data-tab-close
                  className="tab-close"
                  aria-label={`Close ${page?.title || "Untitled"}`}
                  onClick={() => onClose(id)}
                >
                  <X size={12} strokeWidth={2.2} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="tab-new"
        aria-label="Open a page in a new tab"
        title="Open a page… (Alt N for a new page)"
        onClick={onOpenPicker}
      >
        <Plus size={14} strokeWidth={2} />
      </button>

      {menu && createPortal(
        <div className="tab-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" className="menu-item" onClick={() => { onClose(menu.id); setMenu(null); }}>Close</button>
          {dirty.has(menu.id) && (
            <button type="button" className="menu-item is-danger" onClick={() => { onDiscard(menu.id); setMenu(null); }}>
              Close without saving
            </button>
          )}
          <button type="button" className="menu-item" disabled={ids.length < 2} onClick={() => { onCloseOthers(menu.id); setMenu(null); }}>Close others</button>
          <button
            type="button"
            className="menu-item"
            disabled={ids.indexOf(menu.id) === ids.length - 1}
            onClick={() => { onCloseRight(menu.id); setMenu(null); }}
          >
            Close to the right
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
