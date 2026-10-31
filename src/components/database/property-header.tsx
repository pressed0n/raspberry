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
import { ArrowDownAZ, ArrowDownNarrowWide, ArrowUpAZ, ArrowUpNarrowWide, Copy, EyeOff, ListOrdered, Ruler, Trash, X } from "lucide-react";
import { currencies, currencySymbol, dateFormatChoices, formatCell, numberFormatChoices, resolveProperty, sortKind, sortLabels } from "@/lib/database/properties";
import { clockText, dateConfigOf } from "@/lib/database/property-types/date";
import { propertyTypes, type PropertyDef, type PropertyType, type SortDirection } from "@/lib/database/types";
import { iconNameFor, PropertyIcon } from "./property-icons";
import { IconPicker } from "./icon-picker";
import { StatusGroupsPane } from "./status-groups";
import { groupsOf } from "@/lib/database/property-types/groups";
import { MenuDivider, MenuHeading, MenuItem, MenuSub, MenuSurface, useMenuDismiss } from "./menu";

/* The direction vocabulary is the schema's, not this component's — a header that can
   offer a direction the server would reject is a menu row that fails on click. Re-exported
   because the block and this menu are the two halves of the same type. */
export type { SortDirection };

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
  onConfig,
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
  /* A property's config is presentation — number format, decimal places, what a
     column shows. The patch is a *merge* of the keys this menu touched onto the
     config as it stands: the server parses the whole object, so a partial one
     would silently reset every key the menu did not mention. */
  onConfig?: (patch: Record<string, unknown>) => void;
  /* Set when the last attempt to change *this* column's type was refused, and how many
     cells it would clear. The menu turns that into a second, explicit choice. */
  refusal?: { type: PropertyType; cells: number } | null;
}) {
  const [open, setOpen] = useState(false);
  const [iconOpen, setIconOpen] = useState(false);
  /* The property menu is two panes: the menu, and the status groups editor. A second
     `MenuSurface` would need an anchor that survives the row that opened it, and the
     corridor between two popovers is exactly what B40m was spent on. */
  const [pane, setPane] = useState<"menu" | "groups">("menu");
  const [draft, setDraft] = useState(property.name);
  const anchor = useRef<HTMLButtonElement>(null);
  const iconAnchor = useRef<HTMLButtonElement>(null);

  /* What this column's sort is *called* and what its arrow *looks like* come from the
     type, not from the menu: a number column sorted ascending is not A→Z, and an
     `ArrowUpAZ` beside a column of numbers is the same wrong claim in a smaller font. */
  const labels = sortLabels(property.type);
  const ordered = sortKind(property.type) === "ordered";
  const AscIcon = ordered ? ArrowUpNarrowWide : ArrowUpAZ;
  const DescIcon = ordered ? ArrowDownNarrowWide : ArrowDownAZ;
  /* What the header says its sort is. A `manual` sort on a type with no arranged order
     falls back to the ascending wording, because `sortRows` falls back to the ascending
     comparison — the label has to describe the comparison that runs, not the one the
     stored config asked for. */
  const sortWord =
    sort === "manual" ? labels.manual ?? labels.ascending
      : sort === "ascending" ? labels.ascending
        : labels.descending;

  /* Only a number column reads `config.format`; showing number settings on a text
     column would be a menu that lies about what it changes. */
  const number = property.type === "number"
    ? (property.config ?? {}) as { format?: string; currency?: string; decimals?: number }
    : null;
  const format = number?.format ?? "number";
  const decimals = number?.decimals ?? 0;
  const currency = number?.currency ?? "USD";

  /* A sample rendered by the *real* formatter, through the *real* registry, so the
     number beside "Number with separators" is what this column will show — in this
     locale, with this column's decimal places — rather than a hand-written guess.
     One sample value for every format: 1234.5 is legible as a plain number, shows a
     separator, survives being rounded, and lands on a real minute-and-seconds. */
  const previewOf = (patch: { format?: string; currency?: string; decimals?: number } = {}) =>
    formatCell({ type: "number", config: { ...(property.config ?? {}), ...patch } }, 1234.5);

  const decimalsLabel = decimals === 0 ? "Integer" : `${decimals} decimal${decimals === 1 ? "" : "s"}`;

  /* A date column reads two ways, and until now neither had a control: the format, and
     whether the column shows clocks at all. */
  const date = property.type === "date" ? dateConfigOf(property.config) : null;
  /* One sample, rendered by the real formatter through the real registry — a *date-only*
     value on purpose: a timed sample is 130px at this font and would truncate the label
     beside it in a 200px submenu, which is the lesson the number menu already paid for. */
  const datePreview = (patch: Record<string, unknown> = {}) =>
    formatCell({ type: "date", config: { ...(property.config ?? {}), ...patch } }, "2026-10-30");

  const closeMenu = () => {
    setOpen(false);
    setIconOpen(false);
    /* The pane resets with the menu: reopening on the groups list from a header you clicked
       to look at the sort order would be a menu that opens somewhere else than it says. */
    setPane("menu");
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
        title={`${resolveProperty(property).label}${sorted ? ` · ${sortWord}` : ""}`}
        onMouseDown={(event) => {
          event.preventDefault();
          setOpen((was) => !was);
        }}
      >
        <PropertyIcon name={iconNameFor(property)} size={14} className="db-th-icon" />
        <span className="db-th-text">{property.name}</span>
        {sorted ? (
          sort === "manual" && labels.manual ? (
            <ListOrdered size={11} className="db-th-sorted" aria-hidden />
          ) : sort === "ascending" ? (
            <AscIcon size={11} className="db-th-sorted" />
          ) : (
            <DescIcon size={11} className="db-th-sorted" />
          )
        ) : null}
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
        {pane === "groups" ? (
          <StatusGroupsPane property={property} onConfig={onConfig} onBack={() => setPane("menu")} />
        ) : (
        <>
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

        {/* Status is the one type whose tags live in groups, so its group *list* is part of
            what the property is — one row here, and the pane behind it. It sits above Sort
            because it changes what the column means, not how a view presents it. */}
        {property.type === "status" && onConfig ? (
          <MenuItem
            icon={<PropertyIcon name={iconNameFor({ type: "status" })} size={14} />}
            label="Status groups"
            trailing={`${groupsOf(property.config).length}`}
            onSelect={() => setPane("groups")}
          />
        ) : null}

        <MenuSub icon={<AscIcon size={14} aria-hidden />} label="Sort" disabled={!onSort}>
          {/* The arranged order leads for the types that have one, because it is the
              order the dropdown itself shows and the one anybody means by "sort these
              the way I put them" — A → Z is the derived one. */}
          {labels.manual ? (
            <MenuItem
              icon={<ListOrdered size={14} aria-hidden />}
              label={labels.manual}
              check={sort === "manual"}
              onSelect={() => {
                onSort?.("manual");
                closeMenu();
              }}
            />
          ) : null}
          <MenuItem
            icon={<AscIcon size={14} aria-hidden />}
            label={labels.ascending}
            check={sort === "ascending"}
            onSelect={() => {
              onSort?.("ascending");
              closeMenu();
            }}
          />
          <MenuItem
            icon={<DescIcon size={14} aria-hidden />}
            label={labels.descending}
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

        {/* Presentation for a number column: how the value reads, and how exact it is.
            Both rows print their current setting on the row itself, because a column of
            numbers does not tell you it is rounded until the number you read is wrong.

            The currencies sit *inside* the format submenu rather than one level deeper: at
            390px this submenu already has to flip to the left of its parent to fit on
            screen, so a third surface would have nowhere to go but on top of the two
            before it. Depth is a width budget, not a taste. */}
        {number && onConfig ? (
          <>
            <MenuSub
              icon={<PropertyIcon name="hash" size={14} />}
              label="Number format"
              trailing={previewOf()}
            >
              {/* No sample column on these four rows, deliberately: "Number with
                  separators" is 149px at this font, and a right-aligned sample beside it
                  truncated the label to "Number with sep…" — in a 200px submenu there is
                  room for the words or the sample, not both. The sample that matters is
                  on the row above ("Number format  1,235"), which is the one that says
                  what this column is set to. Currencies keep their symbols, because a
                  symbol *is* the name of a currency, not an example of it. */}
              {numberFormatChoices.map((choice) => (
                <MenuItem
                  key={choice.format}
                  label={choice.label}
                  check={format === choice.format}
                  onSelect={() => {
                    onConfig({ format: choice.format });
                    closeMenu();
                  }}
                />
              ))}
              <MenuDivider />
              <MenuHeading>Currency</MenuHeading>
              {currencies.map((entry) => (
                <MenuItem
                  key={entry.code}
                  label={entry.name}
                  trailing={currencySymbol(entry.code)}
                  check={format === "currency" && currency === entry.code}
                  onSelect={() => {
                    onConfig({ format: "currency", currency: entry.code });
                    closeMenu();
                  }}
                />
              ))}
            </MenuSub>

            <MenuSub icon={<Ruler size={14} aria-hidden />} label="Decimal places" trailing={decimalsLabel}>
              {/* The samples *are* the point of this submenu — the difference between one
                  decimal and three is not a word, it is a number — and "1 decimal" is short
                  enough to leave room for one. */}
              {[0, 1, 2, 3, 4, 5, 6].map((places) => (
                <MenuItem
                  key={places}
                  label={places === 0 ? "Integer" : places === 1 ? "1 decimal" : `${places} decimals`}
                  trailing={previewOf({ decimals: places })}
                  check={decimals === places}
                  onSelect={() => {
                    onConfig({ decimals: places });
                    closeMenu();
                  }}
                />
              ))}
            </MenuSub>
          </>
        ) : null}

        {date && (
          <MenuSub icon={<PropertyIcon name="calendar" size={14} />} label="Date format" trailing={datePreview()}>
            {dateFormatChoices.map((choice) => (
              <MenuItem
                key={choice.format}
                label={choice.label}
                check={date.format === choice.format}
                onSelect={() => {
                  onConfig?.({ format: choice.format });
                  closeMenu();
                }}
              />
            ))}
            {/* The clocks live under the same row, the way the currencies live under
                "Number format": a fourth surface at 390px has nowhere to go but on top of
                the three before it. Only when the column shows times, because a format
                nobody can see is a preference that does nothing. */}
            {date.includeTime ? (
              <>
                <MenuDivider />
                <MenuHeading>Time format</MenuHeading>
                {(["24", "12"] as const).map((clock) => (
                  <MenuItem
                    key={clock}
                    label={clock === "24" ? "24-hour" : "12-hour"}
                    trailing={clockText("14:30", { format: "iso", includeTime: true, timeFormat: clock })}
                    check={date.timeFormat === clock}
                    onSelect={() => {
                      onConfig?.({ timeFormat: clock });
                      closeMenu();
                    }}
                  />
                ))}
              </>
            ) : null}
          </MenuSub>
        )}

        {date && onConfig ? (
          <MenuItem
            icon={<PropertyIcon name="clock" size={14} />}
            label="Include time"
            check={date.includeTime}
            onSelect={() => onConfig({ includeTime: !date.includeTime })}
          />
        ) : null}

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
        </>
        )}
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
