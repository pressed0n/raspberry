"use client";
/* The icon picker.
   ---------------------------------------------------------------------------
   One picker for both things that carry an icon: a property and an entry (an entry is a
   page, so its icon is `pages.icon`). It replaces a 42-cell inline grid that lived inside
   the property menu — too small to find anything, and impossible to reuse for rows.

   Shape follows the reference: a search field with a shuffle beside it, a Recent row, then
   the grid. Recent is per browser (`localStorage`) because it is a convenience, not data:
   losing it costs nothing, and syncing it would mean a table for a scroll position.
   --------------------------------------------------------------------------- */
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Shuffle } from "lucide-react";
import { NO_ICON, PROPERTY_ICONS, searchIcons } from "./property-icons";
import { useAnchoredStyle, useMenuDismiss } from "./menu";

const RECENT_KEY = "raspberry:recent-icons";
const RECENT_MAX = 8;
const WIDTH = 320;
const MAX_HEIGHT = 420;

function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((n) => typeof n === "string" && PROPERTY_ICONS[n]).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function remember(name: string) {
  try {
    const next = [name, ...readRecent().filter((n) => n !== name)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* Private mode. A missing recent list is not worth an error. */
  }
}

export function IconPicker({
  anchor,
  open,
  onClose,
  value,
  onPick,
  onRemove,
  removeLabel = "Remove",
}: {
  anchor: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  /** The icon currently set, so the grid can ring it. */
  value?: string;
  onPick: (name: string) => void;
  /** Omit to hide the Remove action (a property always keeps *an* icon). */
  onRemove?: () => void;
  removeLabel?: string;
}) {
  const style = useAnchoredStyle(open, anchor, { width: WIDTH, maxHeight: MAX_HEIGHT });
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const field = useRef<HTMLInputElement>(null);

  useMenuDismiss(open, onClose);

  /* Recent is read on open, not on mount: the picker mounts once and is opened many
     times, and a list captured at mount would never show what you picked last. */
  useEffect(() => {
    if (open) {
      setRecent(readRecent());
      setQuery("");
      requestAnimationFrame(() => field.current?.focus());
    }
  }, [open]);

  const matches = useMemo(() => searchIcons(query), [query]);

  const pick = (name: string) => {
    remember(name);
    onPick(name);
    /* Closes on choice. The property menu underneath stays open, so picking an icon is a
       step in the menu rather than a way out of it. */
    onClose();
  };

  /* Shuffle rolls without closing: the point of a random picker is to keep rolling. */
  const shuffle = () => {
    const names = matches.length ? matches : Object.keys(PROPERTY_ICONS);
    const name = names[Math.floor(Math.random() * names.length)];
    remember(name);
    setRecent(readRecent());
    onPick(name);
  };

  if (!open || !style || typeof document === "undefined") return null;

  return createPortal(
    <div data-db-popover="" className="db-menu db-icon-picker" style={style}>
      <div className="db-icon-picker-head">
        <span className="db-icon-picker-title">Icon</span>
        {onRemove ? (
          <button
            type="button"
            className="db-icon-picker-remove"
            onClick={() => {
              onRemove();
              onClose();
            }}
          >
            {removeLabel}
          </button>
        ) : null}
      </div>

      <div className="db-icon-search">
        <Search size={13} className="db-icon-search-glyph" aria-hidden />
        <input
          ref={field}
          className="db-icon-search-input"
          value={query}
          placeholder="Filter…"
          aria-label="Filter icons"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches.length) pick(matches[0]);
            if (event.key === "Escape") onClose();
          }}
        />
        <button type="button" className="db-icon-shuffle" title="Random icon" aria-label="Random icon" onClick={shuffle}>
          <Shuffle size={13} />
        </button>
      </div>

      <div className="db-icon-scroll">
        {recent.length && !query ? (
          <>
            <p className="db-menu-title">Recent</p>
            <div className="db-icon-grid">
              {recent.map((name) => (
                <IconCell key={`recent-${name}`} name={name} current={value === name} onPick={pick} />
              ))}
            </div>
          </>
        ) : null}

        <p className="db-menu-title">{query ? "Matches" : "Icons"}</p>
        {matches.length ? (
          <div className="db-icon-grid">
            {matches.map((name) => (
              <IconCell key={name} name={name} current={value === name} onPick={pick} />
            ))}
          </div>
        ) : (
          <p className="db-icon-empty">No icon named “{query}”.</p>
        )}
      </div>
    </div>,
    document.body,
  );
}

function IconCell({ name, current, onPick }: { name: string; current: boolean; onPick: (name: string) => void }) {
  const Icon = PROPERTY_ICONS[name];
  if (!Icon) return null;
  return (
    <button
      type="button"
      className={current ? "db-icon-choice is-current" : "db-icon-choice"}
      title={name.replace(/-/g, " ")}
      aria-label={name.replace(/-/g, " ")}
      aria-pressed={current}
      onClick={() => onPick(name)}
    >
      <Icon size={17} />
    </button>
  );
}

export { NO_ICON };
