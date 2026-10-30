"use client";
/* A column header: its icon, its name, and the menu that owns both.
   ---------------------------------------------------------------------------
   Clicking a header opens one menu for everything a property *is*. It used to be a
   hand-rolled block of JSX with three rows in it; every new capability meant another
   inline block and another copy of the positioning maths. It is now built from
   `menu.tsx`, so a new row is one `<MenuItem>` — which is what makes the menu able to
   grow into the reference (access, type, filter, sort, calculate, freeze, hide, insert,
   duplicate, delete) without this file becoming the thing nobody wants to touch.

   The menu only lists what actually works. A row that does nothing when clicked is worse
   than a row that isn't there: it teaches people the menu is decorative.
   --------------------------------------------------------------------------- */
import { useEffect, useRef, useState } from "react";
import { ArrowDownAZ, ArrowUpAZ, ChevronDown, Copy, EyeOff, Trash, X } from "lucide-react";
import { resolveProperty } from "@/lib/database/properties";
import { propertyTypes, type PropertyDef, type PropertyType } from "@/lib/database/types";
import { iconNameFor, PropertyIcon } from "./property-icons";
import { IconPicker } from "./icon-picker";
import { MenuDivider, MenuHeading, MenuItem, MenuSub, MenuSurface, useMenuDismiss } from "./menu";

export type SortDirection = "ascending" | "descending";

/* Types a column can be changed *into*: everything that holds a value. A `formula`,
   `createdTime` or `button` column is written by Raspberry, never by a person, so
   offering it as a destination would only produce a column nobody can fill. */
const changeable = propertyTypes.filter((type) => {
  const spec = resolveProperty({ type });
  return !spec.readOnly && !spec.derived;
});

/* Below this a column is a sliver; above it, dragging stops feeling like a gesture. */
export const MIN_COLUMN_WIDTH = 96;
export const MAX_COLUMN_WIDTH = 720;

