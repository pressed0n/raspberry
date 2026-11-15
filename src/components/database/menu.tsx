"use client";
/* Menu primitives.
   ---------------------------------------------------------------------------
   Every database menu (the property menu, `+` Add property, the icon picker) used to
   hand-roll its own portal, its own placement maths and its own item markup. The
   property menu is about to grow — access, type, filter, sort, calculate, freeze, hide,
   insert, duplicate, delete — and hand-rolled meant that every new row was new markup,
   new positioning and a new way to be inconsistent.

   So: one surface, one item, one divider, one submenu. Adding a row to a menu is now
   one `<MenuItem>` instead of a block of JSX. That is the whole point of this file.

   Placement is `position: fixed` from `getBoundingClientRect()` because these menus are
   opened from inside a table that scrolls horizontally — an absolutely positioned menu
   would be clipped by the scroll wrapper's `overflow`.
   --------------------------------------------------------------------------- */
import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { ChevronRight, ArrowLeft } from "lucide-react";
/* The viewport gutter is `menu-place.ts`'s, not a second 8 written here: that module
   already pins every dropdown in the app 8px from the edge, and a menu that respected a
   different margin would look like it belonged to a different product. */
import { GUTTER } from "@/lib/menu-place";

const GAP = 6;
const EDGE = GUTTER;
/* Two numbers, and every dropdown in the database uses one of them: a menu is 252 wide and
   a submenu that flies out to its side is 200. They used to be four numbers spread over
   three files and an inline prop — 240 in the stylesheet, 252 in a rule that lost to it,
   268 at the property header, 272 in the tag dropdown — so "how wide is a dropdown" had no
   answer, and the widest of them was a cell menu. A control that appears in the same
   product as three others should be the same box. */
const MENU_WIDTH = 252;
const SUBMENU_WIDTH = 200;
const MIN_BELOW = 220;
/* The least a side submenu is allowed to show of itself. Below this it stops tracking its
   row's top edge and sits up against the bottom of the window instead, because a menu that
   is anchored perfectly and half off-screen is worse than one that is merely offset. */
const MIN_TALL = 160;

/**
 * Where a menu should sit, given the thing that opened it.
 *
 * Deliberately *not* `placeMenu` from `menu-place.ts`, for two reasons that module states
 * in its own header. It places a menu of known height, while these menus are height-clamped
 * (`max-height` + scroll) because the property menu will keep growing; and it has no
 * horizontal flip on purpose, while a submenu flies out to the right of its row and must
 * flip left when the window is narrow. What is shared — the 8px gutter — is imported.
 */
