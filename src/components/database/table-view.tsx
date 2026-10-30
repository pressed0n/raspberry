"use client";
/* The table view — the wishlist's first item.
   ---------------------------------------------------------------------------
   This component renders a `RowSet` and nothing else. It never fetches, never sorts
   and never knows what a property type means: `selectRows` already filtered, sorted,
   grouped and windowed, and `formatCell` already turned each value into text. That is
   what makes the other views cheap — they are alternative renderers over the same
   result, not alternative data paths.

   Column widths are the one piece of *layout* state the view keeps locally: while a
   handle is being dragged, sixty renders a second must not become sixty requests. The
   live width lives in `drifting` and is committed once on pointer release, which is
   also why the header takes two callbacks instead of one.

   The callbacks are optional on purpose. A phase that has not built row creation yet
   renders the table without the affordances that would need it, instead of shipping a
   button that does nothing. */
import { Copy, EyeOff, Plus, Trash2 } from "lucide-react";
import DragLayer, { type GhostView, type LineView } from "@/components/drag-layer";
import { FrameAnchor } from "@/components/frame-anchor";
import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { primaryPropertyId, type CellValue, type DatabasePayload, type PropertyDef, type PropertyType, type ViewDef } from "@/lib/database/types";
import { formatCell } from "@/lib/database/properties";
import { selectRows } from "@/lib/database/rows";
import { AddPropertyMenu } from "./add-property-menu";
import { CellEditor } from "./cell-editor";
import { EntryIcon } from "./entry-icon";
import { MenuHeading, MenuItem, MenuSurface, useMenuDismiss } from "./menu";
import { iconNameFor, PropertyIcon } from "./property-icons";
import { MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH, PropertyHeader, type SortDirection } from "./property-header";

const DEFAULT_NAME_WIDTH = 280;
const DEFAULT_PROPERTY_WIDTH = 180;
/* The left gutter — grip, `+`, checkbox — is not a column at any width.
   ---------------------------------------------------------------------------
   It used to be one below 860px, on the theory that a phone has no margin to hang in.
   That theory shipped a 60px indent: the table's first *cell* started at 84px while
   every other block on the page started at 24, which reads as the table being shoved
   right by an empty bordered band — the owner's words were "stupid since all other
   objects don't function like that".

   So the rule is now one rule: the controls never take table space. They hang outside
   the table's own box, and the page margin absorbs them, exactly as a callout's grip
   does at every width. Two numbers, both in `database.css` on `.db-block`:

     --db-shelf  how much page margin the wrap borrows for them (60px)
     --db-col    the gutter column's own width (0 — always)

   Below 860px the shelf had nowhere to hang, so it docked inside the row's left edge and
   the Name cell took a 58px inset to keep its text clear of the buttons. The owner
   rejected that twice, and the second time named both reasons: a phone has no hover, so
   the controls the inset made room for cannot be reached at all; and if the three
   controls do not fit, the answer is more page margin, not an indented grid.

   The margin is where it is fixed now — `.doc:has(.db-block)` widens its own inline
   padding to the shelf at every width, so the grid always starts on the content edge and
   the controls always have somewhere to hang. Nothing in the table moves to make room.

   60 = 39 (the pair, which is `.frame-anchor`'s exact width) + 2 (gap) + 15 (checkbox) +
   4 (inset). The pair is `FrameAnchor` — the same component, not a copy of its geometry;
   see `components/frame-anchor.tsx`. */

/* The `+` column is a named control, not a 48px glyph slot (B40g). "Add property" is
   about 76px at the header's size, plus the glyph and the cell's two 10px insets. One
   number, because it appears twice — in the `<col>` and in the table's `width` sum — and
   two literals drift the moment one of them is edited. */
const ADD_COLUMN = 132;


function defaultWidthOf(propertyId: string): number {
  return propertyId === primaryPropertyId ? DEFAULT_NAME_WIDTH : DEFAULT_PROPERTY_WIDTH;
}

function widthOf(widths: Record<string, number>, id: string): number {
  const value = Number(widths[id] ?? 0);
  if (!Number.isFinite(value) || value <= 0) return defaultWidthOf(id);
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, value));
}