export function PropertyHeader({
  property,
  sort,
  width,
  defaultWidth,
  onRename,
  onIcon,
  onSort,
  onDelete,
  onDuplicate,
  onHide,
  onResize,
  onCommitWidth,
  onType,
  refusal,
}: {
  property: PropertyDef;
  sort: SortDirection | null;
  width: number;
  defaultWidth: number;
  onRename?: (name: string) => void;
  onIcon?: (icon: string) => void;
  onSort?: (direction: SortDirection | null) => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onHide?: () => void;
  onResize?: (width: number) => void;
  onCommitWidth?: (width: number) => void;
  /* `anyway` is the caller's answer to a refusal: convert what converts, clear the rest. */
  onType?: (type: PropertyType, anyway?: boolean) => void;
  /* Set when the last attempt to change *this* column's type was refused, and how many
     cells it would clear. The menu turns that into a second, explicit choice. */
  refusal?: { type: PropertyType; cells: number } | null;
}) {
  const [open, setOpen] = useState(false);
  const [iconOpen, setIconOpen] = useState(false);
  const [draft, setDraft] = useState(property.name);
  const anchor = useRef<HTMLButtonElement>(null);
  const iconAnchor = useRef<HTMLButtonElement>(null);

  const closeMenu = () => {
    setOpen(false);
    setIconOpen(false);
  };

  useMenuDismiss(open, closeMenu);

  useEffect(() => {
    setDraft(property.name);
  }, [property.name]);

  /* The name is committed on Enter or on leaving the field, so a half-typed name is
     never written to the server and a rename survives clicking straight into the grid. */
  const commitName = () => {
    const next = draft.trim();
    if (next && next !== property.name) onRename?.(next);
    else setDraft(property.name);
  };

  const startResize = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (!onResize) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = width;
    let latest = startWidth;
    const move = (moveEvent: PointerEvent) => {
      latest = Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(startWidth + moveEvent.clientX - startX)));
      onResize(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      document.body.classList.remove("db-resizing");
      /* Persisted once, on release. A `PATCH` per pointermove would be sixty requests
         per drag, and the last one is the only one anybody meant. */
      if (latest !== startWidth) onCommitWidth?.(latest);
    };
    document.body.classList.add("db-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  const sorted = sort !== null;

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="db-th-label"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${resolveProperty(property).label}${sorted ? ` · sorted ${sort === "ascending" ? "A→Z" : "Z→A"}` : ""}`}
        onMouseDown={(event) => {
          event.preventDefault();
          setOpen((was) => !was);
        }}
      >
        <PropertyIcon name={iconNameFor(property)} size={14} className="db-th-icon" />
        <span className="db-th-text">{property.name}</span>
        {sorted ? (sort === "ascending" ? <ArrowUpAZ size={11} className="db-th-sorted" /> : <ArrowDownAZ size={11} className="db-th-sorted" />) : null}
        <ChevronDown size={11} className="db-th-caret" />
      </button>
      <span
        className="db-th-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize the ${property.name} column`}
        title="Drag to resize · double-click to reset"
        onPointerDown={startResize}
        onDoubleClick={() => { onResize?.(defaultWidth); onCommitWidth?.(defaultWidth); }}
        onMouseDown={(event) => event.stopPropagation()}
      />

      <MenuSurface anchor={anchor} open={open} onClose={closeMenu} width={268} className="db-prop-menu">
        <div className="db-prop-head">
          <button
            ref={iconAnchor}
            type="button"
            className="db-prop-icon-btn"
            title="Change icon"
            aria-label="Change icon"
            aria-haspopup="dialog"
            aria-expanded={iconOpen}
            onClick={() => setIconOpen((was) => !was)}
          >
            <PropertyIcon name={iconNameFor(property)} size={15} />
          </button>
          <input
            className="db-prop-name"
            value={draft}
            aria-label="Property name"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitName();
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                setDraft(property.name);
                closeMenu();
              }
            }}
          />
        </div>

        <MenuDivider />

        <MenuSub icon={<ArrowUpAZ size={14} aria-hidden />} label="Sort" disabled={!onSort}>
          <MenuItem
            icon={<ArrowUpAZ size={14} aria-hidden />}
            label="A → Z"
            check={sort === "ascending"}
            onSelect={() => {
              onSort?.("ascending");
              closeMenu();
            }}
          />
          <MenuItem
            icon={<ArrowDownAZ size={14} aria-hidden />}
            label="Z → A"
            check={sort === "descending"}
            onSelect={() => {
              onSort?.("descending");
              closeMenu();
            }}
          />
          <MenuItem
            icon={<X size={14} aria-hidden />}
            label="Don't sort"
            check={sort === null}
            onSelect={() => {
              onSort?.(null);
              closeMenu();
            }}
          />
        </MenuSub>

        {onHide ? (
          <MenuItem
            icon={<EyeOff size={14} aria-hidden />}
            label="Hide"
            hint="Removes this column from this view only — the data stays."
            onSelect={() => {
              onHide();
              closeMenu();
            }}
          />
        ) : null}

        {!onDuplicate && !onDelete ? null : <MenuDivider />}

        {onDuplicate ? (
          <MenuItem
            icon={<Copy size={14} aria-hidden />}
            label="Duplicate property"
            onSelect={() => {
              onDuplicate();
              closeMenu();
            }}
          />
        ) : null}

        {onDelete ? (
          <MenuItem
            icon={<Trash size={14} aria-hidden />}
            label="Delete property"
            danger
            onSelect={() => {
              onDelete();
              closeMenu();
            }}
          />
        ) : null}

        <MenuDivider />
        {/* What the column *is*. Every type that can hold a value is listed; the ones
            that cannot be typed into (`formula`, `createdTime`, `button`) are not, because
            a column nobody can fill is not a column anyone wants to change into. */}
        <MenuSub icon={<PropertyIcon name={iconNameFor(property)} size={14} />} label="Change type" disabled={!onType}>
          {changeable.map((type) => {
            const spec = resolveProperty({ type });
            return (
              <MenuItem
                key={type}
                icon={<PropertyIcon name={iconNameFor({ type })} size={14} />}
                label={spec.label}
                check={type === property.type}
                onSelect={() => {
                  closeMenu();
                  if (type !== property.type) onType?.(type);
                }}
              />
            );
          })}
          {/* The answer to a refusal. The type change is refused rather than obeyed when
              existing cells hold values the new type cannot read; the number in this label
              is the one the refusal counted. It is in the *label* rather than in `hint`
              because `hint` renders as a tooltip — and a count that only appears on hover
              is not there when the person is deciding. */}
          {refusal ? (
            <>
              <MenuDivider />
              <MenuItem
                icon={<Trash size={14} aria-hidden />}
                label={`Clear ${refusal.cells} ${refusal.cells === 1 ? "cell" : "cells"} and use ${resolveProperty({ type: refusal.type }).label}`}
                hint="Values this type cannot read are removed. The rest are kept."
                danger
                onSelect={() => {
                  closeMenu();
                  onType?.(refusal.type, true);
                }}
              />
            </>
          ) : null}
        </MenuSub>
        <MenuHeading>{resolveProperty(property).label}</MenuHeading>
      </MenuSurface>

      <IconPicker
        anchor={iconAnchor}
        open={iconOpen}
        onClose={() => setIconOpen(false)}
        value={iconNameFor(property)}
        onPick={(name) => onIcon?.(name)}
        /* Removing a property's icon is not "no icon" — it is "back to the one this type
           ships with", which is why it clears to empty rather than to `none`. */
        onRemove={onIcon ? () => onIcon("") : undefined}
        removeLabel="Remove"
      />
    </>
  );
}