export function menuStyle(anchor: DOMRect, width: number, maxHeight: number, side: "below" | "right" = "below", preferHeight?: number): CSSProperties {
  if (side === "right") {
    const flipLeft = anchor.right + GAP + width > window.innerWidth - EDGE;
    /* The vertical reserve used to be a flat 120px, which assumed every submenu was
       short. The tag colour list is 408px, so on a 1440x900 window (a 1378x802 viewport)
       its lower half — including the last colour — sat below the fold and could not be
       clicked: `elementFromPoint` there answers `null`, because it is off-screen.
       So the panel is capped to the room that actually remains and scrolls inside
       itself, and it only leaves its row's top edge when the room is under 160px. */
    const top = Math.max(EDGE, Math.min(anchor.top - 4, window.innerHeight - EDGE - 120));
    const roomBelow = window.innerHeight - EDGE - top;
    const left = flipLeft ? Math.max(EDGE, anchor.left - GAP - width) : anchor.right + GAP;
    /* A caller that says how tall it is gets the other way out of the same squeeze: rather
       than sitting at the row's top edge and scrolling, the surface hangs from the row's
       *bottom* edge and grows upward. The date picker's `Date format` list needs this — its
       row is the last one in a 370px panel, so it had 160px of window left and five of its
       nine rows were under the fold. Only a caller that states `preferHeight` takes this
       path; every other submenu keeps the top-anchored behaviour its probes measure. */
    if (preferHeight !== undefined && roomBelow < Math.min(preferHeight, maxHeight)) {
      /* Both edges clamped: `MIN_TALL` of the window has to remain under the surface's bottom
         edge, and its top edge has to stay above the gutter, or the "other way out" would be a
         different way off-screen. */
      const bottom = Math.min(
        Math.max(EDGE, window.innerHeight - anchor.bottom),
        window.innerHeight - EDGE - MIN_TALL,
      );
      return {
        left,
        bottom,
        width,
        maxHeight: Math.max(MIN_TALL, Math.min(maxHeight, window.innerHeight - EDGE - bottom)),
      };
    }
    /* The clamp that keeps a squeezed submenu on screen when its row is right against the
       bottom: move it up until it has `MIN_TALL` of window, and let it scroll. */
    if (roomBelow < MIN_TALL) {
      const lifted = Math.max(EDGE, window.innerHeight - EDGE - MIN_TALL);
      return {
        left,
        top: lifted,
        width,
        maxHeight: Math.max(MIN_TALL, Math.min(maxHeight, window.innerHeight - EDGE - lifted)),
      };
    }
    return {
      left,
      top,
      width,
      maxHeight: Math.max(MIN_TALL, Math.min(maxHeight, roomBelow)),
    };
  }
  const prefer = preferHeight ?? MIN_BELOW;
  const below = window.innerHeight - anchor.bottom - EDGE;
  const above = anchor.top - EDGE;
  /* `preferHeight` is the point at which the surface would rather be somewhere else — the
     date picker is ~390px tall and knows it, so a cell near the bottom of the window gets the
     surface *above* it instead of a scrolled one with its two toggles under the fold. A menu
     of rows keeps the old 220, because it is height-clamped and scrolls by design. */
  const flip = below < prefer && above > below;
  return {
    left: Math.max(EDGE, Math.min(anchor.left, window.innerWidth - width - EDGE)),
    ...(flip ? { bottom: window.innerHeight - anchor.top + GAP } : { top: anchor.bottom + GAP }),
    width,
    maxHeight: Math.max(160, Math.min(flip ? above : below, maxHeight)),
  };
}

/**
 * Track an anchor's rect while the menu is open.
 *
 * `useLayoutEffect` and not `useEffect`: the menu must be positioned in the same paint
 * that mounts it, or it flashes at the top-left corner first.
 */
export function useAnchoredStyle(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  { width = MENU_WIDTH, maxHeight = 460, side = "below" as "below" | "right", extra = 0, preferHeight }: {
    width?: number;
    maxHeight?: number;
    side?: "below" | "right";
    extra?: number;
    preferHeight?: number;
  } = {},
): CSSProperties | null {
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const place = () => {
      if (!anchor.current) return;
      setStyle(menuStyle(anchor.current.getBoundingClientRect(), width + extra, maxHeight, side, preferHeight));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, width, maxHeight, side, extra, preferHeight]);

  return open ? style : null;
}

/**
 * Close on Escape or on a press outside every popover.
 *
 * The outside test is `closest("[data-db-popover]")` rather than `!ref.contains(target)`
 * because a submenu renders in its own portal: a ref-based check would treat a click
 * inside the submenu as "outside the menu" and close the thing the user just reached for.
 *
 * The mousedown listener is registered one task late, and that is load-bearing. Menus open
 * on `mousedown`; React flushes this effect synchronously *inside* that same dispatch, so a
 * listener added immediately would be on `document` by the time the press finishes bubbling
 * and would close the menu the press just opened. The symptom is a menu that never appears —
 * and, because a scripted `dispatchEvent` does not reproduce the flush ordering, one that
 * every synthetic test passes.
 */