export function TableView({
  database,
  view,
  focusRow,
  onNewRow,
  onNewRowAfter,
  onReorderRows,
  onDuplicateRow,
  onTrashRow,
  onOpenRow,
  onAddProperty,
  onRenameProperty,
  onIconProperty,
  onDeleteProperty,
  onDuplicateProperty,
  onHideProperty,
  hidden,
  onShowProperty,
  onIconRow,
  onResizeProperty,
  onSortProperty,
  onCell,
}: {
  database: DatabasePayload;
  view: ViewDef;
  /* The row a click just created: its Name cell takes the cursor, so adding an entry
     is one click followed by typing. */
  focusRow?: string;
  onNewRow?: () => void;
  /* `+` beside a row means "a page *here*", not "a page at the bottom". The two are
     different requests, so they are different callbacks. */
  onNewRowAfter?: (rowId: string) => void;
  /* Dragging a row by its grip. Optional like every other callback here: a phase that
     has not built reordering renders the grip's absence rather than a dead handle. */
  onReorderRows?: (ids: string[]) => void;
  /* The grip's menu. Both are optional for the same reason the reorder callback is:
     without them the menu is not rendered at all rather than opening empty. */
  onDuplicateRow?: (rowId: string) => void;
  onTrashRow?: (rowId: string) => void;
  onOpenRow?: (rowId: string) => void;
  onAddProperty?: (type: PropertyType) => void;
  onRenameProperty?: (propertyId: string, name: string) => void;
  onIconProperty?: (propertyId: string, icon: string) => void;
  onDeleteProperty?: (propertyId: string) => void;
  onDuplicateProperty?: (propertyId: string) => void;
  /* Hide/show are *view* state, not schema state: they change what this table draws and
     never touch the property or the data in it. */
  onHideProperty?: (propertyId: string) => void;
  hidden?: readonly string[];
  onShowProperty?: (propertyId: string) => void;
  onIconRow?: (rowId: string, icon: string) => void;
  /* Live during a drag, then once more on release. Splitting them is what keeps a drag
     at one request instead of one per pointermove. */
  onResizeProperty?: (propertyId: string, width: number) => void;
  onSortProperty?: (propertyId: string, direction: SortDirection | null) => void;
  /* One callback for every cell, keyed by row and property. The Name column passes
     `primaryPropertyId`, because the primary property *is* `pages.title` — the block
     routes that id to a title write and the id of a real property to a cell write,
     so the table never has to know the difference. */
  onCell?: (rowId: string, propertyId: string, value: CellValue) => void;
}) {
  const set = useMemo(() => selectRows(database, view.config), [database, view.config]);
  const editable = Boolean(onCell);

  /* Hidden columns, resolved from the schema rather than from the view's id list: the
     list can name a property that has since been deleted, and offering to "show" a
     property that no longer exists is a dead row in a menu. */
  const hiddenProperties = useMemo(
    () => (hidden ?? []).map((propertyId) => database.properties.find((property) => property.id === propertyId)).filter((property): property is NonNullable<typeof property> => Boolean(property)),
    [database.properties, hidden],
  );

  /* Widths being dragged right now, by property id. Cleared as soon as the commit
     lands and the server's config catches up, but harmless if it does not: the value
     is the same one that was just persisted. */
  const [drifting, setDrifting] = useState<Record<string, number>>({});

  const widthFor = (propertyId: string): number => drifting[propertyId] ?? widthOf(view.config.widths, propertyId);

  /* A view config holds a list of sorts, and this renderer honours the whole list — it
     asks "is *this* property sorted, and which way", which is also the right question when
     the list has one entry. The limit is on the write side, not here: the header menu
     replaces the list with a single sort (`patchViewConfig({ sorts: [ … ] })` in
     database-block.tsx), so no view can ever hold more than one. */
  const sortOf = (propertyId: string): SortDirection | null =>
    view.config.sorts.find((entry) => entry.propertyId === propertyId)?.direction ?? null;

  /* ---------------------------------------------------------------------------
     Selection and reordering — the two pieces of state a table row has that the
     database does not.
     ---------------------------------------------------------------------------
     Multi-select is a property of *this table being looked at*: it is not persisted,
     not shared, and not a field of anything. It lives here rather than in the block
     because nothing outside the renderer has any business knowing which rows are
     ticked until there is a bulk action to spend the ticks on. */
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; below: boolean } | null>(null);
  /* The ghost and the insertion line are `DragLayer`'s — the same two things the
     sidebar's page drag draws, portalled to <body> and `position: fixed` for the same
     reason. A grabbed entry that looked like anything else would be the second time this
     project drew one gesture two ways. */
  const [dragView, setDragView] = useState<{ ghost: GhostView; line: LineView | null } | null>(null);
  /* The grip's menu. One open at a time; the anchor is the pair itself, so the surface
     lands under the control that opened it, like every other grip in the app. */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const menuAnchor = useRef<HTMLElement | null>(null);
  /* Pressed, not dragged. Every other grip in the app opens its menu on a *click*, and a
     click is a press that did not move — so the press is recorded and only spent when
     the pointer travels 4px. `suppress` eats the click that follows a real drag. */
  const press = useRef<{ rowId: string; x: number; y: number; armed: boolean } | null>(null);
  const suppress = useRef(false);
  /* The menu's dismissal — Escape and a click outside — is `useMenuDismiss`, the same hook
     every other database menu uses. It listens on `document` and arms the click handler one
     turn later, which is what stops the press that opened the menu from also closing it. */
  const closeMenu = useCallback(() => setMenuFor(null), []);
  useMenuDismiss(menuFor !== null, closeMenu);

  /* A drag only means something while the table shows its stored order. In a sorted
     view there is no order for the gesture to change, so the grip is present but
     inert and says why — the alternative is a handle that silently does nothing. */
  const sortable = Boolean(onReorderRows) && view.config.sorts.length === 0;

  const toggle = (rowId: string) =>
    setSelected((was) => {
      const next = new Set(was);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });

  const everySelected = set.rows.length > 0 && set.rows.every((row) => selected.has(row.id));

  const dropOn = (target: { id: string; below: boolean }) => {
    if (!onReorderRows || !dragging || dragging === target.id) return;
    const ids = set.rows.map((row) => row.id).filter((id) => id !== dragging);
    const at = ids.indexOf(target.id);
    /* `at < 0` can only happen if the target vanished mid-drag; appending is the
       answer that loses nothing. */
    const slot = at < 0 ? ids.length : at + (target.below ? 1 : 0);
    ids.splice(slot, 0, dragging);
    onReorderRows(ids);
  };

  /* Pressed, not dragged.
     -------------------------------------------------------------------------
   Pointer capture, not a document listener: the grip keeps receiving moves while the
   pointer is over the rows it is dragging past, and the stream ends by itself if the
   pointer is cancelled. `elementFromPoint` turns "which row is under the finger" into an
   id without measuring a single rectangle.

   The gesture only arms after 4px of travel. A press that never moves is a *click*, and
   a click on a grip opens its menu everywhere else in the app — so `dragStart` records
   the press and `onGrip` decides, which is why the two can share one button. */
  const dragStart = (rowId: string) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!sortable) return;
    /* No `preventDefault` here: the grip's own `onMouseDown` already refuses the text
       selection a drag would otherwise start, and cancelling `pointerdown` can suppress
       the `click` this same button needs for its menu. */
    event.currentTarget.setPointerCapture(event.pointerId);
    press.current = { rowId, x: event.clientX, y: event.clientY, armed: false };
    suppress.current = false;
  };

  const dragMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const armed = press.current;
    if (!armed) return;
    if (!armed.armed) {
      if (Math.hypot(event.clientX - armed.x, event.clientY - armed.y) < 4) return;
      const row = set.rows.find((item) => item.id === armed.rowId);
      if (!row) return;
      armed.armed = true;
      setDragging(armed.rowId);
      /* The ghost is the entry's own name and icon, at 86% opacity — `DragLayer`'s
         `.tree-ghost`, the same skin a dragged page wears in the sidebar. */
      setDragView({
        ghost: {
          title: row.title || "Untitled",
          icon: <PropertyIcon name={row.icon || "file"} size={15} />,
          x: event.clientX + 14,
          y: event.clientY + 12,
          width: 220,
          height: 30,
        },
        line: null,
      });
    }
    const under = document.elementFromPoint(event.clientX, event.clientY)?.closest("tr[data-row-id]") as HTMLElement | null;
    const id = under?.getAttribute("data-row-id");
    if (!under || !id) return;
    const box = under.getBoundingClientRect();
    const below = event.clientY > box.top + box.height / 2;
    setOver({ id, below });
    /* The line spans the table, not the row: a drop is a gap in the grid. A drop onto the
       row being dragged changes nothing, so it draws no line — a gap that is already there
       is not a place to put something. */
    const span = under.closest("table")?.getBoundingClientRect();
    const noop = id === armed.rowId;
    setDragView((was) => was ? {
      ...was,
      ghost: { ...was.ghost, x: event.clientX + 14, y: event.clientY + 12 },
      line: span && !noop ? { x: span.left, y: below ? box.bottom : box.top, width: span.width } : null,
    } : was);
  };

  const dragEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const armed = press.current;
    press.current = null;
    if (armed?.armed) {
      suppress.current = true;
      if (dragging && over) dropOn(over);
    }
    setDragging(null);
    setOver(null);
    setDragView(null);
  };

  return (
    <>
    {/* Every control below the table is a *sibling* of the scroll wrapper, not a child of
        it (B40g). The wrapper borrows 60px of page margin on the left so the row gutter
        can hang outside the table; anything inside it inherits that −60px borrow, which is
        why `+ New page` sat 60px left of the grid it belongs to, and why it scrolled
        sideways with a wide table. The wrapper scrolls the grid and nothing else. */}
    <div className="db-table-wrap">
      {/* The table is as wide as its columns, and never narrower than the editor
          column. The trailing filler column is what makes those two statements
          compatible: without an auto-width column the browser hands the leftover
          space to the data columns, and a 70px drag then moves the edge by 36px.
          With it, every property column keeps exactly the width it was given. */}
        <table className="db-table" style={{ width: set.properties.reduce((sum, property) => sum + widthFor(property.id), 0) + (onAddProperty ? ADD_COLUMN : 0) }}>
          <colgroup>
            {/* Zero-wide, at every width: the controls hang outside the table's own box.
                The number lives in CSS (`--db-col`) because the media query that used to
                change it is gone — a column here indents the grid, and the grid is the
                thing that has to line up with the page. */}
            <col style={{ width: "var(--db-col)" }} />
            {set.properties.map((property) => <col key={property.id} style={{ width: widthFor(property.id) }} />)}
          {onAddProperty ? <col style={{ width: ADD_COLUMN }} /> : null}
          <col />
        </colgroup>
          <thead>
            <tr>
              {/* The gutter's header holds select-all and nothing else: an empty cell
                  the width of two buttons would read as a broken column. It uses the
                  same flex row as the data rows so the tick lands directly above the
                  ticks below it. */}
              <th scope="col" className="db-th db-gutter">
                {set.rows.length ? (
                  <div className="db-gutter-inner">
                    <input
                      type="checkbox"
                      className="db-check db-check-all"
                      aria-label={everySelected ? "Clear the selection" : "Select every page"}
                      checked={everySelected}
                      ref={(node) => {
                        if (node) node.indeterminate = !everySelected && set.rows.some((row) => selected.has(row.id));
                      }}
                      onChange={() => setSelected(everySelected ? new Set<string>() : new Set<string>(set.rows.map((row) => row.id)))}
                    />
                  </div>
                ) : null}
              </th>
            {set.properties.map((property) => (
              <th key={property.id} scope="col" className={property.id === primaryPropertyId ? "db-th db-th-name" : "db-th"}>
                <PropertyHeader
                  property={property}
                  sort={sortOf(property.id)}
                  width={widthFor(property.id)}
                  defaultWidth={defaultWidthOf(property.id)}
                  onRename={onRenameProperty ? (name) => onRenameProperty(property.id, name) : undefined}
                  onIcon={onIconProperty ? (icon) => onIconProperty(property.id, icon) : undefined}
                  onSort={onSortProperty ? (direction) => onSortProperty(property.id, direction) : undefined}
                  /* The primary column cannot be deleted: a table with no name column
                     has no way to open a row, and a row here is a page. */
                  onDelete={onDeleteProperty && property.id !== primaryPropertyId ? () => onDeleteProperty(property.id) : undefined}
                  onDuplicate={onDuplicateProperty && property.id !== primaryPropertyId ? () => onDuplicateProperty(property.id) : undefined}
                  onHide={onHideProperty && property.id !== primaryPropertyId ? () => onHideProperty(property.id) : undefined}
                  onResize={onResizeProperty ? (next) => setDrifting((was) => ({ ...was, [property.id]: next })) : undefined}
                  onCommitWidth={onResizeProperty ? (next) => onResizeProperty(property.id, next) : undefined}
                />
              </th>
            ))}
            {onAddProperty ? (
              <th scope="col" className="db-th db-th-add">
                <AddPropertyMenu onPick={onAddProperty} />
              </th>
            ) : null}
            <th scope="col" className="db-th db-th-filler" aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {set.rows.map((row) => (
            <tr
              key={row.id}
              data-row-id={row.id}
              /* A row is a page, and the class says so: `db-row-open` is what makes the
                 double-click below a promise rather than a hint. */
              className={["db-row", onOpenRow ? "db-row-open" : "", selected.has(row.id) ? "is-selected" : "", dragging === row.id ? "is-dragging" : "", dragging && over?.id === row.id && dragging !== row.id ? "is-drop-over" : ""].filter(Boolean).join(" ")}
              onDoubleClick={() => onOpenRow?.(row.id)}
            >
              {/* The row's own controls, in the order a hand reaches for them — and in
                  the editor's order, not a table's: `+` then grip then the tick. Every
                  block on the page draws that pair (see `components/frame-anchor.tsx`),
                  so a row renders the same component rather than a second pair built to
                  match. Same 39x30, same 19.5+19.5 split, same hover.

                  `.db-gutter` is zero-wide and its contents hang outside the table's own
                  box, at every width — the grid starts on the content edge, as every
                  other block on the page does. `--db-shelf` / `--db-col` in `database.css`
                  own that geometry; there is no second layout to keep in step.

                  The grip does both jobs a grip does elsewhere: dragged, it moves the
                  entry; clicked, it opens the entry's menu. Same split as the object
                  menu — a press that never travels is a click. */}
              <td className="db-cell db-gutter">
                <div className="db-gutter-inner">
                  {onNewRowAfter ? (
                    <FrameAnchor
                      inline
                      anchorRef={menuFor === row.id ? (element) => { menuAnchor.current = element; } : undefined}
                      addLabel="Add a page below this one"
                      addTest="dbAddRow"
                      onAdd={() => onNewRowAfter(row.id)}
                      onGrip={() => {
                        /* A drag ends with a click on the grip that started it; that
                           click must not be read as "open the menu". */
                        if (suppress.current) { suppress.current = false; return; }
                        setMenuFor((was) => (was === row.id ? null : row.id));
                      }}
                      gripOpen={menuFor === row.id}
                      gripLabel={sortable ? "Drag to reorder, or open the menu" : "Open the menu"}
                      gripTest="dbGrip"
                      gripClass={sortable ? "db-grip" : "db-grip is-inert"}
                      gripPointer={
                        onReorderRows && sortable
                          ? {
                              onPointerDown: dragStart(row.id),
                              onPointerMove: dragMove,
                              onPointerUp: dragEnd,
                              onPointerCancel: dragEnd,
                            }
                          : undefined
                      }
                    />
                  ) : null}
                  <input
                    type="checkbox"
                    className="db-check"
                    aria-label={`Select ${row.title || "Untitled"}`}
                    checked={selected.has(row.id)}
                    onChange={() => toggle(row.id)}
                  />
                  {/* The entry's own menu, anchored to the pair that opened it. Two verbs
                      and no more: the other objects' menu carries colour and "turn into"
                      because a block has a shape. An entry has a page — everything else
                      it can do, it does there. */}
                  {onDuplicateRow || onTrashRow ? (
                    <MenuSurface anchor={menuAnchor} open={menuFor === row.id} onClose={() => setMenuFor(null)} width={200}>
                      {onDuplicateRow ? (
                        <MenuItem
                          icon={<Copy size={14} />}
                          label="Duplicate"
                          onSelect={() => {
                            setMenuFor(null);
                            onDuplicateRow(row.id);
                          }}
                        />
                      ) : null}
                      {onTrashRow ? (
                        <MenuItem
                          icon={<Trash2 size={14} />}
                          label="Move to trash"
                          danger
                          onSelect={() => {
                            setMenuFor(null);
                            onTrashRow(row.id);
                          }}
                        />
                      ) : null}
                    </MenuSurface>
                  ) : null}
                </div>
              </td>
              {set.properties.map((property) => (
                <td key={property.id} className={property.id === primaryPropertyId ? "db-cell db-cell-name" : "db-cell"}>
                  {property.id === primaryPropertyId ? (
                    <div className="db-name-cell">
                      <EntryIcon
                        icon={row.icon}
                        label={row.title}
                        onChange={onIconRow ? (icon) => onIconRow(row.id, icon) : undefined}
                      />
                      {editable ? (
                        <CellEditor
                          property={property}
                          value={row.title}
                          placeholder="Untitled"
                          autoFocus={row.id === focusRow}
                          onCommit={(value) => onCell?.(row.id, property.id, value)}
                        />
                      ) : (
                        <span className="db-cell-text">{formatCell(property, row.title)}</span>
                      )}
                      {/* The page is the point. A row that can be opened only by
                          double-clicking the right pixel is a row most people will
                          never open, so the affordance is a named button that appears
                          where the name ends. */}
                      {onOpenRow ? (
                        <button
                          type="button"
                          className="db-open"
                          title="Open this page"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenRow(row.id);
                          }}
                        >
                          Open
                        </button>
                      ) : null}
                    </div>
                  ) : editable ? (
                    <CellEditor
                      property={property}
                      value={property.id === primaryPropertyId ? row.title : row.cells[property.id] ?? null}
                      placeholder={property.id === primaryPropertyId ? "Untitled" : undefined}
                      autoFocus={row.id === focusRow && property.id === primaryPropertyId}
                      onCommit={(value) => onCell?.(row.id, property.id, value)}
                    />
                  ) : (
                    <span className="db-cell-text">{formatCell(property, property.id === primaryPropertyId ? row.title : row.cells[property.id] ?? null)}</span>
                  )}
                </td>
              ))}
              {onAddProperty ? <td className="db-cell db-cell-add" /> : null}
              <td className="db-cell db-cell-filler" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
      {/* A compact button, not a full-width bar: a 900px button for a 90px label is a
          control pretending to be a section. It hugs its own text and sits where the next
          row would be, which is where people already look for "one more". */}
      {onNewRow ? (
        <button
          type="button"
          className="db-new-row"
          onClick={onNewRow}
          onMouseDown={(event) => event.preventDefault()}
          /* "New page", not "New row": a table's row is a calendar's date and a
             board's card, and a row is a page in all three. The most specific of
             those words is the one that keeps having to be renamed. */
          title="Add a page to this database"
        >
          <Plus size={14} />
          <span>New page</span>
        </button>
      ) : null}
      {hiddenProperties.length && onShowProperty ? (
        <HiddenProperties properties={hiddenProperties} onShow={onShowProperty} />
      ) : null}
      {/* A database with only its Name column is the state every new database starts
          in, and the bare `+` in the header was the only way out of it. Say so once,
          where the person is already looking. */}
      {!set.total && set.properties.length === 1 ? (
        <p className="db-hint">
          Add a property with <strong>Add property</strong> in the header — Status, Date, Select — then
          use <strong>New page</strong> for the first one.
        </p>
      ) : null}
      {!set.rows.length && !onNewRow ? (
        <p className="db-empty">
          {set.total ? "Every page is filtered out by this view." : "No pages yet."}
        </p>
      ) : null}
      {/* Selection is ephemeral, so it has to be *legible*: ticks that survive nothing
          and add up to nothing are indistinguishable from a rendering bug. The count
          is also the only place a bulk action will be able to live later. */}
      {selected.size ? (
        <p className="db-selected">
          <span>{selected.size === 1 ? "1 page selected" : `${selected.size} pages selected`}</span>
          <button type="button" className="db-selected-clear" onClick={() => setSelected(new Set<string>())}>
            Clear
          </button>
        </p>
      ) : null}
      {set.total > set.rows.length ? (
        <p className="db-count">Showing {set.rows.length} of {set.total}</p>
      ) : null}
      {/* One layer for the whole table: the ghosted entry under the cursor and the
          insertion line between rows. `DragLayer` portals both to <body>, so the table's
          own `overflow-x: auto` cannot clip them. */}
      <DragLayer ghost={dragView?.ghost ?? null} line={dragView?.line ?? null} />
    </>
  );
}

/**
 * The way back from Hide.
 *
 * Hiding a column without a way to show it again is deleting it with extra steps, so the
 * chip is not optional decoration: it is what makes `Hide` safe to offer at all.
 */
function HiddenProperties({ properties, onShow }: { properties: PropertyDef[]; onShow: (propertyId: string) => void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);
  useMenuDismiss(open, close);

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="db-hidden-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(event) => {
          event.preventDefault();
          setOpen((was) => !was);
        }}
      >
        <EyeOff size={12} aria-hidden />
        <span>
          {properties.length} hidden column{properties.length === 1 ? "" : "s"}
        </span>
      </button>
      <MenuSurface anchor={anchor} open={open} onClose={close} width={240}>
        <MenuHeading>Hidden in this view</MenuHeading>
        {properties.map((property) => (
          <MenuItem
            key={property.id}
            icon={<PropertyIcon name={iconNameFor(property)} size={14} />}
            label={property.name}
            hint="Show this column again"
            onSelect={() => {
              onShow(property.id);
              if (properties.length === 1) close();
            }}
          />
        ))}
      </MenuSurface>
    </>
  );
}
