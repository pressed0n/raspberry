"use client";
/* The database block — what a page shows where a table goes.
   ---------------------------------------------------------------------------
   The block is a *reference*. Its props hold `databaseId` and an optional `viewId`,
   and the schema, the views and the cells arrive from `/api/databases/:id`. Nothing
   about a cell edit passes through the page document, which is what keeps typing in
   a cell from rewriting the page, bumping its revision and colliding with the draft
   it is sitting in.

   Everything is `onMouseDown={preventDefault}` on the interactive bits: this lives
   inside BlockNote's editor, and letting a mousedown move the caret into the block's
   own content puts the cursor in a place that has no text and swallows the click. */
import { Database as DatabaseIcon, LoaderCircle } from "lucide-react";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { request, RequestError } from "@/lib/api-client";
import { resolveProperty } from "@/lib/database/properties";
import { defaultViewConfig, primaryPropertyId, type CellValue, type DatabasePayload, type PropertyType, type ViewDef } from "@/lib/database/types";
import { nextSorts } from "@/lib/database/rows";
import { EditorBridgeContext } from "../editor/schema";
import { useDatabase } from "./use-database";
import type { SortDirection } from "./property-header";
import { TableView } from "./table-view";

/* The block's props arrive untyped from BlockNote; narrowing here keeps the rest of
   the component honest about what it can actually rely on. */
function propsOf(props: Record<string, unknown>): { databaseId: string; viewId: string } {
  return {
    databaseId: typeof props.databaseId === "string" ? props.databaseId : "",
    viewId: typeof props.viewId === "string" ? props.viewId : "",
  };
}

const noop = (event: { preventDefault: () => void }) => event.preventDefault();

/* Presses that belong to the block's own controls. Everything else inside the block is
   inert, and the editor must not hear about it at all — see `guardPresses`. */
const PRESS_OWNERS = [
  "input", "textarea", "select", "button", "a", "label",
  "[role='button']", "[role='checkbox']", "[role='menuitem']", "[contenteditable='true']",
  /* A column resize is a `span` with a pointer handler — it owns its press for the same
     reason a button does, and it is the one control here that is not a form element. */
  ".db-th-resize",
  /* The gutter wrapper: a press on its padding, not on the grip or the tick, must still
     reach the row rather than the editor. */
  ".db-gutter-inner",
].join(", ");