export function useMenuDismiss(open: boolean, onClose: () => void, keep?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest("[data-db-popover]")) return;
      /* `keep` is the *anchor* — the control the surface hangs off. Every other menu here is
         opened by a button that toggles, so letting the press close it and the click reopen
         it is a toggle. The place cell is different: its anchor is the text field the person
         is typing into, and a press there is how a caret is placed mid-word. Without this,
         every second press inside the field would dismiss the results of the search that
         field had just performed. */
      if (keep?.current?.contains(target as Node)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    /* Capture, not bubble (B40g). `.db-block` stops presses on its inert areas in the
       capture phase — a press that lands on the table's background or its filler column
       never reaches the editor, and it would never bubble up to `document` either. A menu
       that could not be dismissed by clicking the table beside it would be a menu that
       traps. Capture runs before the block's guard, so this listener hears every press. */
    const armed = setTimeout(() => document.addEventListener("mousedown", onDown, true), 0);
    return () => {
      clearTimeout(armed);
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
}

/** Arrow-key traversal for any menu surface. Enter/Space are native button behaviour.
    A key pressed *in a field* belongs to the field: the tag menu's search box and the
    property menu's name input both live inside a surface, and swallowing their arrows
    to move focus to a menu row would take the caret away mid-word. */
function onMenuKeys(event: React.KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  if ((event.target as Element | null)?.closest("input, textarea, select, [contenteditable]")) return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-menuitem]:not([disabled])")];
  if (!items.length) return;
  event.preventDefault();
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === "Home" ? 0
    : event.key === "End" ? items.length - 1
    : event.key === "ArrowDown" ? (at + 1) % items.length
    : (at <= 0 ? items.length - 1 : at - 1);
  items[next]?.focus();
}

/** The floating surface. Rendered in a portal so no ancestor can clip it. */
export function MenuSurface({
  anchor,
  open,
  onClose,
  width = MENU_WIDTH,
  className = "",
  side = "below",
  maxHeight = 460,
  /* What the surface *is*, for assistive tech. `menu` is right for a list of actions; a
     surface that contains a calendar and two fields is a `dialog`, and calling it a menu
     would announce a text field as a menu item's sibling. `listbox` is the place cell's
     results: focus never leaves its field, so the rows are options a *combobox* points at,
     and calling them menu items would announce a list of places as a list of commands. */
  role = "menu",
  id,
  preferHeight,
  children,
  ref,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose?: () => void;
  width?: number;
  className?: string;
  side?: "below" | "right";
  maxHeight?: number;
  role?: "menu" | "dialog" | "listbox";
  /* The `id` a combobox's `aria-controls` names. Every other caller can omit it. */
  id?: string;
  /* How tall the surface wants to be, when it knows. Under this much room below, it flips
     above the anchor instead of scrolling — the date picker's calendar plus its two toggles
     do not survive being cut in half. Omitted, a menu keeps the 220px threshold. */
  preferHeight?: number;
  children: ReactNode;
  /* The node itself, for the one caller that needs to measure it: `MenuSub` asks where the
     surface landed so it can tell a pointer crossing into it from a pointer walking away. */
  ref?: React.Ref<HTMLDivElement>;
}) {
  const style = useAnchoredStyle(open, anchor, { width, maxHeight, side, preferHeight });
  if (!open || !style || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      data-db-popover=""
      id={id}
      role={role}
      className={`db-menu ${className}`.trim()}
      style={style}
      onKeyDown={onMenuKeys}
      /* Suppress the default press so opening a menu doesn't blur the cell or column you
         opened it from — but never suppress it over a field, or the name input could not
         be clicked into. */
      onMouseDown={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("input, textarea, select, [contenteditable]")) return;
        event.preventDefault();
      }}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuDivider() {
  return <div className="db-menu-divider" role="separator" />;
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return <p className="db-menu-title">{children}</p>;
}

/**
 * The head of a *pane* — a surface whose body was replaced rather than opened beside it.
 *
 * There is one implementation because the arrow is the one control in this app that must not
 * drift: it is `.db-prop-icon-btn`'s base plus the `.db-menu-back` modifier (chrome dropped,
 * geometry kept), it says where you are going back *to* in its label, and it sits on the same
 * two-pixel padding as `.db-prop-head`, so swapping a menu's body for a pane does not move the
 * head by a pixel. The status groups pane and the date picker's format list both render this.
 */
