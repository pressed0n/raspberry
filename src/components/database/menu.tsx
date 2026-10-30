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
import { ChevronRight } from "lucide-react";
/* The viewport gutter is `menu-place.ts`'s, not a second 8 written here: that module
   already pins every dropdown in the app 8px from the edge, and a menu that respected a
   different margin would look like it belonged to a different product. */
import { GUTTER } from "@/lib/menu-place";

const GAP = 6;
const EDGE = GUTTER;
const SUBMENU_WIDTH = 200;
const MIN_BELOW = 220;

/**
 * Where a menu should sit, given the thing that opened it.
 *
 * Deliberately *not* `placeMenu` from `menu-place.ts`, for two reasons that module states
 * in its own header. It places a menu of known height, while these menus are height-clamped
 * (`max-height` + scroll) because the property menu will keep growing; and it has no
 * horizontal flip on purpose, while a submenu flies out to the right of its row and must
 * flip left when the window is narrow. What is shared — the 8px gutter — is imported.
 */
export function menuStyle(anchor: DOMRect, width: number, maxHeight: number, side: "below" | "right" = "below"): CSSProperties {
  if (side === "right") {
    const flipLeft = anchor.right + GAP + width > window.innerWidth - EDGE;
    return {
      left: flipLeft ? Math.max(EDGE, anchor.left - GAP - width) : anchor.right + GAP,
      top: Math.min(anchor.top - 4, window.innerHeight - EDGE - 120),
      width,
      maxHeight,
    };
  }
  const below = window.innerHeight - anchor.bottom - EDGE;
  const above = anchor.top - EDGE;
  const flip = below < MIN_BELOW && above > below;
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
  { width = 252, maxHeight = 460, side = "below" as "below" | "right", extra = 0 } = {},
): CSSProperties | null {
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const place = () => {
      if (!anchor.current) return;
      setStyle(menuStyle(anchor.current.getBoundingClientRect(), width + extra, maxHeight, side));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, width, maxHeight, side, extra]);

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
export function useMenuDismiss(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest("[data-db-popover]")) return;
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

/** Arrow-key traversal for any menu surface. Enter/Space are native button behaviour. */
function onMenuKeys(event: React.KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
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
  width = 252,
  className = "",
  side = "below",
  maxHeight = 460,
  children,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose?: () => void;
  width?: number;
  className?: string;
  side?: "below" | "right";
  maxHeight?: number;
  children: ReactNode;
}) {
  const style = useAnchoredStyle(open, anchor, { width, maxHeight, side });
  if (!open || !style || typeof document === "undefined") return null;
  return createPortal(
    <div
      data-db-popover=""
      role="menu"
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

export function MenuItem({
  icon,
  label,
  hint,
  check,
  danger,
  disabled,
  onSelect,
  trailing,
}: {
  icon?: ReactNode;
  label: string;
  hint?: string;
  check?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-menuitem=""
      disabled={disabled}
      title={hint}
      className={`db-menu-item db-menu-row${danger ? " db-menu-danger" : ""}${disabled ? " is-disabled" : ""}`}
      onClick={onSelect}
    >
      {icon ? <span className="db-menu-icon">{icon}</span> : null}
      <span className="db-menu-label">{label}</span>
      {check ? <span className="db-menu-check" aria-hidden>✓</span> : null}
      {trailing}
    </button>
  );
}

/**
 * A row that opens a second surface.
 *
 * Hover opens it (matches every menu a person already knows); focus and click open it
 * too, so it is reachable by keyboard and on a touch screen, where hover never fires.
 */
export function MenuSub({ icon, label, disabled, children }: { icon?: ReactNode; label: string; disabled?: boolean; children: ReactNode }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useMenuDismiss(open, close);

  return (
    <div className="db-menu-sub" onMouseLeave={close}>
      <button
        ref={anchor}
        type="button"
        role="menuitem"
        data-menuitem=""
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`db-menu-item db-menu-row${disabled ? " is-disabled" : ""}`}
        onMouseEnter={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen((was) => !was)}
      >
        {icon ? <span className="db-menu-icon">{icon}</span> : null}
        <span className="db-menu-label">{label}</span>
        <ChevronRight size={13} className="db-menu-caret" aria-hidden />
      </button>
      <MenuSurface anchor={anchor} open={open} onClose={close} width={SUBMENU_WIDTH} side="right">
        {children}
      </MenuSurface>
    </div>
  );
}