export function DatabaseBlock({ props }: { props: Record<string, unknown> }) {
  const { databaseId, viewId } = propsOf(props);
  const { load, reload, apply, mutations, failure, refusal, dismissFailure } = useDatabase(databaseId);
  const bridge = useContext(EditorBridgeContext);
  const [activeId, setActiveId] = useState(viewId);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  /* The row a click just created, so its Name cell can take the cursor. Cleared by
     the next click anywhere else, which is the same thing as "you have started
     typing". */
  const [focusRow, setFocusRow] = useState("");

  /* The title field is uncontrolled while it is being typed into and re-seeded when
     the server's copy arrives, so a reload cannot overwrite a half-typed name. */
  const database = load.status === "ready" ? load.database : null;
  useEffect(() => { if (database) setTitle(database.title); }, [database?.id, database?.title]);

  /* A block that names a view shows that view; otherwise the first one. The
     selection is local state so switching tabs does not write to the document —
     only an explicit "set as block's view" would, and that is a later phase. */
  const view: ViewDef | null = useMemo(() => {
    if (!database?.views.length) return null;
    return database.views.find((item) => item.id === activeId) ?? database.views[0];
  }, [database, activeId]);

  const rename = useCallback(async () => {
    if (!database || title === database.title) return;
    setSaving(true);
    const next = title.trim() || "Untitled database";
    try {
      const { database: updated } = await request<{ database: DatabasePayload }>(`/api/databases/${encodeURIComponent(database.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ title: next, expectedRevision: database.revision, mutationId: crypto.randomUUID() }),
      });
      apply(updated);
    } catch (error) {
      /* A conflict is not a crash: the other tab's title is now the truth, so show it
         rather than silently keeping a name the server rejected. */
      if (error instanceof RequestError) await reload();
    } finally { setSaving(false); }
  }, [apply, database, reload, title]);

  /* ---------------------------------------------------------------------------
     The three things the table could not do before: add a property, add a row, and
     write a value into one. Declared above the loading branches so the hook order is
     the same on every render — a `useCallback` below a `return` is a conditional hook.
     --------------------------------------------------------------------------- */

  /* `after` is what the per-row `+` sends. Both gestures end in the same place — the
     cursor in the new page's Name cell — because "add a page" is one thought whether
     it is asked for at the bottom or in the middle. */
  const addRow = useCallback(async (after?: string, title = "") => {
    /* The cursor goes into the new row's Name cell: "add a page" should be one click
       and then typing, not one click and then a hunt for where it went. The created id
       is found by diffing, because the server decides it. */
    const before = new Set((load.status === "ready" ? load.database.rows : []).map((row) => row.id));
    const next = await mutations.addRow(title, after);
    const created = next?.rows.find((row) => !before.has(row.id));
    if (created) setFocusRow(created.id);
    /* Rows are pages, so the sidebar's page list is stale the moment one exists. */
    void bridge?.onPagesChanged?.();
  }, [load, mutations, bridge]);

  const reorderRows = useCallback((ids: string[]) => void mutations.reorderRows(ids), [mutations]);

  /* The grip menu's two verbs, wired the same way `reorderRows` is: the mutation
     returns the whole database, so the table re-renders from the server's answer rather
     than from a guess about where the new row went. */
  const duplicateRow = useCallback((rowId: string) => void mutations.duplicateRow(rowId).then(() => bridge?.onPagesChanged?.()), [mutations, bridge]);
  const trashRow = useCallback((rowId: string) => void mutations.trashRow(rowId).then(() => bridge?.onPagesChanged?.()), [mutations, bridge]);

  const writeCell = useCallback((rowId: string, propertyId: string, value: CellValue) => {
    if (propertyId === primaryPropertyId) void mutations.patchRow(rowId, { title: typeof value === "string" ? value : "" });
    else void mutations.patchRow(rowId, { cells: { [propertyId]: value } });
  }, [mutations]);

  /* ---------------------------------------------------------------------------
     Presentation writes. These go to the *view*, not the schema: a wider column or a
     sort is not a structural change, so it must not touch the database revision two
     tabs are already negotiating over.

     Every one of them reads `view.config` from the render that produced the callback,
     which is correct because the server merges a partial config rather than replacing
     it — two quick adjustments cannot erase each other.
     --------------------------------------------------------------------------- */

  const patchViewConfig = useCallback((config: Record<string, unknown>) => {
    if (!view?.id) return;
    void mutations.patchView(view.id, { config });
  }, [mutations, view?.id]);

  const resizeProperty = useCallback((propertyId: string, width: number) => {
    const widths = { ...(view?.config ?? defaultViewConfig).widths, [propertyId]: width };
    patchViewConfig({ widths });
  }, [patchViewConfig, view?.config]);

  const sortProperty = useCallback((propertyId: string, direction: SortDirection | null) => {
    /* The interesting part is the array, not the click, so the rule lives in
       `nextSorts` where it can be tested without a browser. */
    const current = (view?.config ?? defaultViewConfig).sorts;
    patchViewConfig({ sorts: nextSorts(current, propertyId, direction) });
  }, [patchViewConfig, view?.config]);

  const iconProperty = useCallback((propertyId: string, icon: string) => {
    /* The primary property is not a row in `database_properties`, but it is still a
       property edit — the server routes the reserved id to the database row. */
    void mutations.patchProperty(propertyId, { icon });
  }, [mutations]);

  /* How a column presents its values.
     ------------------------------------------------------------------------------
     `patchProperty` sends a config that the server **parses whole**, filling every key
     it does not find with that type's default. So the menu's two-key change ("format",
     "currency") must be merged onto the config as it stands, here — sending just the
     two keys would silently reset the column's decimal places and every key added
     later to the same object.

     It returns the write, and that return value is load-bearing. Creating a tag is
     this call followed by a cell write naming the new option id, and the server's
     `coerce` resolves that id against the config — so the cell must not be written
     until this has landed, or the tag is written as empty and silently disappears. */
  const configProperty = useCallback((propertyId: string, patch: Record<string, unknown>) => {
    const property = database?.properties.find((candidate) => candidate.id === propertyId);
    if (!property) return Promise.resolve(null);
    return mutations.patchProperty(propertyId, { config: { ...(property.config ?? {}), ...patch } });
  }, [mutations, database?.properties]);

  /* Changing what a column holds.
     ------------------------------------------------------------------------------
     The server reads every stored value through the new type and refuses the change
     when some of them cannot be read, answering with how many. That refusal is turned
     back into a *choice*: `refusal` is the only place the table learns about it, and the
     header menu renders one extra item — "Change to Date anyway / clears 1 cell" — which
     comes back through this same function with `anyway` true. Nothing on this path
     clears a value the person has not seen counted out loud. */
  const typeRefusal = useMemo(() => {
    if (refusal?.code !== "property_in_use") return null;
    const details = refusal.details as { propertyId?: string; cells?: number; type?: PropertyType } | undefined;
    if (!details?.propertyId || !details.type || typeof details.cells !== "number") return null;
    return details as { propertyId: string; cells: number; type: PropertyType };
  }, [refusal]);

  const changeType = useCallback((propertyId: string, type: PropertyType, anyway = false) => {
    void mutations.patchProperty(propertyId, anyway ? { type, clearUnconvertible: true } : { type });
  }, [mutations]);

  const refusalOf = useCallback((propertyId: string) => (
    typeRefusal && typeRefusal.propertyId === propertyId
      ? { type: typeRefusal.type, cells: typeRefusal.cells }
      : null
  ), [typeRefusal]);

  /* Which properties this view has hidden.
     `visibleProperties` is empty by default, and empty *means* "all of them" — so hiding
     is expressed as the list of what is shown. Reading it the other way round (an empty
     list meaning "show nothing") would have hidden every column on every database that
     has never had a column hidden, which is all of them. */
  const visibleIds = useMemo(() => {
    if (!database || !view) return [];
    const all = [primaryPropertyId, ...database.properties.map((property) => property.id)];
    return view.config.visibleProperties.length ? view.config.visibleProperties : all;
  }, [database, view]);

  const hiddenIds = useMemo(
    () => (database ? database.properties.map((property) => property.id).filter((id) => !visibleIds.includes(id)) : []),
    [database, visibleIds],
  );

  const hideProperty = useCallback((propertyId: string) => {
    const next = visibleIds.filter((id) => id !== propertyId);
    /* Never an empty list: empty means "show everything", so hiding the last visible
       column would bring every column back. `[primaryPropertyId]` says what it means. */
    patchViewConfig({ visibleProperties: next.length ? next : [primaryPropertyId] });
  }, [patchViewConfig, visibleIds]);

  const showProperty = useCallback((propertyId: string) => {
    if (visibleIds.includes(propertyId)) return;
    patchViewConfig({ visibleProperties: [...visibleIds, propertyId] });
  }, [patchViewConfig, visibleIds]);

  /* Adding a column has to *show* the column.
     A view's `visibleProperties` is empty until something is hidden, and empty means
     "everything" — but the moment one column has been hidden the list becomes explicit,
     and a new property is no longer in it. Without this, adding a column right after using
     Hide would create it silently: present in the schema, absent from the table.

     Named after its type and renamed in place afterwards: a column called "Number" is a
     starting point, an unnamed column is a bug. */
  const addProperty = useCallback(async (
    type: PropertyType,
    name = resolveProperty({ type }).label,
    extra?: { config?: unknown; icon?: string },
  ) => {
    const before = new Set(database?.properties.map((property) => property.id) ?? []);
    const next = await mutations.addProperty(type, name, extra);
    if (!next || !view) return next;
    const added = next.properties.filter((property) => !before.has(property.id)).map((property) => property.id);
    const visible = view.config.visibleProperties;
    if (added.length && visible.length) patchViewConfig({ visibleProperties: [...visible, ...added] });
    return next;
  }, [database?.properties, mutations, patchViewConfig, view]);

  const duplicateProperty = useCallback((propertyId: string) => {
    const property = database?.properties.find((item) => item.id === propertyId);
    if (!property) return;
    /* Config travels with the copy: a duplicate of a Status column that came back with
       empty option lists would be a column of nothing. The primary property has no
       `database_properties` row to copy, so the table does not offer this for it. */
    void addProperty(property.type, `${property.name} copy`, { config: property.config, icon: property.icon });
  }, [addProperty, database?.properties]);

  const iconRow = useCallback((rowId: string, icon: string) => {
    void mutations.patchRow(rowId, { icon });
  }, [mutations]);

  /* The editor does not get to hear a press that landed on the block's own surface (B40g).
     ---------------------------------------------------------------------------------
     `onMouseDown={preventDefault}` on the controls, as this file's header explains, is not
     enough to keep the caret out: React's listeners are attached to the React root, which
     sits *above* ProseMirror's editor DOM, so by the time any of them runs, ProseMirror has
     already handled the press.

     Two things then went wrong on the table's inert areas — the filler column, the space
     under the rows, the block's own padding:

       1. `selectClickedLeaf` turned the press into a `NodeSelection` on the database, and
          BlockNote painted the block-selection ring in the primary colour. The ring could
          not be dismissed from inside the block (those presses are prevented), so it
          survived until a reload — the owner's "its stuck on that state until you refresh".

       2. Even with the block marked `selectable: false`, a *second* press in the same
          place took ProseMirror's `Selection.near` branch, which builds a `NodeSelection`
          without consulting `selectable` at all. That is why one click looked harmless and
          the next one selected the block.

     A native listener in the *capture* phase runs before ProseMirror's, which listens on
     `.tiptap` in the bubble phase. A press that did not start on one of the block's own
     controls stops here: no caret, no node selection, and therefore no Backspace that
     deletes the whole database because a ring was painted on it.

     A callback ref, not `useRef` + effect: the block returns early while loading, so an
     effect with `[]` would attach to nothing and never run again. */
  const guardPresses = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    /* Attached to the *band* the block occupies, not to `.db-block` itself.
       The owner: "There is still a very small hitbox at the top of the database block
       that when pressed will highlight the database object". It was six pixels: the
       editor's `.bn-editor .bn-block-content { padding: 2px 0 }` plus this block's own
       `margin: 4px 0`. A **margin is not hit-testable** — those pixels belong to
       `.bn-block-content`, which is inside `.tiptap`, so ProseMirror's own handler saw a
       press on the database node and built the very `NodeSelection` this guard exists to
       prevent. A guard on `.db-block` cannot see a press outside `.db-block`; measured in
       the browser, `elementFromPoint` resolved all six rows to the wrapper.
       `.bn-block-content` is the smallest element whose box *is* that band, so guarding it
       covers the block plus every gap it is given, at any width, without measuring. */
    const surface = node.closest<HTMLElement>(".bn-block-content") ?? node;
    const guard = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      /* The match has to be *inside* this block. BlockNote's editor root is itself
         `contenteditable="true"`, so a bare `closest()` finds it from every press in the
         page and would excuse all of them — the guard would be present, attached, and
         never once fire. */
      const owner = target.closest(PRESS_OWNERS);
      if (owner && node.contains(owner)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    surface.addEventListener("mousedown", guard, true);
    return () => surface.removeEventListener("mousedown", guard, true);
  }, []);

  if (load.status === "loading") {
    return <div className="db-block db-block-state"><LoaderCircle size={15} className="db-spin" />Loading database…</div>;
  }
  if (load.status === "missing") {
    return (
      <div className="db-block db-block-state">
        <DatabaseIcon size={15} />
        <span>This database is gone. The block can be deleted.</span>
      </div>
    );
  }
  if (load.status === "error") {
    return (
      <div className="db-block db-block-state db-block-error">
        <DatabaseIcon size={15} />
        <span>{load.message}</span>
        <button type="button" className="db-mini-btn" onClick={() => void reload()} onMouseDown={noop}>Retry</button>
      </div>
    );
  }

  const payload = load.database;
  return (
    <div className="db-block" contentEditable={false} suppressContentEditableWarning ref={guardPresses}>
      <div className="db-head">
        <input
          className="db-title"
          value={title}
          aria-label="Database title"
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => void rename()}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
            if (event.key === "Escape") { setTitle(payload.title); event.currentTarget.blur(); }
          }}
          onMouseDown={(event) => event.stopPropagation()}
        />
        {saving ? <span className="db-saving">Saving…</span> : null}
      </div>

      <div className="db-tabs" role="tablist" aria-label="Views">
        {payload.views.map((item) => (
          <button
            key={item.id || item.type}
            type="button"
            role="tab"
            aria-selected={item.id === view?.id}
            className={item.id === view?.id ? "db-tab db-tab-active" : "db-tab"}
            onClick={() => setActiveId(item.id)}
            onMouseDown={noop}
          >
            {item.name}
          </button>
        ))}
      </div>

      {view && view.type === "table"
        ? <TableView
            database={payload}
            view={{ ...view, config: view.config ?? defaultViewConfig }}
            focusRow={focusRow}
                  onNewRow={(title) => void addRow(undefined, title)}
                  onNewRowAfter={(rowId) => void addRow(rowId)}
                  onReorderRows={reorderRows}
                  onDuplicateRow={duplicateRow}
                  onTrashRow={trashRow}
            onOpenRow={(rowId) => void bridge?.onOpenPage(rowId)}
            onAddProperty={(type) => void addProperty(type)}
            onRenameProperty={(propertyId, name) => void mutations.patchProperty(propertyId, { name })}
            onIconProperty={iconProperty}
            onDeleteProperty={(propertyId) => void mutations.deleteProperty(propertyId)}
            onDuplicateProperty={duplicateProperty}
            onHideProperty={hideProperty}
            hidden={hiddenIds}
            onShowProperty={showProperty}
            onIconRow={iconRow}
            onResizeProperty={resizeProperty}
            onSortProperty={sortProperty}
            onTypeProperty={changeType}
            onConfigProperty={configProperty}
            refusalOf={refusalOf}
            onCell={writeCell}
          />
        : <div className="db-block-state db-block-error">This view type is not built yet.</div>}

      {failure ? (
        <button type="button" className="db-failure" onClick={dismissFailure} onMouseDown={noop}>
          {failure}
          <span className="db-failure-hint">Dismiss</span>
        </button>
      ) : null}
    </div>
  );
}