export function MenuPaneHead({ title, back = "Back", onBack }: { title: string; back?: string; onBack: () => void }) {
  return (
    <div className="db-pane-head">
      {/* `autoFocus` because opening a pane *removes the row that was focused*: without it
          `document.activeElement` falls back to `<body>`, which is outside the surface, so the
          arrow-key traversal below never hears another press and the pane is keyboard-dead. */}
      <button type="button" className="db-prop-icon-btn db-menu-back" title={back} aria-label={back} onClick={onBack} autoFocus>
        <ArrowLeft size={15} aria-hidden />
      </button>
      <span className="db-pane-title">{title}</span>
    </div>
  );
}

/** Put the keyboard back on the row that opened a pane.
 *
 *  The other half of the same fact: `Back` removes the back button, so focus would land on
 *  `<body>` again. Called after the body has swapped back — the row only exists once it has. */
export function focusMenuRow(key: string) {
  document.querySelector<HTMLElement>(`[data-db-popover] [data-menu-key="${key}"]`)?.focus();
}

export function MenuItem({
  icon,
  label,
  hint,
  check,
  danger,
  disabled,
  caret,
  focusKey,
  onSelect,
  trailing,
  role = "menuitem",
}: {
  icon?: ReactNode;
  label: string;
  hint?: string;
  check?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /* A row that replaces the surface's body — the date picker's `Date format`, the property
     menu's `Status groups` — says so with the same caret a fly-out submenu wears, because
     the gesture is the same promise: there is more behind this word. Both stay 13px and in
     one column whichever the row also carries a value in. */
  caret?: boolean;
  /* Names the row so the pane it opened can put the keyboard back on it. `focusMenuRow`. */
  focusKey?: string;
  onSelect?: () => void;
  trailing?: ReactNode;
  /* `button`, for the rows of a surface that is a `dialog` rather than a `menu` — the
     date picker's `End date` / `Include time` toggles. The row is still a button and
     still a menu row; only the announcement changes. */
  role?: "menuitem" | "button";
}) {
  return (
    <button
      type="button"
      role={role}
      data-menuitem=""
      data-menu-key={focusKey}
      disabled={disabled}
      title={hint}
      className={`db-menu-item db-menu-row${danger ? " db-menu-danger" : ""}${disabled ? " is-disabled" : ""}`}
      onClick={onSelect}
    >
      {icon ? <span className="db-menu-icon">{icon}</span> : null}
      <span className="db-menu-label">{label}</span>
      {/* The sample first, the tick last: an item that both shows what it renders and is
          the current setting reads "1,234 ✓", and the tick stays in one column whichever
          items carry a sample. A bare text node here would sit under the label instead,
          which is why this is the same `.db-menu-value` the submenu rows use. */}
      {trailing ? <span className="db-menu-value">{trailing}</span> : null}
      {caret ? <ChevronRight size={13} className="db-menu-caret" aria-hidden /> : null}
      {check ? <span className="db-menu-check" aria-hidden>✓</span> : null}
    </button>
  );
}

/* One submenu at a time, app-wide.
   ---------------------------------------------------------------------------
   Hovering a sibling row has to *exchange* surfaces instantly rather than stack two, and
   the rows are independent components inside one menu with no shared state to say which is
   open. This is the smallest thing that carries that fact; it lives at module scope because
   the alternative is threading a context through every menu for one boolean. */
let activeSub: { anchor: HTMLElement; close: () => void } | null = null;

/** The surface's edge that faces the row — the base of the safe triangle below. */
function nearEdge(panel: DOMRect, row: DOMRect) {
  return panel.left >= row.right
    ? { x: panel.left, top: panel.top, bottom: panel.bottom }
    : { x: panel.right, top: panel.top, bottom: panel.bottom };
}

