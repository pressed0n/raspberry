"use client";
/* Tags — Select, Multi-select and Status, and the menu that makes them.
   ---------------------------------------------------------------------------
   These three types used to be a native `<select>`. That is exactly why the property
   read as *broken*: a `<select>` can only choose from options that already exist, so
   there was no way to create a tag, no way to colour one, and on Multi-select — where
   the value is a list — picking a second tag silently replaced the first.

   Four decisions are worth the words:

   1. A cell stores an option **id**; the name and the colour live in the property's
      config (`property-types/option.ts`). So "create a tag" is a *property* write
      followed by a *cell* write, in that order, and the order is load-bearing: the
      server's `coerce` resolves the id against the config and drops what it cannot
      find, so a cell written first would be written as empty. `create()` awaits
      `onConfig` before it commits. Do not "simplify" that into two fire-and-forget
      calls — the tag will appear and then vanish.

   2. The option's own panel (`⋯`) opens on **click**, not hover. The B40m bug was a
      hover corridor between a row and its submenu; a panel behind an explicit button
      has no corridor to fall into. Notion is a click here too.

   3. Colours are `COLOR_NAMES` from `palette.ts` plus "default" — the same names the
      server validates against in `tagColors` — and the chips are the `.swatch`
      control the block colour panel already uses. Nothing here invents a second
      colour vocabulary, and the picker is a vertical list rather than a grid because
      a submenu is 252px wide.

   4. The trigger is a *button*, not an open editor, because `TableView` mounts
      `CellEditor` for every cell whenever the table is editable. A control that
      opened itself would open on every row at once.
*/
import { useCallback, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { ArrowDown, ArrowUp, Check, MoreHorizontal, Trash, X } from "lucide-react";
import { COLOR_NAMES } from "@/lib/palette";
import { optionIdsOf, optionsOf, type OptionLike } from "@/lib/database/property-types/shared";
import { groupIdOf, groupsOf, valueIsChecked } from "@/lib/database/property-types/groups";
import { moveBySteps, moveRelative } from "@/lib/database/order";
import type { CellValue, PropertyDef } from "@/lib/database/types";
import { MenuDivider, MenuHeading, MenuItem, MenuSurface, useMenuDismiss } from "./menu";
import { GripButton, type GripPointerHandlers } from "@/components/grip-glyphs";
import { GroupRow, NewGroupBlock, useGroupEditor } from "./group-controls";

import {
  TAG_COLORS,
  COLOR_TEXT,
  asTagColor,
  newOptionId,
  nextColor,
  type TagColorName,
} from "@/lib/database/property-types/option-ids";

function TagChip({ option, onRemove }: { option: OptionLike; onRemove?: () => void }) {
  return (
    <span className="db-tag" data-color={asTagColor(option.color)}>
      <span className="db-tag-name">{option.name}</span>
      {onRemove ? (
        <button
          type="button"
          className="db-tag-x"
          aria-label={`Remove ${option.name}`}
          /* The press must not reach the trigger: that would toggle the panel shut on
             the way to removing a tag. */
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <X size={9} aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

/** The `⋯` panel: rename, recolour, delete. Anchored to its own row's button. */
function OptionEditor({
  anchor,
  option,
  onRename,
  onColor,
  onMove,
  canMoveUp,
  canMoveDown,
  onDelete,
  onClose,
}: {
  anchor: React.RefObject<HTMLButtonElement | null>;
  option: OptionLike;
  onRename: (name: string) => void;
  onColor: (color: TagColorName) => void;
  onMove: (delta: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(option.name);
  const current = asTagColor(option.color);

  /* `MenuSurface` places a surface and nothing else — dismissal is the caller's job, and
     every other menu in the app pairs the two. Without this the colour panel could only be
     closed by pressing its own `⋯` again: a press on the page did nothing at all. */
  useMenuDismiss(true, onClose);

  /* Rename commits on every keystroke except the empty one: the write lands on the
     property, which every cell in the column reads, so there is nothing to "submit".
     An empty name is refused because `optionSchema` allows it and an unnamed tag is
     unclickable. */
  const setName_ = (next: string) => {
    setName(next);
    if (next.trim()) onRename(next);
  };

  return (
    <MenuSurface anchor={anchor} open onClose={onClose} width={252} side="right">
      <div className="db-option-name">
        <input
          className="db-prop-name"
          value={name}
          aria-label="Option name"
          autoFocus
          onChange={(event) => setName_(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Escape") {
              event.preventDefault();
              if (event.key === "Escape") setName(option.name);
              onClose();
            }
          }}
        />
      </div>
      <MenuItem icon={<ArrowUp size={14} />} label="Move up" disabled={!canMoveUp} onSelect={() => onMove(-1)} />
      <MenuItem icon={<ArrowDown size={14} />} label="Move down" disabled={!canMoveDown} onSelect={() => onMove(1)} />
      <MenuDivider />
      <MenuItem icon={<Trash size={14} />} label="Delete" danger onSelect={onDelete} />
      <MenuDivider />
      <MenuHeading>Colors</MenuHeading>
      <div className="db-option-colors">
        {TAG_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            role="menuitemradio"
            aria-checked={color === current}
            data-menuitem=""
            className="db-menu-item db-menu-row"
            onClick={() => onColor(color)}
          >
            <span
              className="swatch"
              /* "Default" is the absence of a colour, so it must still be *visible* as a
                 chip: painting it `--raised` made it identical to the panel behind it and
                 the row looked like it had lost its swatch. `--hairline-strong` reads as a
                 faint neutral chip in both themes. */
              style={{ ["--swatch" as string]: color === "default" ? "var(--hairline-strong)" : `var(--palette-${color}-background)` }}
              aria-hidden
            />
            <span className="db-menu-label">{COLOR_TEXT[color]}</span>
            {color === current ? <Check size={14} className="db-menu-check" aria-hidden /> : null}
          </button>
        ))}
      </div>
    </MenuSurface>
  );
}

/** One option in the list: pick it, edit it, or drag it by the grip. Three buttons,
    never nested. */
function OptionRow({
  option,
  checked,
  role,
  onPick,
  onUpdate,
  onDelete,
  onMove,
  canMoveUp,
  canMoveDown,
  grip,
  dragging,
  dropSide,
  editing,
  onEditingChange,
}: {
  option: OptionLike;
  checked: boolean;
  role: "menuitemradio" | "menuitemcheckbox";
  onPick: () => void;
  onUpdate: (patch: { name?: string; color?: TagColorName }) => void;
  onDelete: () => void;
  onMove: (delta: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** Absent while the list is filtered: a subset has no meaningful index to drop into. */
  grip?: GripPointerHandlers;
  dragging?: boolean;
  dropSide?: "before" | "after";
  /* Owned by the panel, not by the row: only one `⋯` panel may be open at a time.

     It could not be per-row. `useMenuDismiss` ignores a press that lands anywhere inside
     `[data-db-popover]`, so the previous row's panel can never be closed by pressing
     *another* row's `⋯` — that button lives inside the main panel's popover, and the press
     reads as "inside". Two colour panels then sat side by side and the second press looked
     like it did nothing, which is the exact shape of bug this menu already cost us once. */
  editing: boolean;
  onEditingChange: (open: boolean) => void;
}) {
  const more = useRef<HTMLButtonElement>(null);

  return (
    <div
      className="db-option-row"
      data-option-id={option.id}
      data-dragging={dragging ? "" : undefined}
      data-drop={dropSide}
    >
      {grip ? (
        <GripButton
          label={`Reorder ${option.name}`}
          extraClass="db-option-grip"
          pointer={grip}
          tabIndex={-1}
        />
      ) : null}
      <button
        type="button"
        role={role}
        aria-checked={checked}
        data-menuitem=""
        className="db-option-pick"
        onClick={onPick}
      >
        <TagChip option={option} />
        {checked ? <Check size={13} className="db-option-check" aria-hidden /> : null}
      </button>
      <button
        ref={more}
        type="button"
        className="db-option-more"
        data-menuitem=""
        aria-haspopup="menu"
        aria-expanded={editing}
        aria-label={`Edit ${option.name}`}
        onClick={() => onEditingChange(!editing)}
      >
        <MoreHorizontal size={13} aria-hidden />
      </button>
      {editing ? (
        <OptionEditor
          anchor={more}
          option={option}
          onClose={() => onEditingChange(false)}
          onRename={(name) => onUpdate({ name })}
          onColor={(color) => onUpdate({ color })}
          onMove={onMove}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          onDelete={() => {
            onEditingChange(false);
            onDelete();
          }}
        />
      ) : null}
    </div>
  );
}

export function OptionCell({
  property,
  value,
  onCommit,
  onConfig,
  autoFocus,
}: {
  property: PropertyDef;
  value: CellValue;
  onCommit: (value: CellValue) => void;
  /* Writes the property's config. Returns the write so `create` can order the cell
     write after it — see the file comment, point 1. */
  onConfig?: (patch: Record<string, unknown>) => Promise<unknown> | void;
  autoFocus?: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(Boolean(autoFocus));
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    /* A closed panel forgets which row had its `⋯` open. Leaving it set would reopen that
       row's panel on the next open, with a stale anchor to a button that has been re-rendered
       — `MenuSurface` positions from a live rect, so the surface would land wherever the row
       happened to be by then. */
    setEditingId(null);
  }, []);
  /* The panel needs the same dismissal as every other menu: a press on the page closes it,
     Escape closes it. `MenuSurface` does not register either — see its callers. */
  useMenuDismiss(open, close);

  const multiple = property.type === "multiSelect";
  /* Status is the one type whose config carries a second list beside the tags. `groupsOf`
     materialises the three defaults for a column whose groups have never been written, so
     the sections can be drawn without touching the owner's data. */
  const status = property.type === "status";
  const groups = useMemo(() => groupsOf(property.config), [property.config]);
  const options = useMemo(() => optionsOf(property.config), [property.config]);
  /* The raw entries, so a write keeps every key the server filled in that this control
     does not know about. Sending `optionsOf`'s projection would drop them. */
  const raw = useMemo<Record<string, unknown>[]>(() => {
    const list = (property.config as { options?: unknown } | undefined)?.options;
    return Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
  }, [property.config]);
  const selectedIds = useMemo(() => optionIdsOf(value, property.config), [value, property.config]);
  const selected = new Set(selectedIds);
  const chips = selectedIds
    .map((id) => options.find((option) => option.id === id))
    .filter((option): option is OptionLike => Boolean(option));

  const writeOptions = useCallback(
    (next: Record<string, unknown>[]) => {
      if (!onConfig) return;
      /* A Status config carries `groups` beside `options`, and the server validates the
         whole object it is handed — so an option write sends both lists or it silently
         hands back a column with no groups. The defaults are written here, on the first
         *edit*, never on open: the panel materialises them for reading, and storing them
         is a consequence of changing something. */
      void onConfig(status ? { options: next, groups } : { options: next });
    },
    [groups, onConfig, status],
  );

  /* Reordering, in one place, for two gestures: a grip drag and `⋯` → Move up/down.
     Both resolve their positions by **id**, never by index into `matches` — that is a
     filtered projection of the config, and an index into a subset is not an index into
     the property. The splice itself lives in `lib/database/order.ts` so the off-by-one
     can be tested without a browser. */
  const applyOrder = useCallback(
    (order: string[] | null) => {
      if (!order) return;
      /* Rebuilt from the ids so every key the server filled in survives the move — the
         same reason `raw` is read from the config instead of from `optionsOf`. */
      const byId = new Map(raw.map((entry) => [entry.id as string, entry]));
      writeOptions(order.map((id) => byId.get(id) as Record<string, unknown>));
    },
    [raw, writeOptions],
  );
  const rawIds = useMemo(() => raw.map((entry) => entry.id as string), [raw]);

  const reorder = useCallback(
    (id: string, targetId: string) => applyOrder(moveRelative(rawIds, id, targetId)),
    [applyOrder, rawIds],
  );

  const moveBy = useCallback(
    (id: string, delta: -1 | 1) => applyOrder(moveBySteps(rawIds, id, delta)),
    [applyOrder, rawIds],
  );

  /* The grip's gesture. Armed after 4px of travel, like the row gutter's grip and for the
     same reason: a press that never moves is a click, and a click must not reorder.

     The row under the pointer is read with `elementFromPoint`, not with hover events —
     pointer capture sends every move to the pressed button, so the other rows never fire
     `pointerenter` at all. `closest` then turns "which row" into an id without measuring
     a single rectangle.

     A filtered list hides the grip instead: dropping into a subset would have to invent
     which of the hidden siblings the target is beside. Notion hides it here too. */
  const sortable = query.trim() === "";
  const [drag, setDrag] = useState<{ id: string; over: string | null } | null>(null);
  const gesture = useRef<{ id: string; startY: number; armed: boolean; over: string | null } | null>(null);

  const gripDown = (option: OptionLike) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { id: option.id, startY: event.clientY, armed: false, over: null };
  };

  const gripMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = gesture.current;
    if (!state) return;
    if (!state.armed) {
      if (Math.abs(event.clientY - state.startY) < 4) return;
      state.armed = true;
    }
    const over = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-option-id]")?.dataset.optionId ?? null;
    if (over === state.over) return;
    state.over = over;
    setDrag({ id: state.id, over });
  };

  const gripEnd = () => {
    const state = gesture.current;
    gesture.current = null;
    setDrag(null);
    if (state?.armed && state.over) reorder(state.id, state.over);
  };

  /* Where to draw the drop line: below a target that is further down the list, above one
     that is further up — matching where `reorder` will actually put it. */
  const dropSideFor = (id: string): "before" | "after" | undefined => {
    if (!drag || drag.over !== id) return undefined;
    const from = raw.findIndex((entry) => entry.id === drag.id);
    const to = raw.findIndex((entry) => entry.id === id);
    if (from < 0 || to < 0 || from === to) return undefined;
    return to > from ? "after" : "before";
  };

  const commit = useCallback(
    (next: CellValue) => {
      onCommit(next);
      if (!multiple) close();
    },
    [close, multiple, onCommit],
  );

  const pick = useCallback(
    (option: OptionLike) => {
      if (!multiple) {
        /* Clicking the current value clears it. Without this a select could never be
           emptied once it held anything — the bug the `<select>` hid behind a blank
           `<option>`. */
        commit(selected.has(option.id) ? null : option.id);
        return;
      }
      commit(selected.has(option.id) ? selectedIds.filter((id) => id !== option.id) : [...selectedIds, option.id]);
    },
    [commit, multiple, selected, selectedIds],
  );

  const create = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const existing = options.find((option) => option.name.toLowerCase() === trimmed.toLowerCase());
      if (existing) {
        pick(existing);
        setQuery("");
        return;
      }
      if (!onConfig) return;
      /* A tag created here lands in the column's first group. Every status tag belongs to
         one — a tag with no group is drawn under the first anyway (`groupIdOf`), and
         writing the id it is drawn under keeps the stored data saying what the panel
         shows. Creating a tag *somewhere else* is the groups pane's job. */
      const option = {
        id: newOptionId(),
        name: trimmed,
        color: nextColor(options),
        groupId: status ? (groups[0]?.id ?? null) : null,
      };
      /* The property first, and *awaited*: `coerce` resolves the id against the config,
         so a cell written before the option exists is written as null. */
      await onConfig(status ? { options: [...raw, option], groups } : { options: [...raw, option] });
      setQuery("");
      if (multiple) commit([...selectedIds, option.id]);
      else commit(option.id);
    },
    [commit, groups, multiple, onConfig, options, pick, raw, selectedIds, status],
  );

  const update = useCallback(
    (id: string, patch: { name?: string; color?: TagColorName }) => {
      writeOptions(raw.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
    },
    [raw, writeOptions],
  );

  const remove = useCallback(
    (id: string) => {
      writeOptions(raw.filter((entry) => entry.id !== id));
      /* Deleting an option leaves cells pointing at nothing. Clear this cell too rather
         than letting it render an empty tag. */
      if (multiple) {
        if (selected.has(id)) commit(selectedIds.filter((candidate) => candidate !== id));
      } else if (selected.has(id)) commit(null);
    },
    [commit, multiple, raw, selected, selectedIds, writeOptions],
  );

  const matches = query
    ? options.filter((option) => option.name.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  const placeholder = multiple ? "" : "Select…";

  /* The same editor the property menu's pane renders — one implementation, two surfaces.
     `onCreated` selects the tag that was just made: you pressed `+` on Complete because you
     wanted a tag there *and* wanted it as this cell's value. The pane passes nothing, so
     adding a tag there still only adds it. */
  const editor = useGroupEditor({
    config: property.config,
    onConfig,
    onCreated: status ? (option) => pick(option) : undefined,
  });
  const groupById = new Map(groups.map((group) => [group.id, group]));

  /* Status draws one section per group; everything else — and any search — is one flat
     list. `groupIdOf` decides which section a tag is *in*, which is why a tag stored with
     a null (every tag on a column that predates editable groups) appears under the first
     heading rather than disappearing between them. */
  const sections: { id: string | null; name: string | null; options: OptionLike[] }[] =
    !status || query.trim() !== ""
      ? [{ id: null, name: null, options: matches }]
      : groups.map((group) => ({
          id: group.id,
          name: group.name,
          options: matches.filter((option) => groupIdOf(option, groups) === group.id),
        }));

  return (
    <div className="db-tag-cell">
      <button
        ref={trigger}
        type="button"
        className={chips.length ? "db-tag-trigger" : "db-tag-trigger is-empty"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${property.name}: ${chips.length ? chips.map((option) => option.name).join(", ") : "empty"}`}
        onMouseDown={(event) => {
          /* The press is the toggle the file comment argues for; a plain `onClick`
             would fire after `mouseenter` had already opened it. */
          event.preventDefault();
          setOpen((was) => !was);
        }}
      >
        {chips.length ? (
          <>
            {/* The group's tick, where the owner asked for it: before the chip in the
                table, never in the editor. It is `.db-check` — the same box the gutter and
                the checkbox property draw — made inert by one rule, because the flag is a
                label about the group, not a control on this row. */}
            {status && chips.length === 1 ? (
              <span
                className="db-check db-tag-check"
                aria-checked={valueIsChecked(chips[0].id, property.config)}
                aria-hidden="true"
                data-testid="status-group-check"
              />
            ) : null}
            {chips.map((option) => <TagChip key={option.id} option={option} />)}
          </>
        ) : (
          <span className="db-cell-empty">{placeholder}</span>
        )}
      </button>

      <MenuSurface
        anchor={trigger}
        open={open}
        onClose={close}
        className="db-option-menu"
      >
        <div className="db-option-search">
          {multiple
            ? chips.map((option) => (
                <TagChip key={option.id} option={option} onRemove={() => pick(option)} />
              ))
            : null}
          <input
            className="db-option-input"
            value={query}
            aria-label="Search for an option"
            placeholder="Search for an option…"
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                /* Enter takes the first remaining match, or creates — which is what a
                   search box in a tag menu means by Enter. */
                if (matches.length) pick(matches[0]);
                else void create(query);
              }
              if (event.key === "Escape") {
                event.preventDefault();
                close();
              }
            }}
          />
        </div>

        <p className="db-option-hint">Select an option or create one</p>

        {/* Sections, for Status only: the whole point of the type is that its tags are
            grouped. A search flattens them, because a filtered list is a subset and a
            subset's headings claim more than they can show — the same reasoning that hides
            the grip while searching. The heading is the *shared* group row, so the `+` and
            the expandable panel are here too; before this, `Complete` with no tags was a
            dead end in the dropdown and the only way to fill it was a menu the owner had
            been told about in these words and could not find. */}
        {sections.map((section) => (
          <div className="db-option-section" key={section.id ?? "flat"} data-group={section.id ?? undefined}>
            {section.id !== null && groupById.has(section.id) ? (
              <GroupRow
                editor={editor}
                group={groupById.get(section.id)!}
                variant="option"
                showCount={false}
              />
            ) : section.name !== null ? (
              <div className="db-option-group" data-group-heading="">{section.name}</div>
            ) : null}
            {section.options.map((option) => {
              const at = raw.findIndex((entry) => entry.id === option.id);
              return (
                <OptionRow
                  key={option.id}
                  option={option}
                  checked={selected.has(option.id)}
                  role={multiple ? "menuitemcheckbox" : "menuitemradio"}
                  onPick={() => pick(option)}
                  onUpdate={(patch) => update(option.id, patch)}
                  onMove={(delta) => moveBy(option.id, delta)}
                  canMoveUp={at > 0}
                  canMoveDown={at >= 0 && at < raw.length - 1}
                  onDelete={() => remove(option.id)}
                  editing={editingId === option.id}
                  onEditingChange={(next) => setEditingId(next ? option.id : null)}
                  dragging={drag?.id === option.id}
                  dropSide={dropSideFor(option.id)}
                  grip={
                    sortable
                      ? {
                          onPointerDown: gripDown(option),
                          onPointerMove: gripMove,
                          onPointerUp: gripEnd,
                          onPointerCancel: gripEnd,
                        }
                      : undefined
                  }
                />
              );
            })}
          </div>
        ))}

        {/* Same reasoning as the grip: a filtered list is a subset, so "add a group" is not
            offered while searching. In a status column this row is the answer to "there is
            no way to add a group" — it is the same block the property menu draws. */}
        {status && query.trim() === "" ? (
          <div className="db-option-newgroup">
            <NewGroupBlock editor={editor} />
          </div>
        ) : null}

        {query.trim() && !options.some((option) => option.name.toLowerCase() === query.trim().toLowerCase()) ? (
          <button type="button" className="db-option-create" data-menuitem="" onClick={() => void create(query)}>
            Create <strong>{query.trim()}</strong>
          </button>
        ) : null}
      </MenuSurface>
    </div>
  );
}