/**
 * Amazon's "safe triangle", which every menu that flies out to the side has had for
 * twenty-five years: a pointer inside the triangle between where it last was on the row
 * and the near edge of the surface is on its way here, and nothing may dismiss it.
 *
 * Without it, the corridor in `MenuSub` only helps a crossing that is *horizontal*. Reach
 * for the second or third item of a submenu and the hand travels right and down at once,
 * leaving the row's 32px band while still ~60px inside the parent — where "not on the row"
 * fired and the surface vanished. That is the same complaint as the 6px gap, one dimension
 * later, and it lands on the rows people reach for most: everything below the first item.
 */
function inSafeTriangle(x: number, y: number, apex: { x: number; y: number }, edge: ReturnType<typeof nearEdge>): boolean {
  const half = (ax: number, ay: number, bx: number, by: number) => (x - bx) * (ay - by) - (ax - bx) * (y - by);
  const sides = [
    half(apex.x, apex.y, edge.x, edge.top),
    half(edge.x, edge.top, edge.x, edge.bottom),
    half(edge.x, edge.bottom, apex.x, apex.y),
  ];
  return !(sides.some((side) => side < 0) && sides.some((side) => side > 0));
}

/**
 * A row that opens a second surface.
 *
 * Hover opens it (matches every menu a person already knows); focus and click open it
 * too, so it is reachable by keyboard and on a touch screen, where hover never fires.
 */
export function MenuSub({
  icon,
  label,
  trailing,
  disabled,
  role = "menuitem",
  preferHeight,
  children,
}: {
  icon?: ReactNode;
  label: string;
  trailing?: ReactNode;
  disabled?: boolean;
  /* `button`, for a submenu row that lives in a surface which is a `dialog` rather than a
     `menu` — the date picker's `Date format`. Every other row of that surface is a button,
     and one row announcing itself as a menu item inside a dialog is a lie about the list
     around it. Same reason `MenuItem` has this prop. */
  role?: "menuitem" | "button";
  /* How tall the list is. Stated only by a submenu that would otherwise be squeezed against
     the bottom of the window — the date picker's format list, whose row is the last in a tall
     panel. It then hangs from the row's bottom edge and grows upward instead of scrolling. */
  preferHeight?: number;
  children: ReactNode;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useMenuDismiss(open, close);

  /* Where the pointer last was *on the row*: the apex of the safe triangle, and null until
     it has been there at all, so a submenu opened by focus or by a tap has no triangle. */
  const approach = useRef<{ x: number; y: number } | null>(null);

  /* Opening also closes whichever submenu was open before it. That is what keeps the
     sibling exchange instant now that the triangle can overlap a neighbouring row: one
     surface is up at any moment, and it is always the one the pointer is over. */
  const openSelf = useCallback(() => {
    const self = anchor.current;
    if (!self) return;
    if (activeSub && activeSub.anchor !== self) activeSub.close();
    activeSub = { anchor: self, close };
    setOpen(true);
  }, [close]);

  /* Open on `click` and never toggle.
     A touch screen delivers a whole sequence for one tap — pointerover, `mouseenter`,
     focus, then `click`. With a toggle, the `click` closed the surface the `mouseenter`
     had just opened, so a submenu could not be used with a finger at all. Opening is
     idempotent; moving away, Escape and a press anywhere else are what close it.

     WHAT CLOSES IT, AND WHY IT IS NOT `mouseleave`
     ---------------------------------------------------------------------------
     This used to close on the wrapper's `mouseleave`, on the reasoning that the portal is
     a *React child* of the wrapper even though it is not a DOM child, so React's
     enter/leave tracking would not see a crossing into it. That part is true — and it is
     not the problem. The surface is placed `GAP` (6px) off the row's edge, and the strip in
     between is *neither* box: the topmost element there is the parent `.db-menu` itself,
     which is an ancestor, so React fires the wrapper's `mouseleave` and the surface
     unmounts before the pointer can arrive.

     Measured at 1400x900, one pointer sample per pixel: row right edge 1034, surface left
     edge 1040, `document.elementFromPoint(1035..1039)` → `div.db-menu.db-prop-menu`. The
     first sample past 1034 kills it. A flick sends one sample that lands past the strip
     and survives, which is why this looked like "70% of the time" — it was never random,
     it was cursor speed, and it is why the old probe (four hops, the first already inside
     the surface) passed on the broken code. `scripts/verify-db-submenu-hover.mjs` is the
     probe that does not.

     So the rule is now positional rather than event-shaped: while a submenu is open, it
     closes on the first pointer move that is on neither its row, its surface, nor the
     strip between them. The strip is a corridor, not a gap: a pointer crossing it is by
     definition on its way here, and one that drifts to another row is not in the corridor
     (every row ends at the row's right edge), so siblings still exchange instantly instead
     of briefly showing two surfaces.

     THE SAME BUG ONE DIMENSION LATER
     ---------------------------------------------------------------------------
     The corridor only helps a crossing that is *horizontal*. A hand reaching for the second
     item of a submenu travels right and down at once, and leaves the row's 32px band while
     still ~60px inside the parent — neither row, nor surface, nor corridor — so the surface
     closed on a gesture that was unmistakably on its way here. That is every submenu item
     below the first, which is most of them. `inSafeTriangle` above is the fix, and the
     direction test beside it is what keeps a hand heading *away* closing the menu, so
     "hover a plain sibling row" still means what it did. */
  useEffect(() => {
    if (!open) return;
    const onMove = (event: PointerEvent) => {
      const row = anchor.current;
      const panel = surface.current;
      if (!row || !panel) return;
      const r = row.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      const { clientX: x, clientY: y } = event;
      const within = (b: DOMRect) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
      /* The strip, whichever side the surface flipped to. One pixel of slack each way so
         rounding cannot leave a sub-pixel dead column; the vertical span is the two boxes
         together, so a diagonal approach to the top of a tall surface stays inside it. */
      const [stripLeft, stripRight] = p.right <= r.left ? [p.right, r.left] : [r.right, p.left];
      const inStrip =
        x >= stripLeft - 1 &&
        x <= stripRight + 1 &&
        y >= Math.min(r.top, p.top) - 2 &&
        y <= Math.max(r.bottom, p.bottom) + 2;
      if (within(r)) {
        /* The last position on the row is the apex of the triangle formed below. */
        approach.current = { x, y };
        return;
      }
      if (within(p) || inStrip) return;
      /* On its way here: inside the triangle from that apex to the surface's near edge,
         and moving toward that edge rather than away from it. The direction is what keeps
         "hover a sibling row" closing — a hand heading left or straight down is not
         reaching for this surface, and the sibling's own `openSelf` takes over anyway. */
      const from = approach.current;
      if (from && Math.sign(x - from.x) === Math.sign((p.left >= r.right ? p.left : p.right) - from.x)
        && inSafeTriangle(x, y, from, nearEdge(p, r))) return;
      close();
    };
    /* Capture, so a row that stops propagation cannot hide the pointer's departure. Passive,
       because nothing here may cancel a scroll. */
    window.addEventListener("pointermove", onMove, { capture: true, passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove, { capture: true });
      /* Whoever is open owns the pointer; a submenu that unmounts or is closed by Escape
         must not leave its anchor registered as the one surface on screen. */
      if (activeSub?.anchor === anchor.current) activeSub = null;
    };
  }, [open, close]);

  return (
    <div className="db-menu-sub">
      <button
        ref={anchor}
        type="button"
        role={role}
        data-menuitem=""
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`db-menu-item db-menu-row${disabled ? " is-disabled" : ""}`}
        onMouseEnter={openSelf}
        onFocus={openSelf}
        onClick={openSelf}
      >
        {icon ? <span className="db-menu-icon">{icon}</span> : null}
        <span className="db-menu-label">{label}</span>
        {trailing ? <span className="db-menu-value">{trailing}</span> : null}
        <ChevronRight size={13} className="db-menu-caret" aria-hidden />
      </button>
      <MenuSurface ref={surface} anchor={anchor} open={open} onClose={close} width={SUBMENU_WIDTH} side="right" preferHeight={preferHeight}>
        {children}
      </MenuSurface>
    </div>
  );
}
